#!/usr/bin/env node
// Minimal, DEPENDENCY-FREE Figma REST MCP — JSON-RPC 2.0 over stdio, Node 18+.
// No npm install, no publish: ships with the plugin and runs straight from git.
// Exposes only what Ready Check design-freeze needs (the REST plumbing the
// official Figma Dev Mode MCP lacks).
//
// Auth: set FIGMA_TOKEN to a read-only Figma personal access token (files:read).
//   Figma → Settings → Security → Personal access tokens.

import { createInterface } from "node:readline";

const NAME = "figma-rest", VERSION = "0.2.0";
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
];

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

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim(); if (!s) return;
  let msg; try { msg = JSON.parse(s); } catch { return; }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
