import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  NAME,
  TOOLS,
  handleRpc,
  promptCatalog,
  readResource,
  resourceCatalog,
  runTool,
  startHttp,
} from "./server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const ready = {
  title: "Saved payment cards at checkout",
  items: {
    goal: { detail: "Returning users re-enter card details and drop at payment." },
    metric: { detail: "+6% checkout conversion within 4 weeks." },
    design: { detail: "Approved interface spec at https://figma.com/file/saved-cards" },
    scope: { detail: "Android and iOS. Web is out of scope." },
    oldbeh: { detail: "Payment always shows a blank card form." },
    flows: { detail: "Checkout, payment, and confirmation flows." },
    edge: { detail: "Expired card, token failure, no network, and deletion during checkout." },
    states: { detail: "Empty, loading, success, and retryable error states are specified." },
    l10n: { detail: "English and Hindi wording is final." },
    writer: { na: true, reason: "Listener-only payment change; no creator impact." },
    events: { detail: "card_saved, saved_card_used, and tokenize_failed." },
    deps: { detail: "Payments tokenization API." },
    rollout: { detail: "Feature flag at 1, 10, 50, then 100 percent." },
  },
};

test("advertises a lifecycle-sized tool surface, not Ready Check only", () => {
  const names = new Set(TOOLS.map((tool) => tool.name));
  assert.ok(TOOLS.length >= 12);
  assert.ok(names.has("manifest_ready_evaluate"));
  assert.ok(names.has("manifest_contract_validate"));
  assert.ok(names.has("manifest_contract_status"));
  assert.ok(names.has("manifest_detect_stack"));
  assert.ok(names.has("manifest_recall_stability"));
});

test("Ready Check clears, mints, and round-trips a handoff", async () => {
  const evaluated = await runTool("manifest_ready_evaluate", { answers: ready, includePrd: true });
  assert.equal(evaluated.verdict.cleared, true);
  assert.match(evaluated.gateCode, /^RC-/);
  assert.match(evaluated.handoff, /READY CHECK PASSED/);
  assert.match(evaluated.prd, /Saved payment cards/);

  const verified = await runTool("manifest_ready_verify", { handoff: evaluated.handoff });
  assert.equal(verified.verdict, "valid");
});

test("a lone gate code is explicitly unverifiable", async () => {
  const evaluated = await runTool("manifest_ready_evaluate", { answers: ready });
  const verified = await runTool("manifest_ready_verify", { handoff: `Ready-Check: ${evaluated.gateCode}` });
  assert.equal(verified.verdict, "unverifiable");
});

test("contract validation uses the same deterministic validator", async () => {
  const contract = readFileSync(join(ROOT, "eval/contracts/clean.md"), "utf8");
  const result = await runTool("manifest_contract_validate", { contract });
  assert.equal(result.findings.length, 0);
  assert.equal(result.readiness.readiness, "verified");
  assert.match(result.contractHash, /^sha256:/);
});

test("stack detection works from portable marker-file payloads", async () => {
  const result = await runTool("manifest_detect_stack", {
    name: "ugc-ui",
    files: { "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" }, devDependencies: { vitest: "2.0.0" } }) },
  });
  assert.equal(result.framework, "nextjs");
  assert.equal(result.testFramework, "vitest");
});

test("resources and command prompts expose Manifest playbooks", async () => {
  const resources = resourceCatalog();
  assert.ok(resources.some((resource) => resource.uri === "manifest:///skills/implement/SKILL.md"));
  assert.ok(resources.some((resource) => resource.uri === "manifest:///commands/ready-check.md"));
  assert.match(readResource("manifest:///commands/ready-check.md").text, /Ready Check/);
  assert.ok(promptCatalog().some((prompt) => prompt.name === "manifest-implement"));

  const response = await handleRpc({ jsonrpc: "2.0", id: 1, method: "resources/list", params: {} });
  assert.equal(response.result.resources.length, resources.length);
});

test("resource reads cannot escape the published catalog", () => {
  assert.throws(() => readResource("manifest:///.git/config"), /Unknown Manifest resource/);
  assert.throws(() => readResource("manifest:///../.git/config"), /Unknown Manifest resource/);
});

test("JSON-RPC initialization advertises tools, resources, and prompts", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0", id: 7, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  assert.equal(response.result.serverInfo.name, NAME);
  assert.deepEqual(Object.keys(response.result.capabilities).sort(), ["prompts", "resources", "tools"]);
});

let httpServer;
let endpoint;

before(async () => {
  httpServer = startHttp({ host: "127.0.0.1", port: 0 });
  await new Promise((resolveReady) => httpServer.once("listening", resolveReady));
  endpoint = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  if (httpServer) await new Promise((resolveClosed, reject) => httpServer.close((error) => error ? reject(error) : resolveClosed()));
});

test("HTTP mode serves health and stateless MCP requests", async () => {
  const health = await fetch(`${endpoint}/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const response = await fetch(`${endpoint}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.tools.length, TOOLS.length);
});

test("HTTP mode rejects foreign browser origins", async () => {
  const response = await fetch(`${endpoint}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
  });
  assert.equal(response.status, 403);
});
