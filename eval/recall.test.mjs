// Unit tests for the deterministic recall scorer (scripts/recall.mjs).
// The scorer is pure code, so these are exact-match and rock-solid even
// though the critics it scores are non-deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scoreRecall } from "../scripts/recall.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "golden", "judgment-gaps.expected.json"), "utf8"));

// A synthetic critic output that catches BOTH required gaps (and one bonus).
const goodActual = () => ([
  { id: "SEC-001", critic: "security", severity: "blocker", message: "B1 delete account has no authorization or re-authentication check", suggestion: "require re-auth", fragmentRef: "B1", status: "open" },
  { id: "EC-001", critic: "edge-cases", severity: "warning", message: "B2 export does not handle a large or repeated request", suggestion: "describe async + retry", fragmentRef: "B2", status: "open" },
  { id: "SC-001", critic: "scalability", severity: "warning", message: "B2 synchronous export is unbounded", suggestion: "use a background job", fragmentRef: "B2", status: "open" },
]);

test("recall: catching all required gaps passes", () => {
  const r = scoreRecall(goodActual(), golden);
  assert.equal(r.ok, true);
  assert.equal(r.required.matched, r.required.total);
  assert.equal(r.required.recall, 1);
  assert.equal(r.schemaErrors.length, 0);
});

test("recall: missing a required gap fails and names the miss", () => {
  const actual = goodActual().filter((f) => f.critic !== "security");
  const r = scoreRecall(actual, golden);
  assert.equal(r.ok, false);
  assert.ok(r.required.recall < 1);
  assert.ok(r.required.missed.some((m) => m.toLowerCase().includes("delete")));
});

test("recall: right critic but too-low severity does not count", () => {
  const actual = goodActual();
  actual[0].severity = "info"; // security finding downgraded below the blocker bar
  const r = scoreRecall(actual, golden);
  assert.equal(r.ok, false);
});

test("recall: right critic but no matching keyword does not count", () => {
  const actual = goodActual();
  actual[0].message = "B1 looks fine to me";
  actual[0].suggestion = "no change";
  const r = scoreRecall(actual, golden);
  assert.equal(r.ok, false);
});

test("recall: forbidden severity is a schema error", () => {
  const actual = goodActual();
  actual.push({ id: "X", critic: "security", severity: "high", message: "x", suggestion: "y", fragmentRef: "B1", status: "open" });
  const r = scoreRecall(actual, golden);
  assert.equal(r.ok, false);
  assert.ok(r.schemaErrors.some((e) => e.includes("forbidden severity")));
});

test("recall: bonus misses are reported but do not fail the run", () => {
  const r = scoreRecall(goodActual(), golden);
  assert.equal(r.ok, true);
  assert.ok(r.bonus.total >= 1);
  assert.ok(r.bonus.missed.length >= 1); // we didn't supply every bonus finding
});

test("recall: non-array actual is a schema error", () => {
  const r = scoreRecall({}, golden);
  assert.equal(r.ok, false);
  assert.ok(r.schemaErrors.length > 0);
});
