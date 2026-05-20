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
