// Unit tests for the deterministic validator.
// Run with: node --test  (from the eval/ directory, or repo root)
//
// These tests are EXACT-MATCH and rock-solid because the validator is
// deterministic. If a change to validate.mjs alters behavior, a test
// fails — that's the regression gate that makes plugin changes safe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseContract,
  checkContract,
  computeSizing,
  computeModelPlan,
  computeReadiness,
  validateFindings,
} from "../scripts/validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, "contracts", name), "utf8");

// ─── Clean contract: zero findings, verified ─────────────────────────

test("clean contract produces zero deterministic findings", () => {
  const c = parseContract(read("clean.md"));
  const findings = checkContract(c);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("clean contract is sized small (1 platform, 1 behavior)", () => {
  const c = parseContract(read("clean.md"));
  const { complexity } = computeSizing(c);
  assert.equal(complexity, "small");
});

test("clean contract readiness is verified (no findings, confidence 0.9)", () => {
  const c = parseContract(read("clean.md"));
  const findings = checkContract(c);
  const { readiness } = computeReadiness(c, findings);
  assert.equal(readiness, "verified");
});

// ─── Seeded-gaps contract: each gap caught ───────────────────────────

test("seeded-gaps: catches missing instrumentation on B1", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const f = findings.find(
    (x) => x.critic === "instrumentation" && x.fragmentRef === "B1" &&
           x.message.includes("no instrumentation")
  );
  assert.ok(f, "expected a missing-instrumentation blocker on B1");
  assert.equal(f.severity, "blocker");
});

test("perfBudget: missing budget is a WARNING by default (not a blocker)", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c); // default policy = "warn"
  const f = findings.find((x) => x.critic === "perf-budget" && x.fragmentRef === "B2");
  assert.ok(f, "expected a missing-perfBudget finding on B2");
  assert.equal(f.severity, "warning");
});

test("perfBudget: policy 'required' makes a missing budget a blocker", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c, { perfBudgetPolicy: "required" });
  const f = findings.find((x) => x.critic === "perf-budget" && x.fragmentRef === "B2");
  assert.ok(f);
  assert.equal(f.severity, "blocker");
});

test("perfBudget: policy 'off' emits no perf-budget findings", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c, { perfBudgetPolicy: "off" });
  assert.equal(findings.filter((x) => x.critic === "perf-budget").length, 0);
});

test("perfBudget: per-contract frontmatter policy overrides the option", () => {
  const c = parseContract(read("seeded-gaps.md"));
  c.frontmatter.perfBudgetPolicy = "required";
  const findings = checkContract(c, { perfBudgetPolicy: "off" }); // frontmatter wins
  const f = findings.find((x) => x.critic === "perf-budget" && x.fragmentRef === "B2");
  assert.ok(f);
  assert.equal(f.severity, "blocker");
});

test("perfBudget: one relevant numeric field is enough (no longer needs all three)", () => {
  const c = parseContract(read("clean.md"));
  // Strip clean.md's first behavior down to a single numeric field.
  c.behaviors[0].perfBudget = { p95LatencyMs: 500 };
  const findings = checkContract(c, { perfBudgetPolicy: "required" });
  assert.equal(
    findings.filter((x) => x.critic === "perf-budget" && x.fragmentRef === c.behaviors[0].id).length,
    0,
    "a single numeric field should satisfy perfBudget"
  );
});

test("seeded-gaps: catches missing comms states on B2", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const f = findings.find(
    (x) => x.critic === "comms-completeness" && x.fragmentRef === "B2"
  );
  assert.ok(f, "expected a missing-comms blocker on B2");
});

test("commsStates: server-only behavior is exempt (no comms requirement)", () => {
  const c = parseContract(read("clean.md"));
  const b = c.behaviors[0];
  b.platforms = ["server"];        // backend-only behavior
  delete b.commsStates;             // no UI states
  const findings = checkContract(c);
  assert.equal(
    findings.filter((x) => x.critic === "comms-completeness" && x.fragmentRef === b.id).length,
    0,
    "server-only behavior should not require commsStates"
  );
});

