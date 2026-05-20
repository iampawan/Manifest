#!/usr/bin/env node
// Deterministic recall scorer for the judgment critics.
//
// The critics are LLM calls — non-deterministic — so we can't unit-test
// their output the way we test validate.mjs. Instead we separate the two
// halves:
//
//   1. The LLM run (in CI, with creds) produces a findings array for a
//      fixed fixture (eval/contracts/judgment-gaps.md).
//   2. THIS scorer is pure code: given that findings array and the golden
//      expected file, it computes recall deterministically and fails if a
//      load-bearing ("required") gap was missed or a forbidden severity
//      leaked through.
//
// That makes the scoring reproducible and unit-testable (eval/recall.test.mjs),
// while the LLM run is the only non-deterministic part. A drop in recall on
// the golden set fails the build — the drift defense RELIABILITY.md #2 asks for.
//
// Usage:
//   node recall.mjs <actual-findings.json> <golden.expected.json>
// Exit: 0 = pass, 1 = bad input/schema, 4 = recall below threshold.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEV_RANK = { info: 1, warning: 2, blocker: 3 };

function meetsSeverity(actual, min) {
  return (SEV_RANK[actual] || 0) >= (SEV_RANK[min] || 0);
}

// Does any actual finding satisfy this expected gap?
function isMatched(expected, actual) {
  const terms = (expected.anyOf || []).map((t) => t.toLowerCase());
  return actual.some((f) => {
    if (f.critic !== expected.critic) return false;
    if (!meetsSeverity(f.severity, expected.minSeverity)) return false;
    const hay = `${f.message || ""} ${f.suggestion || ""}`.toLowerCase();
    return terms.length === 0 || terms.some((t) => hay.includes(t));
  });
}

// Pure scoring function — the unit-tested core.
export function scoreRecall(actual, golden) {
  const schemaErrors = [];
  if (!Array.isArray(actual)) return { ok: false, schemaErrors: ["actual findings is not an array"] };
  actual.forEach((f, i) => {
    if (!f || typeof f !== "object") { schemaErrors.push(`[${i}] not an object`); return; }
    if (!(f.severity in SEV_RANK))
      schemaErrors.push(`[${i}] forbidden severity "${f.severity}"`);
  });

  const expected = golden.expected || [];
  const required = expected.filter((e) => e.required);
  const bonus = expected.filter((e) => !e.required);

  const evaluate = (list) =>
    list.map((e) => ({ gap: e.gap, critic: e.critic, matched: isMatched(e, actual) }));

  const reqResults = evaluate(required);
  const bonusResults = evaluate(bonus);

  const reqMatched = reqResults.filter((r) => r.matched).length;
  const reqRecall = required.length ? reqMatched / required.length : 1;
  const threshold = golden.requiredRecallThreshold ?? 1.0;

  const ok = schemaErrors.length === 0 && reqRecall >= threshold;

  return {
    ok,
    schemaErrors,
    threshold,
    required: {
      total: required.length,
      matched: reqMatched,
      recall: reqRecall,
      missed: reqResults.filter((r) => !r.matched).map((r) => r.gap),
    },
    bonus: {
      total: bonus.length,
      matched: bonusResults.filter((r) => r.matched).length,
      missed: bonusResults.filter((r) => !r.matched).map((r) => r.gap),
    },
  };
}

function main() {
  const [actualPath, goldenPath] = process.argv.slice(2);
  if (!actualPath || !goldenPath) {
    console.error("usage: recall.mjs <actual-findings.json> <golden.expected.json>");
    process.exit(1);
  }
  const actual = JSON.parse(readFileSync(actualPath, "utf8"));
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const r = scoreRecall(actual, golden);
  console.log(JSON.stringify(r, null, 2));
  if (r.schemaErrors.length) process.exit(1);
  process.exit(r.ok ? 0 : 4);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
