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

test("seeded-gaps: catches missing perfBudget on B2", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const f = findings.find(
    (x) => x.critic === "perf-budget" && x.fragmentRef === "B2"
  );
  assert.ok(f, "expected a missing-perfBudget blocker on B2");
  assert.equal(f.severity, "blocker");
});

test("seeded-gaps: catches missing comms states on B2", () => {
  const c = parseContract(read("seeded-gaps.md"));
  const findings = checkContract(c);
  const f = findings.find(
    (x) => x.critic === "comms-completeness" && x.fragmentRef === "B2"
  );
  assert.ok(f, "expected a missing-comms blocker on B2");
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
  const { readiness, openBlockers } = computeReadiness(c, findings);
  assert.ok(openBlockers > 0);
  assert.equal(readiness, "not_ready");
});

// ─── Sizing rules ────────────────────────────────────────────────────

test("sizing: 2 platforms escalates to medium", () => {
  const c = parseContract(read("seeded-gaps.md")); // platforms [web, ios]
  const { complexity, reasons } = computeSizing(c);
  assert.equal(complexity, "medium");
  assert.ok(reasons.some((r) => r.includes("platform")));
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

import { cacheStatus, hashOf } from "../scripts/validate.mjs";

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

test("cache: hashOf is deterministic + content-sensitive", () => {
  assert.equal(hashOf("hello"), hashOf("hello"));
  assert.notEqual(hashOf("hello"), hashOf("hello "));
});