test("commsStates: user-facing behavior still requires all four states", () => {
  const c = parseContract(read("clean.md"));
  const b = c.behaviors[0];
  b.platforms = ["web"];
  delete b.commsStates;
  const findings = checkContract(c);
  assert.ok(
    findings.some((x) => x.critic === "comms-completeness" && x.fragmentRef === b.id),
    "user-facing behavior must still require commsStates"
  );
});

test("seeded-gaps: catches behaviors with no AC (B1 and B3)", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const noAcRefs = findings
    .filter((x) => x.message.includes("no acceptance criterion"))
    .map((x) => x.fragmentRef)
    .sort();
  assert.deepEqual(noAcRefs, ["B1", "B3"]);
});

test("seeded-gaps: all findings use only the closed severity enum", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const allowed = new Set(["blocker", "warning", "info"]);
  for (const f of findings) assert.ok(allowed.has(f.severity), `bad severity ${f.severity}`);
});

test("seeded-gaps: readiness is not_ready (has blockers)", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const { readiness, openBlockers, promotable } = computeReadiness(c, findings);
  assert.ok(openBlockers > 0);
  assert.equal(readiness, "not_ready");
  assert.equal(promotable, false); // blockers block promotion
});

// ─── The hard gate is blockers only (anti-stuck) ─────────────────────

const findingsList = (specs) => specs.map((s, i) => ({
  id: `T-${i}`, critic: "edge-cases", severity: s.sev, message: "m",
  suggestion: "s", fragmentRef: "B1", status: s.status || "open",
}));

test("gate: 0 blockers + open warnings is PROMOTABLE (warnings are advisory)", () => {
  const c = parseContract(read("clean.md"));
  const f = findingsList([{ sev: "warning" }, { sev: "warning" }, { sev: "info" }]);
  const r = computeReadiness(c, f);
  assert.equal(r.openBlockers, 0);
  assert.equal(r.promotable, true, "0 blockers should be promotable even with warnings");
  assert.equal(r.readiness, "review_needed"); // warnings still lower the signal
});

test("gate: an open blocker is NOT promotable", () => {
  const c = parseContract(read("clean.md"));
  const r = computeReadiness(c, findingsList([{ sev: "blocker" }]));
  assert.equal(r.promotable, false);
});

test("gate: acknowledged warning drops out of the open counts", () => {
  const c = parseContract(read("clean.md"));
  const f = findingsList([{ sev: "warning", status: "acknowledged" }, { sev: "warning" }]);
  const r = computeReadiness(c, f);
  assert.equal(r.openWarnings, 1, "acknowledged warning is not counted as open");
  assert.equal(r.promotable, true);
});

test("status: validateFindings accepts the acknowledged status", () => {
  const ok = [{ id: "EC-1", critic: "edge-cases", severity: "warning", message: "m", suggestion: "s", fragmentRef: "B1", status: "acknowledged" }];
  assert.equal(validateFindings(ok).length, 0);
});

// ─── Sizing rules ────────────────────────────────────────────────────

test("sizing: 2 platforms escalates to medium", () => {
  const c = parseContract(read("seeded-gaps.md")); // platforms [web, ios]
  const { complexity, reasons } = computeSizing(c);
  assert.equal(complexity, "medium");
  assert.ok(reasons.some((r) => r.includes("platform")));
});

// ─── Model routing (deterministic) ───────────────────────────────────

test("model plan: light critics always run on the fast model", () => {
  const c = parseContract(read("clean.md"));
  const { models } = computeModelPlan(c, computeSizing(c));
  assert.equal(models.minimality, "haiku");
  assert.equal(models["comms-completeness"], "haiku");
});

test("model plan: small contract holds heavy critics on the default model", () => {
  const c = parseContract(read("clean.md")); // sized small
  const plan = computeModelPlan(c, computeSizing(c));
  assert.equal(plan.complexity, "small");
  assert.equal(plan.heavyModel, "sonnet");
  assert.equal(plan.models.security, "sonnet");
  assert.equal(plan.models.regression, "sonnet");
});

