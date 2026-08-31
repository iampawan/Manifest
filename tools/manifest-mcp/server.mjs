#!/usr/bin/env node

// Manifest MCP: dependency-free protocol server, Node 18+.
//
// - stdio is the default and is suitable for Cursor and other laptop agents.
// - `--http` exposes a stateless Streamable HTTP endpoint at /mcp.
// - Deterministic operations accept content payloads, so a centrally hosted
//   server never needs access to a developer's local checkout.

import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RUBRIC,
  ballLedger,
  cacheChecks,
  checkReadiness,
  effectiveSla,
  epicRollup,
  extractHandoff,
  gateCode,
  parseHandoff,
  prdHash,
  renderAddendum,
  renderHandoff,
  renderPrd,
  renderScorecard,
  stripAddendum,
  verifyFreeze,
  verifyGateCode,
} from "../../scripts/ready-check.mjs";
import { detectFromFiles } from "../../scripts/detect.mjs";
import { scoreRecall, scoreStability } from "../../scripts/recall.mjs";
import { renderHtml } from "../../scripts/render-diagram.mjs";

export const NAME = "pocketfm-manifest";
export const VERSION = "0.42.0";
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, "../..");
const MAX_REQUEST_BYTES = numberEnv("MANIFEST_MCP_MAX_REQUEST_BYTES", 2 * 1024 * 1024);
const MAX_RESULT_CHARS = numberEnv("MANIFEST_MCP_MAX_RESULT_CHARS", 2 * 1024 * 1024);

