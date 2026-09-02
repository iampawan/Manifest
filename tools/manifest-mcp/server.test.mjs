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
const cleanContract = () => readFileSync(join(ROOT, "eval/contracts/clean.md"), "utf8");
const promotedContract = () => cleanContract()
  .replace("status: verified", "status: promoted")
  .replace("revision: 1", "revision: 1\nfixIterations: 0\nverifyFixIterations: 0\nmaxFixIterations: 3\njira:\n  issue: UWS-777\n  project: UWS");

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
  const contract = cleanContract();
  const result = await runTool("manifest_contract_validate", { contract });
  assert.equal(result.findings.length, 0);
  assert.equal(result.readiness.readiness, "verified");
  assert.match(result.contractHash, /^sha256:/);
});

test("contract pickup resolves Jira and completes into verified artifacts", async () => {
  const needsSource = await runTool("manifest_contract_pickup", {
    source: "https://pocketfm-jira.atlassian.net/browse/UWS-777?focusedCommentId=1",
  });
  assert.equal(needsSource.status, "needs_source");
  assert.equal(needsSource.source.jiraIssueKey, "UWS-777");
  assert.deepEqual(needsSource.next.connectorCall, { tool: "getAccessibleAtlassianResources", arguments: {} });

  const fetchReady = await runTool("manifest_contract_pickup", {
    source: "UWS-777", atlassianCloudId: "https://pocketfm-jira.atlassian.net",
  });
  assert.deepEqual(fetchReady.next.connectorCall, {
    tool: "getJiraIssue",
    arguments: { cloudId: "https://pocketfm-jira.atlassian.net", issueIdOrKey: "UWS-777" },
  });

  const boardSelection = await runTool("manifest_contract_pickup", {
    source: "https://pocketfm-jira.atlassian.net/jira/software/projects/UWS/boards/12?selectedIssue=UWS-777",
    atlassianCloudId: "https://pocketfm-jira.atlassian.net",
  });
  assert.equal(boardSelection.source.type, "jira");
  assert.equal(boardSelection.source.jiraIssueKey, "UWS-777");

  const needsDoc = await runTool("manifest_contract_pickup", {
    source: "https://docs.google.com/document/d/example/edit",
  });
  assert.equal(needsDoc.status, "needs_source");
  assert.equal(needsDoc.next.id, "fetch-source");
  assert.equal(needsDoc.next.sourceType, "google-doc");

  const needsConfluence = await runTool("manifest_contract_pickup", {
    source: "https://pocketfm-jira.atlassian.net/wiki/spaces/UWS/pages/123/UWS-777+brief",
  });
  assert.equal(needsConfluence.source.type, "confluence");

  const freeTextMention = await runTool("manifest_contract_pickup", {
    source: "Please review the confluence migration notes and draft the contract.",
  });
  assert.equal(freeTextMention.source.type, "text");
  assert.equal(freeTextMention.status, "needs_contract_draft");

  const completed = await runTool("manifest_contract_pickup", {
    source: "UWS-777",
    sourceContent: "Fetched issue content",
    contract: cleanContract().replace("id: CLEAN-001", "id: UWS-777"),
    jiraSync: { confirmed: false },
  });
  assert.equal(completed.status, "pickup_complete_promotable");
  assert.equal(completed.verification.valid, true);
  assert.equal(completed.verification.readiness.promotable, true);
  assert.match(completed.verification.artifacts.findingsMarkdown, /Promotable: yes/);
  assert.equal(completed.jiraSync.status, "awaiting_confirmation");
  assert.equal(completed.jiraSync.preview.existingIssue, "UWS-777");
});