test("model plan: large contract escalates heavy critics to the strong model", () => {
  const c = parseContract(read("clean.md"));
  c.frontmatter.touchesAuth = true; // forces sizing → large
  const sizing = computeSizing(c);
  assert.equal(sizing.complexity, "large");
  const plan = computeModelPlan(c, sizing);
  assert.equal(plan.heavyModel, "opus");
  assert.equal(plan.models.security, "opus");
  assert.equal(plan.models.scalability, "opus");
  // light critics never escalate
  assert.equal(plan.models.minimality, "haiku");
});

test("model plan: routing is a pure function of the sizing input (reproducible)", () => {
  const c = parseContract(read("clean.md"));
  const sz = computeSizing(c);
  assert.deepEqual(computeModelPlan(c, sz), computeModelPlan(c, sz));
});

test("model plan: conventions.criticModels override wins", () => {
  const c = parseContract(read("clean.md"));
  const plan = computeModelPlan(c, computeSizing(c), {
    criticModels: { security: "opus", minimality: "sonnet" },
  });
  assert.equal(plan.models.security, "opus");   // overrode the sonnet default
  assert.equal(plan.models.minimality, "sonnet"); // overrode the haiku baseline
});

// ─── Cost observability (deterministic given usage + pricing) ─────────

import { computeCost, normalizeModel } from "../scripts/validate.mjs";

const PRICING = {
  currency: "USD",
  models: {
    haiku: { input: 1, output: 5 },
    sonnet: { input: 3, output: 15 },
    opus: { input: 5, output: 25 },
  },
};

test("normalizeModel maps aliases and full IDs to a pricing family", () => {
  assert.equal(normalizeModel("opus"), "opus");
  assert.equal(normalizeModel("claude-sonnet-4-6"), "sonnet");
  assert.equal(normalizeModel("claude-haiku-4-5"), "haiku");
  assert.equal(normalizeModel("gpt-4"), null);
  assert.equal(normalizeModel(undefined), null);
});

test("computeCost prices input + output per million tokens", () => {
  const usage = {
    byCritic: {
      security: { model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 100_000 },
    },
  };
  const c = computeCost(usage, PRICING);
  // 1M opus input @ $5 + 100k opus output @ $25/M = 5 + 2.5 = 7.5
  assert.equal(c.total, 7.5);
  assert.equal(c.inputTokens, 1_000_000);
  assert.equal(c.outputTokens, 100_000);
});

test("computeCost sums critics + advisor", () => {
  const usage = {
    byCritic: {
      minimality: { model: "haiku", inputTokens: 1_000_000, outputTokens: 0 }, // $1
      "edge-cases": { model: "sonnet", inputTokens: 1_000_000, outputTokens: 0 }, // $3
    },
    advisor: { model: "opus", inputTokens: 1_000_000, outputTokens: 0 }, // $5
  };
  const c = computeCost(usage, PRICING);
  assert.equal(c.total, 9);
  assert.ok(c.byCritic.advisor.priced);
});

test("computeCost flags unpriced models instead of hiding them", () => {
  const usage = { byCritic: { x: { model: "mystery-model", inputTokens: 5000, outputTokens: 5000 } } };
  const c = computeCost(usage, PRICING);
  assert.equal(c.total, 0);
  assert.equal(c.unpricedEntries, 1);
  assert.equal(c.byCritic.x.priced, false);
});

test("computeCost is deterministic given usage + pricing", () => {
  const usage = { byCritic: { security: { model: "opus", inputTokens: 123456, outputTokens: 7890 } } };
  assert.deepEqual(computeCost(usage, PRICING), computeCost(usage, PRICING));
});

// ─── Critic rules digest ↔ validator consistency ─────────────────────
// Critics load the compact CRITIC-RULES.md at run time instead of the full
// protocol. This guards against the digest drifting from what the validator
// actually enforces — if they disagree, critics would emit output the
// validator rejects. So the digest's hard facts must match the code.

import { SEVERITIES as SEV_SET } from "../scripts/validate.mjs";

const RULES = read("../../reference/CRITIC-RULES.md");

test("digest: lists exactly the validator's severity enum", () => {
  for (const s of SEV_SET) assert.ok(RULES.includes(s), `digest missing severity "${s}"`);
  // forbidden severities must be called out as forbidden, not allowed
  assert.ok(/FORBIDDEN/.test(RULES));
  assert.ok(RULES.includes("high") && RULES.includes("medium"));
});