const objectSchema = (properties, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const ANY_OBJECT = { type: "object", additionalProperties: true };

export const TOOLS = [
  {
    name: "manifest_about",
    title: "Manifest capabilities",
    description: "Describe this Manifest build, its deterministic operations, and the boundary between the shared MCP and laptop-local agent work.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_ready_evaluate",
    title: "Evaluate PRD readiness",
    description: "Run Manifest's deterministic Definition of Ready. Returns the exact verdict, scorecard, optional publish-ready PRD, and a gate code/handoff only when the PRD clears.",
    inputSchema: objectSchema({
      answers: { ...ANY_OBJECT, description: "Ready Check answers: {title, items: {goal: {detail}, ...}}" },
      freeze: { ...ANY_OBJECT, description: "Optional freeze metadata used in a cleared handoff." },
      includePrd: { type: "boolean", default: false },
    }, ["answers"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_ready_verify",
    title: "Verify Ready Check handoff",
    description: "Verify that a complete tool-generated Ready Check handoff has not been edited. A gate code without its hashed item list is reported as unverifiable.",
    inputSchema: objectSchema({ handoff: { type: "string", minLength: 1, description: "Whole ticket/page text or the complete handoff block." } }, ["handoff"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_ready_verify_freeze",
    title: "Verify PRD/design freeze",
    description: "Compare a pinned Ready Check handoff with the currently fetched source/design/content versions.",
    inputSchema: objectSchema({
      handoff: { type: "string", minLength: 1 },
      current: { ...ANY_OBJECT, description: "Current {version?, designVersion?, prdHash?}." },
    }, ["handoff", "current"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_ready_hash",
    title: "Hash PRD content",
    description: "Compute Manifest's stable PRD content hash. Ready Check addenda are excluded exactly as in the CLI.",
    inputSchema: objectSchema({ content: { type: "string" } }, ["content"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_ready_addendum",
    title: "Render Ready Check addendum",
    description: "Render the answers marked addedInReview so an agent can append them to the source PRD without rewriting it.",
    inputSchema: objectSchema({
      answers: ANY_OBJECT,
      author: { type: "string", default: "" },
      date: { type: "string", description: "Optional display date. Defaults to today's UTC date." },
    }, ["answers"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_contract_validate",
    title: "Validate Manifest contract",
    description: "Parse and deterministically validate a Manifest contract markdown payload. Returns findings, sizing, model plan, readiness, and contract hash.",
    inputSchema: objectSchema({
      contract: { type: "string", minLength: 1, description: "Complete contract markdown including YAML frontmatter." },
      conventions: { ...ANY_OBJECT, description: "Optional conventions from .manifest/repos.yml." },
    }, ["contract"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_contract_status",
    title: "Get contract status",
    description: "Derive a contract's current phase, SLA, deterministic readiness, and next action from its markdown payload.",
    inputSchema: objectSchema({ contract: { type: "string", minLength: 1 } }, ["contract"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_contract_migrate",
    title: "Migrate contract frontmatter",
    description: "Return contract markdown with canonical grouped frontmatter. It preserves values and body and never writes a file.",
    inputSchema: objectSchema({ contract: { type: "string", minLength: 1 } }, ["contract"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_contract_diagram",
    title: "Render contract diagrams",
    description: "Render Mermaid fences from contract markdown into standalone HTML. The returned HTML loads Mermaid when opened.",
    inputSchema: objectSchema({
      contract: { type: "string", minLength: 1 },
      title: { type: "string", default: "Contract diagrams" },
    }, ["contract"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_detect_stack",
    title: "Detect repository stack",
    description: "Detect framework, languages, analytics SDK, and test framework from marker-file contents. Suitable for a shared MCP because no local path is required.",
    inputSchema: objectSchema({
      files: { type: "object", additionalProperties: { type: "string" }, description: "Marker file contents keyed by filename, e.g. package.json or pubspec.yaml." },
      listing: { type: "array", items: { type: "string" }, default: [] },
      name: { type: "string", default: "repository" },
    }, ["files"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_cache_check",
    title: "Run code-context checks",
    description: "Compare Ready Check answers with a supplied Manifest code-context cache and return deterministic code-aware notes.",
    inputSchema: objectSchema({ answers: ANY_OBJECT, codeContext: ANY_OBJECT }, ["answers", "codeContext"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_recall_score",
    title: "Score critic recall",
    description: "Score one deterministic critic findings run against a golden expectation file.",
    inputSchema: objectSchema({
      actual: { type: "array", items: ANY_OBJECT },
      golden: ANY_OBJECT,
    }, ["actual", "golden"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_recall_stability",
    title: "Score critic stability",
    description: "Score repeated critic findings runs against the same golden expectations and identify flaky required gaps.",
    inputSchema: objectSchema({
      runs: { type: "array", minItems: 1, items: { type: "array", items: ANY_OBJECT } },
      golden: ANY_OBJECT,
    }, ["runs", "golden"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_delivery_ledger",
    title: "Compute PM/dev delivery ledger",
    description: "Compute ball ownership, PM-blocked time, dev time, bounces, and optional effective SLA from delivery events.",
    inputSchema: objectSchema({
      events: { type: "array", items: ANY_OBJECT },
      now: { type: "number", description: "Optional epoch milliseconds for reproducible evaluation." },
      slaHours: { type: "number", exclusiveMinimum: 0 },
      startedAt: { type: "string" },
    }, ["events"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manifest_epic_rollup",
    title: "Roll up epic children",
    description: "Compute deterministic epic progress, critical path, blockers, and feature-landed state from child contract statuses.",
    inputSchema: objectSchema({ children: { type: "array", items: ANY_OBJECT } }, ["children"]),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

let validatorModule;
let migratorModule;

async function validator() {
  try {
    validatorModule ||= await import("../../scripts/validate.mjs");
    return validatorModule;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("js-yaml")) {
      throw new Error("Contract tooling needs js-yaml. Run `cd scripts && npm install`, then restart the MCP server.");
    }
    throw error;
  }
}

async function migrator() {
  try {
    migratorModule ||= await import("../../scripts/migrate-contract.mjs");
    return migratorModule;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("js-yaml")) {
      throw new Error("Contract migration needs js-yaml. Run `cd scripts && npm install`, then restart the MCP server.");
    }
    throw error;
  }
}

function assertPayloadSize(value, label = "payload") {
  const size = Buffer.byteLength(JSON.stringify(value ?? null));
  if (size > MAX_REQUEST_BYTES) throw new Error(`${label} exceeds ${MAX_REQUEST_BYTES} bytes`);
}

function displayDate(input) {
  if (input) return String(input);
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export async function runTool(name, args = {}) {
  assertPayloadSize(args);

  if (name === "manifest_about") {
    return {
      name: NAME,
      version: VERSION,
      modes: ["stdio", "streamable-http"],
      deterministicTools: TOOLS.map((tool) => tool.name),
      playbooks: "Available through MCP resources/prompts and as Agent Plugin skills/commands.",
      boundary: "Shared HTTP tools operate on supplied content. Repository edits, GitHub/Jira writes, deployment, and other laptop/external-system actions are performed by the connected agent using Manifest playbooks and its own approved tools.",
    };
  }

  if (name === "manifest_ready_evaluate") {
    const answers = args.answers || {};
    const verdict = checkReadiness(answers);
    const meta = { date: displayDate(args.freeze?.date), ...(args.freeze || {}) };
    return {
      verdict,
      scorecard: renderScorecard(answers, meta),
      gateCode: verdict.cleared ? gateCode(answers) : null,
      handoff: verdict.cleared ? renderHandoff(answers, meta) : null,
      ...(args.includePrd ? { prd: renderPrd(answers, meta) } : {}),
    };
  }

  if (name === "manifest_ready_verify") {
    const block = extractHandoff(args.handoff) || args.handoff;
    const parsed = parseHandoff(block);
    const bullets = (block.match(/^[•*-]\s*\[\w+\]/gm) || []).length;
    if (parsed.code && bullets < 3) {
      return {
        verdict: "unverifiable",
        code: parsed.code,
        reason: "A gate code alone proves nothing; the complete hashed item list is missing.",
        hasFreezeSource: Boolean(parsed.source),
        hasPrdHash: Boolean(parsed.prdHash),
      };
    }
    const answers = { title: parsed.title, items: parsed.items };
    return {
      verdict: verifyGateCode(parsed.code, answers),
      code: parsed.code || null,
      parsed: {
        title: parsed.title,
        source: parsed.source || null,
        designVersion: parsed.designVersion || null,
        prdHash: parsed.prdHash || null,
      },
    };
  }

  if (name === "manifest_ready_verify_freeze") {
    const block = extractHandoff(args.handoff) || args.handoff;
    const parsed = parseHandoff(block);
    return { verdict: verifyFreeze(parsed, args.current), pinned: parsed, current: args.current };
  }

  if (name === "manifest_ready_hash") {
    return { hash: prdHash(stripAddendum(args.content)), addendumExcluded: true };
  }

  if (name === "manifest_ready_addendum") {
    return { addendum: renderAddendum(args.answers, { by: args.author || "", date: displayDate(args.date) }) };
  }

  if (name === "manifest_contract_validate") {
    const v = await validator();
    const contract = v.parseContract(args.contract);
    const findings = v.checkContract(contract);
    const sizing = v.computeSizing(contract);
    const readiness = v.computeReadiness(contract, findings);
    return {
      findings,
      sizing,
      modelPlan: v.computeModelPlan(contract, sizing, args.conventions || {}),
      readiness,
      contractHash: v.hashOf(args.contract),
      valid: !findings.some((finding) => finding.severity === "blocker" && (finding.status || "open") === "open"),
    };
  }

  if (name === "manifest_contract_status") {
    const v = await validator();
    const contract = v.parseContract(args.contract);
    const fm = contract.frontmatter;
    const { phase, next } = v.derivePhase(fm);
    const sla = v.slaStatus(fm);
    const findings = fm.type === "epic" ? [] : v.checkContract(contract);
    return {
      id: fm.id,
      title: fm.title,
      phase,
      sla,
      readiness: v.computeReadiness(contract, findings),
      next,
    };
  }

  if (name === "manifest_contract_migrate") {
    const { migrateFrontmatter } = await migrator();
    return { contract: migrateFrontmatter(args.contract), wroteFile: false };
  }

  if (name === "manifest_contract_diagram") {
    return { html: renderHtml(args.contract, args.title || "Contract diagrams") };
  }

  if (name === "manifest_detect_stack") {
    return { name: args.name || "repository", ...detectFromFiles(args.files, args.listing || []) };
  }

  if (name === "manifest_cache_check") {
    return cacheChecks(args.answers, args.codeContext);
  }

  if (name === "manifest_recall_score") return scoreRecall(args.actual, args.golden);
  if (name === "manifest_recall_stability") return scoreStability(args.runs, args.golden);

  if (name === "manifest_delivery_ledger") {
    const now = Number.isFinite(args.now) ? args.now : Date.now();
    const ledger = ballLedger(args.events, now);
    return {
      holder: ledger.holder,
      blockedOnPmMs: ledger.blockedOnPmMs,
      devMs: ledger.devMs,
      bounces: ledger.bounces,
      ...(args.slaHours && args.startedAt
        ? { sla: effectiveSla(args.slaHours * 3.6e6, args.startedAt, args.events, now) }
        : {}),
    };
  }

  if (name === "manifest_epic_rollup") return epicRollup(args.children);

  throw new Error(`Unknown tool: ${name}`);
}

const RESOURCE_ROOTS = ["commands", "skills", "reference"];
const RESOURCE_FILES = ["README.md", "GUIDE.md", "AGENTS.md", "docs/INSTALL.md", "docs/RELIABILITY.md"];

function walkFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(full));
    else if (entry.isFile() && /\.(md|mdc|txt)$/.test(entry.name)) output.push(full);
  }
  return output;
}

function safePluginFile(file) {
  const full = resolve(PLUGIN_ROOT, file);
  const rel = relative(PLUGIN_ROOT, full);
  if (rel.startsWith(`..${sep}`) || rel === ".." || resolve(full) === resolve(PLUGIN_ROOT)) {
    throw new Error("Resource path escapes the Manifest plugin root");
  }
  if (!statSync(full).isFile()) throw new Error("Resource is not a file");
  return full;
}

export function resourceCatalog() {
  const files = [
    ...RESOURCE_FILES.map((file) => join(PLUGIN_ROOT, file)),
    ...RESOURCE_ROOTS.flatMap((directory) => walkFiles(join(PLUGIN_ROOT, directory))),
  ];
  return files.map((full) => {
    const rel = relative(PLUGIN_ROOT, full).split(sep).join("/");
    return {
      uri: `manifest:///${rel}`,
      name: rel,
      title: `Manifest: ${rel}`,
      mimeType: "text/markdown",
      description: rel.startsWith("skills/") ? "Manifest lifecycle skill" : rel.startsWith("commands/") ? "Manifest agent command" : "Manifest reference",
    };
  }).sort((a, b) => a.uri.localeCompare(b.uri));
}

export function readResource(uri) {
  const allowed = new Set(resourceCatalog().map((resource) => resource.uri));
  if (!allowed.has(uri)) throw new Error(`Unknown Manifest resource: ${uri}`);
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error(`Invalid resource URI: ${uri}`); }
  if (parsed.protocol !== "manifest:") throw new Error(`Unsupported resource URI: ${uri}`);
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const full = safePluginFile(rel);
  return { uri, mimeType: "text/markdown", text: readFileSync(full, "utf8") };
}

export function promptCatalog() {
  return resourceCatalog()
    .filter((resource) => resource.name.startsWith("commands/"))
    .map((resource) => ({
      name: `manifest-${basename(resource.name, ".md")}`,
      title: `Manifest /${basename(resource.name, ".md")}`,
      description: `Run Manifest's ${basename(resource.name, ".md")} workflow.`,
      arguments: [{ name: "context", description: "Ticket, PRD, contract, PR, or other task context.", required: false }],
      _resourceUri: resource.uri,
    }));
}

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function textToolResult(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated at ${MAX_RESULT_CHARS} characters]`;
  }
  return { content: [{ type: "text", text }], structuredContent: typeof value === "object" && value !== null ? value : undefined };
}

export async function handleRpc(message) {
  const { id, method, params } = message || {};
  if (!method || typeof method !== "string") return rpcError(id, -32600, "Invalid Request");

  if (method === "initialize") {
    const requested = params?.protocolVersion;
    const protocolVersion = typeof requested === "string" ? requested : DEFAULT_PROTOCOL_VERSION;
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: NAME, version: VERSION, title: "PocketFM Manifest" },
      instructions: "Use deterministic Manifest tools for gates. Read Manifest resources or prompts for the human/agent lifecycle. External writes remain subject to the connected agent's approval and tools.",
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      const value = await runTool(params?.name, params?.arguments || {});
      return rpcResult(id, textToolResult(value));
    } catch (error) {
      return rpcResult(id, {
        content: [{ type: "text", text: `Error: ${error?.message || String(error)}` }],
        isError: true,
      });
    }
  }
  if (method === "resources/list") return rpcResult(id, { resources: resourceCatalog() });
  if (method === "resources/read") {
    try { return rpcResult(id, { contents: [readResource(params?.uri)] }); }
    catch (error) { return rpcError(id, -32002, error?.message || String(error)); }
  }
  if (method === "prompts/list") {
    return rpcResult(id, { prompts: promptCatalog().map(({ _resourceUri, ...prompt }) => prompt) });
  }
  if (method === "prompts/get") {
    const prompt = promptCatalog().find((entry) => entry.name === params?.name);
    if (!prompt) return rpcError(id, -32602, `Unknown prompt: ${params?.name}`);
    const resource = readResource(prompt._resourceUri);
    const context = params?.arguments?.context ? `\n\nTask context:\n${params.arguments.context}` : "";
    return rpcResult(id, {
      description: prompt.description,
      messages: [{ role: "user", content: { type: "text", text: `${resource.text}${context}` } }],
    });
  }
  if (method.startsWith("notifications/")) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

async function handleBatch(payload) {
  if (!Array.isArray(payload)) return handleRpc(payload);
  if (payload.length === 0) return rpcError(null, -32600, "Invalid Request");
  const responses = (await Promise.all(payload.map(handleRpc))).filter(Boolean);
  return responses.length ? responses : null;
}

export function startStdio() {
  const lineReader = createInterface({ input: process.stdin });
  lineReader.on("line", async (line) => {
    const input = line.trim();
    if (!input) return;
    let payload;
    try { payload = JSON.parse(input); }
    catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error"))}\n`);
      return;
    }
    const response = await handleBatch(payload);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function allowedOrigin(origin, host) {
  if (!origin) return true;
  const configured = new Set(String(process.env.MANIFEST_MCP_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (configured.has(origin)) return true;
  try {
    const url = new URL(origin);
    return isLoopback(host) && isLoopback(url.hostname);
  } catch { return false; }
}

function authorized(request) {
  const token = process.env.MANIFEST_MCP_TOKEN;
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function jsonResponse(response, status, body, extraHeaders = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

export function startHttp(options = {}) {
  const host = options.host || process.env.MANIFEST_MCP_HOST || "127.0.0.1";
  const port = options.port ?? Number(process.env.MANIFEST_MCP_PORT || process.env.PORT || 7337);
  if (!isLoopback(host) && !process.env.MANIFEST_MCP_TOKEN) {
    throw new Error("MANIFEST_MCP_TOKEN is required when binding the HTTP server beyond localhost.");
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
    if (url.pathname === "/health" && request.method === "GET") {
      jsonResponse(response, 200, { ok: true, name: NAME, version: VERSION, transport: "streamable-http" });
      return;
    }
    if (url.pathname !== "/mcp") {
      jsonResponse(response, 404, { error: "Not found" });
      return;
    }
    if (!allowedOrigin(request.headers.origin, host)) {
      jsonResponse(response, 403, { error: "Origin not allowed" });
      return;
    }
    if (!authorized(request)) {
      jsonResponse(response, 401, { error: "Unauthorized" }, { "www-authenticate": "Bearer" });
      return;
    }
    if (request.method === "GET") {
      jsonResponse(response, 405, { error: "This stateless server does not open an SSE stream" }, { allow: "POST" });
      return;
    }
    if (request.method !== "POST") {
      jsonResponse(response, 405, { error: "Method not allowed" }, { allow: "POST" });
      return;
    }
    try {
      const payload = await readJsonBody(request);
      const result = await handleBatch(payload);
      if (result === null) {
        response.writeHead(202, { "cache-control": "no-store" });
        response.end();
      } else {
        jsonResponse(response, 200, result);
      }
    } catch (error) {
      const status = error?.status || 500;
      jsonResponse(response, status, rpcError(null, status === 400 ? -32700 : -32603, error?.message || "Internal error"));
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    process.stderr.write(`Manifest MCP ${VERSION} listening on http://${host}:${actualPort}/mcp\n`);
  });
  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--http") || process.env.MANIFEST_MCP_TRANSPORT === "http") startHttp();
  else startStdio();
}
