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

// ─── Stability / variance across repeated runs ───────────────────────
// scoreRecall scores ONE run against golden. But the thing that erodes
// trust is run-to-run *variance* on the judgment layer — a required gap
// that's caught 5/5 times is stable; one caught 3/5 is flaky, and flaky
// is exactly the risk introduced by routing critics to different models
// per tier. This scores N runs of the SAME fixture and surfaces which
// required gaps flap. Pure + deterministic given (runs, golden), so it's
// unit-testable (eval/recall.test.mjs) even though the runs that feed it
// are the non-deterministic part.

function stdev(xs) {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

// runs: array of findings arrays (one per repeated LLM run on the fixture).
// Returns per-gap hit rates, per-run required recall, variance stats, and a
// flaky list. `ok` is false if any required gap's hit rate is below the
// stability threshold, or any run leaked a forbidden severity.
export function scoreStability(runs, golden) {
  if (!Array.isArray(runs) || runs.length === 0)
    return { ok: false, schemaErrors: ["no runs provided"], runs: 0 };

  const expected = golden.expected || [];
  const required = expected.filter((e) => e.required);
  // Default: every required gap must be caught in EVERY run (hit rate 1.0).
  // A golden file can relax this with `stabilityThreshold` (e.g. 0.8).
  const threshold = golden.stabilityThreshold ?? 1.0;

  const schemaErrors = [];
  runs.forEach((run, i) => {
    if (!Array.isArray(run)) { schemaErrors.push(`run[${i}] is not an array`); return; }
    run.forEach((f, j) => {
      if (!f || typeof f !== "object") { schemaErrors.push(`run[${i}][${j}] not an object`); return; }
      if (!(f.severity in SEV_RANK)) schemaErrors.push(`run[${i}][${j}] forbidden severity "${f.severity}"`);
    });
  });

  const validRuns = runs.filter(Array.isArray);
  const perGap = required.map((e) => {
    const hits = validRuns.filter((run) => isMatched(e, run)).length;
    const hitRate = validRuns.length ? hits / validRuns.length : 0;
    return { gap: e.gap, critic: e.critic, hits, runs: validRuns.length,
             hitRate, flaky: hitRate > 0 && hitRate < 1 };
  });

  const requiredRecallPerRun = validRuns.map((run) => {
    if (required.length === 0) return 1;
    return required.filter((e) => isMatched(e, run)).length / required.length;
  });

  const flakyRequiredGaps = perGap.filter((g) => g.hitRate < threshold).map((g) => g.gap);
  const ok = schemaErrors.length === 0 && flakyRequiredGaps.length === 0;

  return {
    ok,
    schemaErrors,
    runs: validRuns.length,
    stabilityThreshold: threshold,
    minRequiredRecall: requiredRecallPerRun.length ? Math.min(...requiredRecallPerRun) : 1,
    meanRequiredRecall: requiredRecallPerRun.length
      ? requiredRecallPerRun.reduce((a, b) => a + b, 0) / requiredRecallPerRun.length : 1,
    stdevRequiredRecall: stdev(requiredRecallPerRun),
    requiredRecallPerRun,
    perGap,
    flakyRequiredGaps,
  };
}

function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === "--stability") {
    // recall.mjs --stability <golden.json> <run1.json> <run2.json> ...
    const [goldenPath, ...runPaths] = argv.slice(1);
    if (!goldenPath || runPaths.length === 0) {
      console.error("usage: recall.mjs --stability <golden.json> <run1.json> [run2.json ...]");
      process.exit(1);
    }
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    const runs = runPaths.map((p) => JSON.parse(readFileSync(p, "utf8")));
    const r = scoreStability(runs, golden);
    console.log(JSON.stringify(r, null, 2));
    if (r.schemaErrors.length) process.exit(1);
    process.exit(r.ok ? 0 : 4);
  }

  const [actualPath, goldenPath] = argv;
  if (!actualPath || !goldenPath) {
    console.error("usage: recall.mjs <actual-findings.json> <golden.expected.json>");
    console.error("       recall.mjs --stability <golden.json> <run1.json> [run2.json ...]");
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