test("digest: carries every canonical critic ID prefix", () => {
  for (const p of ["MIN-", "EC-", "PP-", "INS-", "COMMS-", "PERF-", "RG-", "SEC-", "SC-", "SZ-"])
    assert.ok(RULES.includes(p), `digest missing prefix "${p}"`);
});

test("digest: keeps the 12-finding cap and the core schema fields", () => {
  assert.ok(RULES.includes("12"), "digest dropped the 12-finding cap");
  for (const f of ["severity", "fragmentRef", "suggestion", "status"])
    assert.ok(RULES.includes(f), `digest missing schema field "${f}"`);
});

test("digest: states the advisor blocker constraint", () => {
  assert.ok(/advisorConsulted/.test(RULES));
  assert.ok(/blocker/i.test(RULES));
});

// ─── Bug-pattern catalog (learning loop) ─────────────────────────────

import {
  parseBugPatternIds, nextBugPatternId,
  validateBugPatternEntry, validateBugPatternsDoc,
} from "../scripts/validate.mjs";

const GOOD_ENTRY = `### BP-007 — Example proven pattern

**Where it bites**: something user-visible breaks.
**The shape**:
\`\`\`ts
doThing()
\`\`\`
**Why it slips past basic review**: it's non-obvious.
**The fix**:
\`\`\`ts
if (ok) doThing()
\`\`\`
**Where first observed**: postmortem SC-9
`;

test("bug-patterns: the real catalog is structurally valid", () => {
  const md = read("../../reference/BUG-PATTERNS.md");
  const r = validateBugPatternsDoc(md);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.ok(r.count >= 6);
});

test("bug-patterns: nextBugPatternId increments past the highest id", () => {
  const md = "### BP-001 — a\n### BP-006 — f\n";
  assert.equal(nextBugPatternId(md), "BP-007");
  assert.equal(nextBugPatternId(""), "BP-001");
});

test("bug-patterns: parseBugPatternIds includes struck-through entries", () => {
  const md = "### BP-001 — a\n### ~~BP-002~~ — removed\n### BP-003 — c\n";
  assert.deepEqual(parseBugPatternIds(md), ["BP-001", "BP-002", "BP-003"]);
});

test("bug-patterns: a well-formed entry passes field validation", () => {
  assert.deepEqual(validateBugPatternEntry(GOOD_ENTRY), []);
});

test("bug-patterns: a missing required field is caught", () => {
  const bad = GOOD_ENTRY.replace("**The fix**:", "**Fixaroo**:"); // field marker gone
  const errors = validateBugPatternEntry(bad);
  assert.ok(errors.some((e) => e.includes("The fix")));
});

test("bug-patterns: duplicate and non-monotonic ids are rejected", () => {
  const dup = GOOD_ENTRY + "\n" + GOOD_ENTRY; // BP-007 twice
  const r = validateBugPatternsDoc(dup);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("duplicate")));
});

test("bug-patterns: struck-through entry skips field checks but keeps its id", () => {
  const md = "### ~~BP-007~~ — removed because superseded by BP-003\n\nno fields here\n";
  const r = validateBugPatternsDoc(md);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.count, 1);
});

// ─── Implementer working state (compaction resilience) ───────────────

import { validateImplementState, computeImplementStatus } from "../scripts/validate.mjs";

const STATE = () => ({
  contractId: "SC-5", revision: 2, iteration: 1,
  acStatus: {
    AC1: { status: "done", test: "t.test.ts:9" },
    AC2: { status: "in_progress" },
    AC3: { status: "pending" },
  },
  filesTouched: ["src/a.ts", "tests/a.test.ts"],
});

test("implement-state: a well-formed state validates", () => {
  assert.deepEqual(validateImplementState(STATE()), []);
});

test("implement-state: a bad AC status is rejected", () => {
  const s = STATE(); s.acStatus.AC2.status = "almost";
  const errors = validateImplementState(s);
  assert.ok(errors.some((e) => e.includes("AC2")));
});

