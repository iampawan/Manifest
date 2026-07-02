#!/usr/bin/env node
// Minimal, DEPENDENCY-FREE Figma REST MCP — JSON-RPC 2.0 over stdio, Node 18+.
// No npm install, no publish: ships with the plugin and runs straight from git.
// Exposes only what Ready Check design-freeze needs (the REST plumbing the
// official Figma Dev Mode MCP lacks).
//
// Auth: set FIGMA_TOKEN to a read-only Figma personal access token (files:read).
//   Figma → Settings → Security → Personal access tokens.

import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve as pathResolve } from "node:path";

const NAME = "figma-rest", VERSION = "0.3.1";
const BASE = "https://api.figma.com/v1";
const token = () => process.env.FIGMA_TOKEN;

const TOOLS = [
  { name: "get_file_version",
    description: "Get a Figma file's current version id + lastModified — pin at Ready-Check sign-off to detect later design drift.",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "A Figma file URL or file key" } }, required: ["file"] } },
  { name: "list_versions",
    description: "List a Figma file's named version history (immutable snapshots).",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "A Figma file URL or file key" } }, required: ["file"] } },
  { name: "export_node",
    description: "Render a Figma frame/node to an image URL by file key + node id — an immutable visual snapshot.",
    inputSchema: { type: "object", properties: {
      file:   { type: "string", description: "A Figma file URL or file key" },
      nodeId: { type: "string", description: "Node id like 1:2, or a Figma URL containing node-id" },
      format: { type: "string", enum: ["png", "svg", "pdf"], default: "png" } },
      required: ["file", "nodeId"] } },
  { name: "audit_design",
    description: "Read a Figma file's frames + text and report design-readiness gaps: platform coverage (mobile/tablet/desktop by frame width), which UI states exist (empty/loading/error/success by frame name), and placeholder/unfinished copy (lorem/TODO/xxx). Use to catch 'web but no mobile', 'no error screen', 'copy not updated' before dev.",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "A Figma file URL or file key" } }, required: ["file"] } },
];

// ── Design audit — a pure function over a Figma file JSON (GET /files/:key). ──
const STATE_RE = {
  empty:   /\b(empty|no results|nothing here|zero[-\s]?state|no data|no items|blank state)\b/i,
  loading: /\b(loading|skeleton|shimmer|spinner|please wait|fetching)\b/i,
  error:   /\b(error|failed|failure|went wrong|try again|4\d\d|5\d\d|offline|no (?:internet|network|connection)|retry)\b/i,
  success: /\b(success|done|complete|completed|confirmed|thank ?you)\b/i,
};
const PLACEHOLDER_RE = /(lorem ipsum|dolor sit|lipsum|\bTBD\b|\bTODO\b|\bx{3,}\b|placeholder|sample text|replace ?me|dummy text|your text here)/i;
const platformOf = (w) => (!w ? "unknown" : w < 500 ? "mobile" : w < 1024 ? "tablet" : "desktop");
const SCREEN_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"];

export function auditDocument(file = {}) {
  const pages = (file.document && file.document.children) || [];
  const screens = [], texts = [];
  let walked = 0;
  const collectText = (node, screen) => {
    if (!node || walked > 40000) return; walked++;
    if (node.type === "TEXT" && typeof node.characters === "string" && node.characters.trim())
      texts.push({ screen, chars: node.characters.trim() });
    for (const k of node.children || []) collectText(k, screen);
  };
  const addScreen = (n, pageName) => {
    const b = n.absoluteBoundingBox || {};
    screens.push({ name: n.name || "", page: pageName, width: Math.round(b.width || 0), height: Math.round(b.height || 0), platform: platformOf(b.width) });
    collectText(n, n.name || "");
  };
  for (const page of pages) {
    if (!page || page.type !== "CANVAS") continue;
    for (const n of page.children || []) {
      if (!n) continue;
      if (n.type === "SECTION") { for (const c of n.children || []) if (c && SCREEN_TYPES.includes(c.type)) addScreen(c, page.name || ""); }
      else if (SCREEN_TYPES.includes(n.type)) addScreen(n, page.name || "");
    }
  }
  const platforms = { mobile: 0, tablet: 0, desktop: 0, unknown: 0 };
  screens.forEach((s) => { platforms[s.platform]++; });
  const nameBlob = screens.map((s) => s.name).join(" || ");
  const states = {}; for (const k of Object.keys(STATE_RE)) states[k] = STATE_RE[k].test(nameBlob);
  const placeholders = [];
  for (const t of texts) { if (PLACEHOLDER_RE.test(t.chars)) { placeholders.push({ screen: t.screen, text: t.chars.slice(0, 60) }); if (placeholders.length >= 25) break; } }
  // Non-contextual findings (the panel adds PRD-scope-aware severity on top).
  const findings = [];
  if (platforms.desktop > 0 && platforms.mobile === 0) findings.push({ severity: "warning", area: "scope", message: "Desktop/web frames found but no mobile-width frames — mobile design may be missing." });
  for (const st of ["error", "empty", "loading"]) if (!states[st]) findings.push({ severity: st === "error" ? "blocker" : "warning", area: "states", message: `No ${st} screen found by name across ${screens.length} frame(s).` });
  if (placeholders.length) findings.push({ severity: "blocker", area: "design", message: `${placeholders.length} text layer(s) still contain placeholder copy (e.g. "${placeholders[0].text}").` });
  // NOTE: we intentionally do NOT return the full per-screen list — it can be
  // hundreds of entries and bloats the payload (the Ready Check panel only needs
  // the summary). Keep a tiny sample for debugging.
  return { name: file.name, version: file.version, screenCount: screens.length, platforms, states, placeholders, sampleScreens: screens.slice(0, 6), findings };
}