test("contract verify validates judgment schema and preserves human dispositions", async () => {
  const judgment = [{
    id: "EDGE-001", critic: "edge-cases", severity: "warning",
    message: "Retry behavior is unclear.", suggestion: "Specify retry limits.",
    fragmentRef: "B1", status: "open",
  }];
  const verified = await runTool("manifest_contract_verify", {
    contract: cleanContract(),
    judgmentFindings: judgment,
    priorFindings: [{ ...judgment[0], status: "acknowledged" }],
    verifyMode: "full",
    verifiedAt: "2026-08-31T12:00:00.000Z",
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.findings[0].status, "acknowledged");
  assert.equal(verified.readiness.promotable, true);
  assert.equal(verified.artifacts.findingsJson.verifiedWith.protocolVersion, 2);
  assert.deepEqual(verified.frontmatterPatch, {
    status: "verified", complexity: "small", verifiedAt: "2026-08-31T12:00:00.000Z",
  });

  const fast = await runTool("manifest_contract_verify", { contract: cleanContract(), verifyMode: "fast" });
  assert.equal(fast.readiness.promotable, false);
  assert.equal(fast.frontmatterPatch.status, "verifying");

  const invalid = await runTool("manifest_contract_verify", {
    contract: cleanContract(),
    judgmentFindings: [{ ...judgment[0], severity: "high" }],
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.schemaErrors.join(" "), /invalid severity/);

  const securityBlocker = await runTool("manifest_contract_verify", {
    contract: cleanContract(),
    judgmentFindings: [{
      id: "SEC-001", critic: "security", severity: "blocker", message: "Authorization is unspecified.",
      suggestion: "Define the ownership check.", fragmentRef: "B1", status: "open",
    }],
  });
  assert.equal(securityBlocker.sizing.complexity, "medium");
  assert.equal(securityBlocker.readiness.promotable, false);
});

test("contract status remains read-only and derives phase, SLA, and next action", async () => {
  const status = await runTool("manifest_contract_status", { contract: promotedContract() });
  assert.equal(status.id, "CLEAN-001");
  assert.match(status.phase, /Build|Promoted/);
  assert.equal(status.sla.hasSla, false);
  assert.ok(status.next);
});

test("Jira sync is idempotent, confirmation-gated, and transition-name based", async () => {
  const contract = promotedContract();
  const preview = await runTool("manifest_jira_sync", { action: "upsert", contract, confirmed: false });
  assert.equal(preview.status, "awaiting_confirmation");
  assert.equal(preview.preview.existingIssue, "UWS-777");

  const cloudId = "https://pocketfm-jira.atlassian.net";
  const missingCloud = await runTool("manifest_jira_sync", { action: "upsert", contract, confirmed: true });
  assert.equal(missingCloud.status, "needs_cloud_id");
  assert.equal(missingCloud.calls[0].tool, "getAccessibleAtlassianResources");

  const update = await runTool("manifest_jira_sync", { action: "upsert", contract, confirmed: true, cloudId });
  assert.deepEqual(update.calls.map((call) => call.tool), ["getJiraIssue", "editJiraIssue"]);
  assert.deepEqual(update.calls[0].arguments, { cloudId, issueIdOrKey: "UWS-777", fields: ["labels"] });
  assert.equal(update.calls[1].arguments.fields.labels, "<existing labels plus manifest and complexity>");
  assert.deepEqual(update.calls[1].resolution.addLabels, ["manifest", "unsized"]);
  assert.equal(update.calls[1].resolution.preserveExistingLabels, true);
  assert.equal(update.calls.some((call) => call.tool === "createJiraIssue"), false);

  const datedContract = promotedContract().replace("revision: 1", "revision: 1\nslaDeadline: 2026-09-10T12:30:00.000Z");
  const datedUpdate = await runTool("manifest_jira_sync", { action: "upsert", contract: datedContract, confirmed: false });
  assert.equal(datedUpdate.preview.fields.duedate, "2026-09-10");

  const create = await runTool("manifest_jira_sync", {
    action: "upsert", contract: cleanContract(), confirmed: true, cloudId, projectKey: "UWS", issueType: "Story",
  });
  assert.deepEqual(create.calls.map((call) => call.tool), ["getJiraProjectIssueTypesMetadata", "createJiraIssue"]);
  assert.equal(create.calls[1].arguments.issueTypeName, "Story");
  assert.equal(create.calls[1].arguments.additional_fields.labels[0], "manifest");
  assert.equal(create.frontmatterPatch.jira.issue, "<created issue key>");

  const event = await runTool("manifest_jira_sync", {
    action: "event", contract, confirmed: true, cloudId, event: "implement_started",
    eventData: { contractId: "CLEAN-001", branch: "feature/UWS-777" },
  });
  assert.deepEqual(event.calls.map((call) => call.tool), ["getTransitionsForJiraIssue", "transitionJiraIssue", "addCommentToJiraIssue"]);
  assert.deepEqual(event.calls[1].arguments.transition, { id: "<resolved transition id>" });
  assert.equal(event.calls[1].resolution.desiredStatus, "In Progress");
  assert.match(event.calls[1].resolution.rule, /never hard-code/);
  assert.equal(event.calls[2].arguments.commentBody, "Implementation started · contract CLEAN-001 · branch feature/UWS-777.");

  const replay = await runTool("manifest_jira_sync", {
    action: "event", contract, confirmed: true, cloudId, event: "implement_started",
    eventData: { contractId: "CLEAN-001", branch: "feature/UWS-777" },
    appliedDedupeKeys: [event.dedupeKey],
  });
  assert.equal(replay.status, "already_applied");
  assert.deepEqual(replay.calls, []);

  const passReview = await runTool("manifest_jira_sync", {
    action: "event", contract, confirmed: true, cloudId, event: "verify_pr",
    eventData: { verdict: "pass", reviewUrl: "https://github.com/Pocket-Fm/ugc-ui/pull/12" },
  });
  const failReview = await runTool("manifest_jira_sync", {
    action: "event", contract, confirmed: true, cloudId, event: "verify_pr",
    eventData: { verdict: "fail", reviewUrl: "https://github.com/Pocket-Fm/ugc-ui/pull/12" },
  });
  assert.notEqual(passReview.dedupeKey, failReview.dedupeKey);
});

test("delivery implement initializes and resumes durable AC state", async () => {
  const first = await runTool("manifest_delivery_implement", {
    contract: promotedContract(),
    repo: { name: "ugc-ui", framework: "nextjs", languages: ["typescript"], toolchain: { test: "pnpm test", build: "pnpm build" } },
  });
  assert.equal(first.status, "ready");
  assert.equal(first.nextAction.acId, "AC1");
  assert.equal(first.state.acStatus.AC1.status, "pending");
  assert.deepEqual(first.unresolvedChecks, ["integration/e2e", "lint", "typecheck"]);
  assert.equal(first.localGate, "needs_check_resolution");

  const resumedState = structuredClone(first.state);
  resumedState.acStatus.AC1 = { status: "done", test: "tests/feature.test.ts" };
  resumedState.filesTouched = ["src/feature.ts"];
  const resumed = await runTool("manifest_delivery_implement", {
    contract: promotedContract(), state: resumedState,
    repo: { framework: "nextjs", languages: ["typescript"] },
  });
  assert.equal(resumed.status, "implementation_complete");
  assert.equal(resumed.progress.done, 1);

  const notPromoted = await runTool("manifest_delivery_implement", {
    contract: cleanContract(), repo: { framework: "nextjs" },
  });
  assert.equal(notPromoted.status, "not_promoted");

  const staleState = structuredClone(first.state);
  staleState.revision = 999;
  staleState.contractId = "OTHER-001";
  const rejectedState = await runTool("manifest_delivery_implement", {
    contract: promotedContract(), state: staleState, repo: { framework: "nextjs" },
  });
  assert.equal(rejectedState.status, "invalid_state");
  assert.equal(rejectedState.errors.length, 2);
});

test("verify-pr proves AC, instrumentation, flag, and changed-code evidence", async () => {
  const pass = await runTool("manifest_delivery_verify_pr", {
    contract: promotedContract(),
    requiredFeatureFlag: "ugc_feature",
    pr: {
      number: 12, url: "https://github.com/Pocket-Fm/ugc-ui/pull/12", branch: "feature/UWS-777",
      changedFiles: [{ path: "src/feature.ts", patch: "+ track('feature_used')\n+ if (ugc_feature) run()" }],
      tests: [{ name: "AC1 triggers feature", path: "tests/feature.test.ts", status: "passed", acIds: ["AC1"] }],
      instrumentationEvents: ["feature_used"], featureFlags: ["ugc_feature"],
    },
  });
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.mergeGate, true);
  assert.equal(pass.acCoverage[0].passed, true);

  const fail = await runTool("manifest_delivery_verify_pr", {
    contract: promotedContract(), requiredFeatureFlag: "ugc_feature",
    pr: { changedFiles: [{ path: "src/feature.ts", patch: "+ console.log('debug')\n+ // TODO later" }], tests: [] },
  });
  assert.equal(fail.verdict, "fail");
  assert.ok(fail.blockers.some((finding) => finding.type === "acceptance-criterion"));
  assert.ok(fail.blockers.some((finding) => finding.type === "instrumentation"));
  assert.ok(fail.blockers.some((finding) => finding.type === "feature-flag"));
  assert.equal(fail.warnings.length, 2);

  const removedEvent = await runTool("manifest_delivery_verify_pr", {
    contract: promotedContract(),
    pr: {
      changedFiles: [{ path: "src/feature.ts", patch: "- track('feature_used')\n+ runWithoutTracking()" }],
      tests: [{ name: "AC1", status: "passed", acIds: ["AC1"] }],
    },
  });
  assert.deepEqual(removedEvent.missingInstrumentation, ["feature_used"]);

  const removedNits = await runTool("manifest_delivery_verify_pr", {
    contract: promotedContract(),
    pr: {
      changedFiles: [{ path: "src/feature.ts", patch: "- console.log('debug')\n- // TODO later\n+ runWithoutDebug()" }],
      tests: [{ name: "AC1", status: "passed", acIds: ["AC1"] }],
      instrumentationEvents: ["feature_used"],
    },
  });
  assert.deepEqual(removedNits.warnings, []);
});

test("code-review finalization rejects bad output and gates open blockers", async () => {
  const finding = {
    id: "CR-001", category: "correctness", severity: "blocker",
    message: "Null value is dereferenced.", suggestion: "Guard the value before access.",
    file: "src/feature.ts", line: 42, status: "open",
    plainTitle: "Null value crashes the flow",
    whatHappens: "The handler reads the property when the response is null.",
    whyItMatters: "The common error path crashes.", theFix: "Return early when the response is null.",
    codeSnippet: "if (!response) return;",
  };
  const failed = await runTool("manifest_delivery_code_review", { findings: [finding], contractId: "UWS-777", pr: { number: 12 } });
  assert.equal(failed.valid, true);
  assert.equal(failed.mergeGate, false);
  assert.equal(failed.fixEligible, true);
  assert.match(failed.markdown, /Null value crashes/);

  const invalid = await runTool("manifest_delivery_code_review", { findings: [{ ...finding, severity: "critical" }] });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.verdict, "invalid");

  const missingProse = structuredClone(finding);
  delete missingProse.codeSnippet;
  const missingProseResult = await runTool("manifest_delivery_code_review", { findings: [missingProse] });
  assert.equal(missingProseResult.valid, false);
  assert.match(missingProseResult.schemaErrors.join(" "), /codeSnippet/);
});