test("implement-state: missing contractId / acStatus is caught", () => {
  assert.ok(validateImplementState({}).some((e) => e.includes("contractId")));
  assert.ok(validateImplementState({ contractId: "X" }).some((e) => e.includes("acStatus")));
});

test("implement-status: computes done/remaining and resume buckets", () => {
  const st = computeImplementStatus(STATE());
  assert.equal(st.totalAcs, 3);
  assert.equal(st.done, 1);
  assert.equal(st.remaining, 2);
  assert.deepEqual(st.pending, ["AC3"]);
  assert.deepEqual(st.inProgress, ["AC2"]);
  assert.equal(st.filesTouched, 2);
  assert.equal(st.complete, false);
});

test("implement-status: complete only when every AC is done", () => {
  const s = STATE();
  s.acStatus.AC2.status = "done"; s.acStatus.AC3.status = "done";
  assert.equal(computeImplementStatus(s).complete, true);
});

// ─── Findings schema validation ──────────────────────────────────────

test("schema: rejects out-of-enum severities (high, medium)", () => {
  const bad = [
    { id: "X-1", critic: "regression", severity: "high", message: "m", suggestion: "s", fragmentRef: "B1", status: "open" },
    { id: "X-2", critic: "regression", severity: "medium", message: "m", suggestion: "s", fragmentRef: "B1", status: "open" },
  ];
  const errors = validateFindings(bad);
  assert.equal(errors.length, 2);
  assert.ok(errors[0].includes("invalid severity"));
});

test("schema: accepts valid findings", () => {
  const good = [
    { id: "EC-1", critic: "edge-cases", severity: "blocker", message: "m", suggestion: "s", fragmentRef: "B1", status: "open" },
    { id: "EC-2", critic: "edge-cases", severity: "warning", message: "m", suggestion: "s", fragmentRef: "B2", status: "open" },
    { id: "EC-3", critic: "edge-cases", severity: "info", message: "m", suggestion: "s", fragmentRef: "B3", status: "open" },
  ];
  assert.deepEqual(validateFindings(good), []);
});

test("schema: rejects missing required fields", () => {
  const bad = [{ id: "X-1", critic: "edge-cases", severity: "blocker", status: "open" }];
  const errors = validateFindings(bad);
  assert.ok(errors.some((e) => e.includes("message")));
  assert.ok(errors.some((e) => e.includes("suggestion")));
});

test("advisor: an advisor-influenced blocker is rejected (gate stays deterministic)", () => {
  const bad = [{
    id: "SEC-9", critic: "security", severity: "blocker", message: "m", suggestion: "s",
    fragmentRef: "B1", status: "open", metadata: { advisorConsulted: true },
  }];
  const errors = validateFindings(bad);
  assert.ok(errors.some((e) => e.includes("advisor-influenced finding may not be a blocker")));
});

test("advisor: an advisor-influenced warning/info is allowed", () => {
  const good = [
    { id: "EC-9", critic: "edge-cases", severity: "warning", message: "m", suggestion: "s",
      fragmentRef: "B1", status: "open", metadata: { advisorConsulted: true } },
    { id: "EC-10", critic: "edge-cases", severity: "info", message: "m", suggestion: "s",
      fragmentRef: "B2", status: "open", metadata: { advisorConsulted: true } },
  ];
  assert.deepEqual(validateFindings(good), []);
});

test("advisor: a normal (non-advisor) blocker is still allowed", () => {
  const good = [{ id: "SEC-1", critic: "security", severity: "blocker", message: "m",
    suggestion: "s", fragmentRef: "B1", status: "open" }];
  assert.deepEqual(validateFindings(good), []);
});

test("epic contract skips behavior-level checks", () => {
  const epic = `---
id: EPIC-1
title: Big thing
status: verified
type: epic
complexity: large
platforms: [web, ios]
children: [EPIC-1a, EPIC-1b]
revision: 1
---

## Goal
A decomposed Large contract. Behaviors live in the children.
`;
  const c = parseContract(epic);
  const findings = checkContract(c);
  assert.equal(findings.length, 0, "epic should produce no behavior-level findings");
});

// ─── SLA status ──────────────────────────────────────────────────────

import { slaStatus } from "../scripts/validate.mjs";