const fileKey = (s) => { const m = String(s || "").match(/figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/); return m ? m[1] : String(s || "").trim(); };
const nodeIdFromUrl = (s) => { const m = String(s || "").match(/node-id=([0-9]+-[0-9]+)/); return m ? m[1].replace("-", ":") : null; };

async function figma(path) {
  const t = token();
  if (!t) throw new Error("FIGMA_TOKEN not set — use a read-only Figma personal access token (files:read).");
  const r = await fetch(BASE + path, { headers: { "X-Figma-Token": t } });
  if (!r.ok) throw new Error(`Figma API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
async function runTool(name, a = {}) {
  if (name === "get_file_version") { const d = await figma(`/files/${fileKey(a.file)}?depth=1`);
    return { key: fileKey(a.file), name: d.name, version: d.version, lastModified: d.lastModified, thumbnailUrl: d.thumbnailUrl }; }
  if (name === "list_versions") { const d = await figma(`/files/${fileKey(a.file)}/versions`);
    return { key: fileKey(a.file), versions: (d.versions || []).slice(0, 20).map((v) => ({ id: v.id, label: v.label, created_at: v.created_at, description: v.description })) }; }
  if (name === "export_node") { const id = nodeIdFromUrl(a.nodeId) || a.nodeId; const fmt = a.format || "png";
    const d = await figma(`/images/${fileKey(a.file)}?ids=${encodeURIComponent(id)}&format=${fmt}`);
    return { key: fileKey(a.file), nodeId: id, image: (d.images && d.images[id]) || null, err: d.err || null }; }
  if (name === "audit_design") { const d = await figma(`/files/${fileKey(a.file)}`); return { key: fileKey(a.file), ...auditDocument(d) }; }
  throw new Error(`Unknown tool: ${name}`);
}

// ── JSON-RPC 2.0 over stdio (newline-delimited). stdout = protocol only. ──
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const result = (id, r) => send({ jsonrpc: "2.0", id, result: r });
const rpcError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (method === "initialize") {
    result(id, { protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} }, serverInfo: { name: NAME, version: VERSION } });
  } else if (method === "tools/list") {
    result(id, { tools: TOOLS });
  } else if (method === "tools/call") {
    const nm = params && params.name, args = (params && params.arguments) || {};
    try { result(id, { content: [{ type: "text", text: JSON.stringify(await runTool(nm, args), null, 2) }] }); }
    catch (e) { result(id, { content: [{ type: "text", text: `Error: ${e && e.message || e}` }], isError: true }); }
  } else if (method === "ping") {
    result(id, {});
  } else if (method && method.startsWith("notifications/")) {
    // notifications carry no id and get no response
  } else if (id !== undefined && id !== null) {
    rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function startServer() {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const s = line.trim(); if (!s) return;
    let msg; try { msg = JSON.parse(s); } catch { return; }
    if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
  });
}
// Start the stdio server only when run directly (`node index.mjs`) — importing the
// file (e.g. from a test) exposes auditDocument without launching the server.
const isMain = process.argv[1] && pathResolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) startServer();