test("bounded fix loops increment, stop at cap, and stop when green", async () => {
  const blocker = {
    id: "CR-001", category: "correctness", severity: "blocker", message: "Crash",
    suggestion: "Guard it", file: "src/a.ts", line: 1, status: "open",
  };
  const first = await runTool("manifest_delivery_fix_loop", {
    kind: "pr-review", contract: promotedContract(), reviewFindings: [blocker],
  });
  assert.equal(first.status, "fix");
  assert.equal(first.iteration, 1);
  assert.deepEqual(first.frontmatterPatch, { fixIterations: 1 });
  assert.match(first.nextAction, /verify-pr/);

  const contractLoop = await runTool("manifest_delivery_fix_loop", {
    kind: "contract-verify", contract: promotedContract(), reviewFindings: [{
      id: "F-001", critic: "security", severity: "blocker", message: "Missing authorization.",
      suggestion: "Define the ownership check.", fragmentRef: "B1", status: "open",
    }],
  });
  assert.match(contractLoop.nextAction, /contract-only/);
  assert.doesNotMatch(contractLoop.nextAction, /verify-pr/);

  const selfReviewLoop = await runTool("manifest_delivery_fix_loop", {
    kind: "self-review", contract: promotedContract(), state: { selfReviewIterations: 0 }, reviewFindings: [blocker],
  });
  assert.match(selfReviewLoop.nextAction, /before pushing/);

  const cappedContract = promotedContract().replace("fixIterations: 0", "fixIterations: 3");
  const capped = await runTool("manifest_delivery_fix_loop", {
    kind: "pr-review", contract: cappedContract, reviewFindings: [blocker], advisorConsulted: false,
  });
  assert.equal(capped.status, "escalate");
  assert.equal(capped.iteration, 3);
  assert.equal(capped.advisorRequiredBeforeHandoff, true);
  assert.deepEqual(capped.frontmatterPatch, {});
  assert.match(capped.nextAction, /PR-review/);

  const green = await runTool("manifest_delivery_fix_loop", {
    kind: "pr-review", contract: promotedContract(), reviewFindings: [{ ...blocker, status: "resolved" }],
  });
  assert.equal(green.status, "green");

  const invalidStateCounter = await runTool("manifest_delivery_fix_loop", {
    kind: "self-review", contract: promotedContract(), state: { selfReviewIterations: -1 }, reviewFindings: [blocker],
  });
  assert.equal(invalidStateCounter.status, "invalid_configuration");
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