const HOUR = 3_600_000;

test("sla: not started when no slaDeadline", () => {
  const s = slaStatus({});
  assert.equal(s.hasSla, false);
  assert.equal(s.state, "none");
});

test("sla: ok with plenty of time left", () => {
  const now = Date.parse("2026-05-20T09:00:00Z");
  const s = slaStatus({ promotedAt: "2026-05-20T08:00:00Z", slaDeadline: "2026-05-21T08:00:00Z" }, now);
  assert.equal(s.state, "ok");
  assert.ok(s.label.includes("left"));
  assert.ok(s.remainingMs > 22 * HOUR);
});

test("sla: warning when under 20% of window remains", () => {
  const now = Date.parse("2026-05-21T05:00:00Z"); // 3h before a 24h-window deadline
  const s = slaStatus({ promotedAt: "2026-05-20T08:00:00Z", slaDeadline: "2026-05-21T08:00:00Z" }, now);
  assert.equal(s.state, "warning");
});

test("sla: overdue when past deadline", () => {
  const now = Date.parse("2026-05-21T10:00:00Z");
  const s = slaStatus({ promotedAt: "2026-05-20T08:00:00Z", slaDeadline: "2026-05-21T08:00:00Z" }, now);
  assert.equal(s.state, "overdue");
  assert.ok(s.label.includes("OVERDUE"));
  assert.ok(s.remainingMs < 0);
});

// ─── Phase derivation + dual-zone time ───────────────────────────────

import { derivePhase, fmtBothZones } from "../scripts/validate.mjs";

test("phase: draft → verify next", () => {
  assert.equal(derivePhase({ id: "X", status: "draft" }).phase, "① Drafting");
});
test("phase: verified Large → decompose next", () => {
  const p = derivePhase({ id: "X", status: "verified", complexity: "large" });
  assert.ok(p.next.includes("decompose"));
});
test("phase: promoted with PR open → in review", () => {
  assert.equal(derivePhase({ id: "X", status: "promoted", prOpenedAt: "t" }).phase, "② In review");
});
test("phase: promoted at 100% → landing window", () => {
  assert.equal(derivePhase({ id: "X", status: "promoted", prodRollout100At: "t" }).phase, "④ Landing window");
});
test("phase: landed", () => {
  assert.equal(derivePhase({ id: "X", landed: true }).phase, "Landed ✅");
});
test("time: shows both IST and UTC", () => {
  const s = fmtBothZones("2026-05-21T08:00:00Z");
  assert.ok(s.includes("13:30 IST"));
  assert.ok(s.includes("08:00 UTC"));
});

// ─── Content-hash cache ──────────────────────────────────────────────

import { cacheStatus, hashOf, PROTOCOL_VERSION } from "../scripts/validate.mjs";

test("cache: stale when no prior findings", () => {
  const c = cacheStatus("sha256:abc", "0.3.0", 1, {});
  assert.equal(c.cached, false);
});

test("cache: cached when hash + versions all match", () => {
  const fm = { verifiedAt: "t", verifiedWith: { contractHash: "sha256:abc", pluginVersion: "0.3.0", protocolVersion: 1 } };
  const c = cacheStatus("sha256:abc", "0.3.0", 1, fm);
  assert.equal(c.cached, true);
});

test("cache: stale when content hash differs", () => {
  const fm = { verifiedWith: { contractHash: "sha256:OLD", pluginVersion: "0.3.0", protocolVersion: 1 } };
  const c = cacheStatus("sha256:NEW", "0.3.0", 1, fm);
  assert.equal(c.cached, false);
  assert.ok(c.reason.includes("content changed"));
});

test("cache: stale when plugin version differs", () => {
  const fm = { verifiedWith: { contractHash: "sha256:abc", pluginVersion: "0.2.0", protocolVersion: 1 } };
  const c = cacheStatus("sha256:abc", "0.3.0", 1, fm);
  assert.equal(c.cached, false);
  assert.ok(c.reason.includes("plugin version"));
});

test("cache: a v1-provenance findings file is stale under protocol v2", () => {
  // Provenance schema bumped to v2 (per-tier models map). Old v1 findings
  // must be re-verified, not reused.
  const fm = { verifiedWith: { contractHash: "sha256:abc", pluginVersion: "0.3.0", protocolVersion: 1 } };
  const c = cacheStatus("sha256:abc", "0.3.0", PROTOCOL_VERSION, fm);
  assert.equal(c.cached, false);
  assert.ok(c.reason.includes("protocol version"));
});

test("cache: current protocol version is 2", () => {
  assert.equal(PROTOCOL_VERSION, 2);
});

test("cache: hashOf is deterministic + content-sensitive", () => {
  assert.equal(hashOf("hello"), hashOf("hello"));
  assert.notEqual(hashOf("hello"), hashOf("hello "));
});

// ─── Incremental re-verify: fragment hashing + rerun plan ────────────

import { fragmentHashes, changedFragments, apiSurfaceHash, rerunPlan } from "../scripts/validate.mjs";

test("fragmentHashes: deterministic for the same contract", () => {
  const a = fragmentHashes(parseContract(read("clean.md")));
  const b = fragmentHashes(parseContract(read("clean.md")));
  assert.deepEqual(a, b);
});

test("fragmentHashes: editing one behavior changes only its hash", () => {
  const c = parseContract(read("clean.md"));
  const before = fragmentHashes(c);
  const id = c.behaviors[0].id;
  c.behaviors[0].perfBudget = { ...(c.behaviors[0].perfBudget || {}), ttiMs: 999999 };
  const after = fragmentHashes(c);
  assert.notEqual(before.behaviors[id], after.behaviors[id], "changed behavior hash must move");
  assert.equal(before.global, after.global, "global must be untouched");
  for (const other of Object.keys(before.behaviors)) {
    if (other !== id) assert.equal(before.behaviors[other], after.behaviors[other]);
  }
});

test("fragmentHashes: editing a global section changes the global hash", () => {
  const raw = read("clean.md");
  const a = fragmentHashes(parseContract(raw));
  const edited = raw.replace(/## Goal\n/, "## Goal\nEDITED CONTEXT LINE.\n");
  const b = fragmentHashes(parseContract(edited));
  assert.notEqual(a.global, b.global);
});

test("changedFragments: detects changed / added / removed / global", () => {
  const prev = { global: "g1", behaviors: { B1: "h1", B2: "h2" } };
  const curr = { global: "g2", behaviors: { B1: "h1", B2: "CHANGED", B3: "new" } };
  const d = changedFragments(prev, curr);
  assert.equal(d.globalChanged, true);
  assert.deepEqual(d.changed, ["B2"]);
  assert.deepEqual(d.added, ["B3"]);
  assert.deepEqual(d.removed, []);
});

test("apiSurfaceHash: moves on event/platform change, stable otherwise", () => {
  const c = parseContract(read("clean.md"));
  const base = apiSurfaceHash(c);
  // A non-surface edit (perf budget) must not move the surface hash.
  c.behaviors[0].perfBudget = { ttiMs: 42 };
  assert.equal(apiSurfaceHash(c), base);
  // An event-name change is a surface change.
  c.behaviors[0].instrumentation = { ...(c.behaviors[0].instrumentation || {}), eventName: "totally_new_event" };
  assert.notEqual(apiSurfaceHash(c), base);
});

test("rerunPlan: first verify (no prior) runs everything + rescans", () => {
  const c = parseContract(read("clean.md"));
  const plan = rerunPlan({}, c);
  assert.equal(plan.firstVerify, true);
  assert.equal(plan.rerunCrossCutting, true);
  assert.equal(plan.regression, "rescan");
});

test("rerunPlan: unchanged contract reuses everything", () => {
  const c = parseContract(read("clean.md"));
  const prevFm = { fragmentHashes: fragmentHashes(c), apiSurfaceHash: apiSurfaceHash(c) };
  const plan = rerunPlan(prevFm, c);
  assert.equal(plan.firstVerify, false);
  assert.equal(plan.rerunCrossCutting, false);
  assert.equal(plan.regression, "reuse");
  assert.deepEqual(plan.localizedBehaviors, []);
});

test("rerunPlan: a non-surface behavior edit scopes localized critics, regression reasons only", () => {
  const c = parseContract(read("clean.md"));
  const prevFm = { fragmentHashes: fragmentHashes(c), apiSurfaceHash: apiSurfaceHash(c) };
  const id = c.behaviors[0].id;
  c.behaviors[0].perfBudget = { ttiMs: 12345 }; // changes fragment, not API surface
  const plan = rerunPlan(prevFm, c);
  assert.deepEqual(plan.localizedBehaviors, [id]);
  assert.equal(plan.rerunCrossCutting, true);
  assert.equal(plan.regression, "reason-only");
});

test("rerunPlan: an API-surface change forces a regression rescan", () => {
  const c = parseContract(read("clean.md"));
  const prevFm = { fragmentHashes: fragmentHashes(c), apiSurfaceHash: apiSurfaceHash(c) };
  c.behaviors[0].instrumentation = { ...(c.behaviors[0].instrumentation || {}), eventName: "changed_event" };
  const plan = rerunPlan(prevFm, c);
  assert.equal(plan.regression, "rescan");
});

// ─── PR-stage code-review findings schema ────────────────────────────

import { validateReviewFindings } from "../scripts/validate.mjs";

const goodReview = () => ([
  {
    id: "CR-001", category: "security", severity: "blocker",
    message: "SQL string built from input", suggestion: "parameterize",
    file: "api/cards.ts", line: 88, status: "open",
  },
  {
    id: "CR-002", category: "correctness", severity: "warning",
    message: "deref of possibly-undefined card", suggestion: "guard card?.last4",
    file: "SavedCardRow.tsx", line: null, status: "open",
  },
]);

test("review: a well-formed findings array passes", () => {
  assert.equal(validateReviewFindings(goodReview()).length, 0);
});

test("review: forbidden severity is rejected", () => {
  const f = goodReview(); f[0].severity = "high";
  const errs = validateReviewFindings(f);
  assert.ok(errs.some((e) => e.includes("invalid severity")));
});

test("review: unknown category is rejected", () => {
  const f = goodReview(); f[0].category = "vibes";
  const errs = validateReviewFindings(f);
  assert.ok(errs.some((e) => e.includes("invalid category")));
});

test("review: id must use CR- prefix", () => {
  const f = goodReview(); f[0].id = "EC-001";
  const errs = validateReviewFindings(f);
  assert.ok(errs.some((e) => e.includes("CR- prefix")));
});

test("review: line must be a number or null", () => {
  const f = goodReview(); f[0].line = "88";
  const errs = validateReviewFindings(f);
  assert.ok(errs.some((e) => e.includes('"line"')));
});

test("review: non-array input is rejected", () => {
  assert.ok(validateReviewFindings({}).length > 0);
});

// ─── rollback-guard verdict schema ───────────────────────────────────

import { validateGuardVerdict } from "../scripts/validate.mjs";

const goodGuard = () => ({
  verdict: "hold",
  reason: "error rate approaching budget at 18% adoption",
  signals: [
    { name: "error-rate", observed: "2.4x", budget: "<=3x", status: "warning" },
    { name: "crash-free", observed: "99.6%", budget: ">=99.0%", status: "ok" },
  ],
  generatedAt: "2026-05-20T10:00:00Z",
});

test("guard: a well-formed verdict passes", () => {
  assert.equal(validateGuardVerdict(goodGuard()).length, 0);
});

test("guard: forbidden verdict value is rejected", () => {
  const v = goodGuard(); v.verdict = "rollback-now";
  const errs = validateGuardVerdict(v);
  assert.ok(errs.some((e) => e.includes("invalid verdict")));
});

test("guard: signals must be an array", () => {
  const v = goodGuard(); v.signals = "lots";
  const errs = validateGuardVerdict(v);
  assert.ok(errs.some((e) => e.includes("signals")));
});

test("guard: bad signal status is rejected", () => {
  const v = goodGuard(); v.signals[0].status = "fine";
  const errs = validateGuardVerdict(v);
  assert.ok(errs.some((e) => e.includes("signal[0]")));
});

test("guard: an array (not object) is rejected", () => {
  assert.ok(validateGuardVerdict([]).length > 0);
});
