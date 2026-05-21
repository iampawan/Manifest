---
name: contract-verify
description: Verify a contract using a two-layer approach — a deterministic code validator first, then LLM judgment critics. Produces a consolidated findings file with a computed readiness verdict. Use when the user says "verify contract", "check this PRD", "run critics", or invokes `/contract verify <ID>`.
---

# Contract verifier (orchestrator)

Verification runs in two layers. The deterministic layer (code) handles
everything mechanically checkable — reproducible, free, no LLM variance.
The judgment layer (LLM critics) handles only what genuinely needs
reasoning. Readiness is computed by code, not judged.

Follow `reference/CRITIC-PROTOCOL.md` for severity definitions and output schema.

## Inputs

A contract ID (e.g., `SC-005`) or path.

## Process

### 1. Read and guard

Read `.manifest/contracts/<ID>.md`. If it doesn't exist or status is
already `promoted`, refuse.

### 1b. Decide how much to re-run — speed comes from doing less

Most of the wall-clock is the LLM critics (the deterministic validator
is <1s). So before running anything, figure out the *smallest correct*
set of critics to run. Four modes, in priority order:

**A. `--force`** → skip all caching, run a full verify (every relevant
critic, full regression scan). Use when in doubt.

**B. `--fast` (fast-iteration mode)** → run ONLY `critic-edge-cases` and
`critic-security`, and tell regression to **reuse** (no repo scan). This
is the quick draft-loop verdict. Stamp `verifyMode: fast` in the
findings frontmatter. **A `--fast` verify is not promotable** — a full
verify must run before promote (contract-promote enforces this). Tell
the user: "Fast verify — ran edge-cases + security only. Run
`/contract verify <ID>` (full) before promoting."

**C. No-op cache** → if not fast/force, check whether anything changed:

```bash
node <plugin-root>/scripts/validate.mjs --cache-check .manifest/contracts/<ID>.md
```

Exit 0 (cached): content + plugin + protocol versions unchanged. Reuse
`.findings.md` wholesale, skip every critic, tell the user it's reused.
Exit 1 (stale): go to D.

**D. Incremental re-verify (the common edit→reverify case)** → ask the
validator which fragments changed since the last findings:

```bash
node <plugin-root>/scripts/validate.mjs --changed .manifest/contracts/<ID>.md \
  .manifest/contracts/<ID>.findings.json
```

This prints a plan:
- `localizedBehaviors` — re-run the **localized** critics
  (`comms-completeness`, `perf-budget`, `platform-parity`,
  `instrumentation`) ONLY over these behaviors. Reuse the prior findings
  (from `<ID>.findings.json`) for all other behaviors — filter them by
  `fragmentRef`.
- `rerunCrossCutting` — if true, re-run the cross-cutting critics
  (`edge-cases`, `security`, `scalability`); if false, reuse their prior
  findings unchanged.
- `regression` — `rescan` (API surface changed → full repo scan),
  `reason-only` (surface unchanged but something moved → reuse the
  cached scan results, just re-reason over them), or `reuse` (nothing
  relevant moved → keep prior regression findings).

Carry `currFragmentHashes` and `currApiSurfaceHash` from the plan into
the new findings frontmatter (step 6) so the next re-verify can diff
against them.

Reusing prior findings for unchanged fragments is what makes re-verify
fast: a one-behavior copy edit re-runs comms-completeness over one
behavior and reuses everything else, instead of re-running the whole
suite.

**Advisory lock check.** If the contract's `lockedBy` is someone other
than the current user AND `lockedAt` is recent (< 2h), warn: "⚠️
<lockedBy> took a lock on this contract <relative time> ago — they may
be mid-edit. Coordinate before proceeding, or continue if you know
it's free." This is advisory (git is the real arbiter); don't
hard-block. Then set `lockedBy`/`lockedAt` to the current user, and
clear them when verify completes.

Then set status to `verifying`.

### 2. Run the deterministic validator FIRST

Run the code validator via Bash:

```bash
node <plugin-root>/scripts/validate.mjs .manifest/contracts/<ID>.md
```

This returns JSON with:
- `deterministicFindings` — missing instrumentation, missing perf
  budgets, missing comms states, missing ACs, platform mismatches.
  These are FACTS, not judgments. 100% reproducible.
- `sizing` — the small/medium/large computation (fully deterministic).
- `readiness` — the computed verdict.
- `contractHash` — hash of the contract content verified.

If the validator exits 2 (parse/input error), STOP and report the
error — do not proceed to LLM critics against an unparseable contract.

### 3. Select and run ONLY the relevant judgment critics

The deterministic layer already covered field presence, AC coverage,
sizing, and platform-subset checks. Do NOT re-run those as LLM critics.
(There is no `critic-sizing` skill anymore — sizing is fully in the
validator.)

**Select critics by relevance — don't run all of them every time.**
Running irrelevant critics wastes tokens and adds noise. Choose based
on the contract:

| Critic | Run when |
|---|---|
| critic-minimality | ALWAYS — pushes back on disproportionate scope |
| critic-edge-cases | ALWAYS |
| critic-regression | ALWAYS (every change can conflict with shipped code) |
| critic-security | ALWAYS, unless the change is purely cosmetic (copy/CSS) with no data, auth, or input handling |
| critic-instrumentation | only if the contract declares success metrics or new events (there's something to evaluate) |
| critic-comms-completeness | only if behaviors are user-facing (skip for pure backend/server contracts) |
| critic-platform-parity | only if `contract.platforms` has MORE THAN ONE platform |
| critic-scalability | only if behaviors touch data, server, or backend (skip pure client-UI changes) |
| critic-perf-budget | only if a behavior sets a non-default perf budget OR touches a known hot path (the validator already enforced presence + stack defaults) |

**`changeType: bug-fix` runs LEAN — this is the main lever against
over-engineering a small bug.** When the contract's frontmatter has
`changeType: bug-fix`, override the table:

- **Run only**: `minimality`, `edge-cases` (scoped to the bug's actual
  surface — do NOT enumerate IME / SSR / full-Unicode / drag-drop unless
  one of those IS the bug), `regression`, and `security` *only if* the
  fix touches auth/data/input.
- **Do NOT run** `instrumentation` — a bug fix needs no new analytics
  event; `instrumentation: none` is fine. Do not demand a success metric
  or a shadow-observation baseline; the bug's "metric" is the regression
  test.
- **`comms-completeness`** checks only the copy that's actually changing.
- Everything else (platform-parity, scalability, perf-budget judgment)
  runs only if obviously relevant — default off for a bug fix.

The goal: a one-line bug ("disable the button when the field is empty")
verifies against ~2-3 scoped critics, not a feature's full suite. If a
"bug fix" genuinely needs new instrumentation/flags/platforms, it's a
feature — flip `changeType` and treat it as one.

Spawn the selected critics as sub-agents in ONE parallel Task batch.
A single-platform web feature typically runs ~5-6 critics; a bug fix
runs ~2-3. Each critic must return output conforming to
`reference/CRITIC-PROTOCOL.md`.

**Narrow the batch with the re-run plan (1b.D).** On a re-verify, only
run the localized critics over `localizedBehaviors`, only re-run the
cross-cutting critics if `rerunCrossCutting`, and follow the plan's
`regression` directive (rescan / reason-only / reuse). Findings you
don't re-run are carried over from the prior `<ID>.findings.json`.

**Model tiering (latency + cost).** Assign models per critic:
- **Strong model** for the heavy reasoning: `edge-cases`, `security`,
  `regression`, `scalability`.
- **Fast model** for the lighter, pattern-style critics:
  `comms-completeness`, `instrumentation`, `perf-budget`,
  `platform-parity`.
A team can override the mapping with `conventions.criticModels` in
`repos.yml`. (If the runtime doesn't support per-critic model
selection, run them all on the default model — the tiering is an
optimization, not a correctness requirement.)

State which critics you ran, which you reused, and which you skipped
(and why) in the findings file, so the verdict is transparent.

### 4. Validate critic output against the schema

For each critic's JSON output, validate it:

```bash
echo '<critic-output>' > /tmp/findings.json
node <plugin-root>/scripts/validate.mjs --check-findings /tmp/findings.json
```

If validation fails (e.g., a critic emitted severity "high"), the run
FAILS LOUD. Do not silently normalize — report which critic produced
invalid output so the prompt can be fixed. A critic that can't follow
the schema is a bug.

### 5. Merge and compute readiness

Combine `deterministicFindings` + validated judgment findings.
Deduplicate by `(critic + fragmentRef + message)`. The readiness verdict
comes from the validator's `readiness` field recomputed over the merged
set — NOT from LLM judgment. Apply:
- `not_ready` if any open blocker
- `verified` if 0 blockers, 0 warnings, confidence ≥ 0.8
- `review_needed` otherwise

**The gate that matters is `promotable` (0 open blockers), not
`verified`.** Blockers are the finite, stable set a dev must clear;
warnings/info are advisory and never block promotion (see
[Anti-stuck](#why-this-doesnt-become-endless)). When you report the
verdict, lead with promotable, then list blockers (must-fix) separately
from warnings (advisory). A finding the human reviews and accepts is
marked `acknowledged` (not `open`), so it drops out of the counts and
never re-litigates. Carry forward `acknowledged`/`dismissed` statuses
from the prior `.findings.json` when you merge — don't reset them.

Sizing comes from the validator's `sizing` field. If a security blocker
exists in the judgment findings, sizing escalates per the validator's
rules (re-run sizing logic with the judgment findings if needed).

### 6. Write the findings file

`.manifest/contracts/<ID>.findings.md` with frontmatter recording
provenance per `reference/CRITIC-PROTOCOL.md`:

```yaml
---
contractId: <ID>
verifiedAt: <ISO>
verifiedWith:
  pluginVersion: <from plugin.json>
  model: <the model running this>
  protocolVersion: 1
  contractHash: <from validator>
readiness: <verdict>
verifyMode: full                 # full | fast — "fast" is NOT promotable
# Incremental-verify provenance — the next re-verify diffs against these.
fragmentHashes: <currFragmentHashes from the --changed plan>
apiSurfaceHash: <currApiSurfaceHash from the --changed plan>
regressionScan:                  # so regression can reuse its repo scan
  apiSurfaceHash: <same as above>
  scannedAt: <ISO of the last actual repo scan>
  repoHeads: { <repo>: <sha>, ... }   # head SHAs of repos scanned
---
```

Sections: Open blockers / Warnings / Info. Each finding shows its
`source` (contract-only = deterministic, github-mcp/local-clone =
judgment-with-code-reading).

Also write `.manifest/contracts/<ID>.findings.json` — the merged
findings array (deterministic + judgment), exactly the JSON the critics
returned, schema-validated by `--check-findings`. This machine-readable
companion is what the recall harness (`scripts/recall.mjs`), the
incremental `--changed` planner, and other tooling read; the `.md` file
is the human view. **Carry `fragmentHashes` and `apiSurfaceHash` into
this JSON's top-level fields too**, so `--changed` can diff against the
prior run.

### 7. Update the contract and report

Set `status` and `complexity`. Lead the report with the gate that
matters:

```
Promotable: ✅ yes (0 blockers)   ·   readiness: review_needed
Blockers: 0
Warnings: 3 (advisory — fix, or `acknowledge` to put to rest)
Info: 5
Next: promote now, or address warnings first — your call.
```

If there are open blockers, say "Not promotable — N blockers to fix"
and list them; those are the finite, stable must-fix set. If 0 blockers,
say it's promotable even when warnings remain — don't imply the dev must
drive warnings to zero.

## Why this doesn't become endless

The deterministic findings are stable and converge to zero. The LLM
judgment findings vary run-to-run — so the gate is **blockers only**
(`promotable`), not every finding:

- **Blockers** (deterministic facts + serious judgment issues) are the
  finite set you must clear. They don't flip-flop.
- **Warnings / info** are advisory. They never block promotion. Fix them
  if you want, or mark `acknowledged` to put one to rest — an
  acknowledged finding isn't `open`, so it drops out of the gate and
  won't resurface.
- **Caching + incremental re-verify** mean unchanged content reuses
  prior findings — re-verifying without editing doesn't invent new
  issues, and editing one behavior only re-checks that behavior.
- **Don't `--force` re-verify to chase nits** — that's the only way to
  deliberately re-roll judgment variance. Use the normal re-verify.

So the loop converges: blockers → 0 (stable), warnings → fixed or
acknowledged (don't resurface), unchanged content → no fresh noise.

## Why this split matters

- **Determinism**: the deterministic findings are identical every run.
  Only the judgment findings vary, and their schema is validated.
- **Cost**: 8 of the old checks were partly mechanical. Moving the
  mechanical parts to code means the LLM critics do less work — fewer
  tokens per run.
- **Trust**: a `not_ready` verdict from a missing-instrumentation
  blocker is a fact the validator proves, not an LLM opinion.

## Anti-patterns

- Don't run LLM critics for checks the validator already did.
- Don't proceed past a validator parse error.
- Don't silently fix invalid critic output — fail loud, fix the prompt.
- Don't let an LLM compute the readiness verdict — that's the
  validator's job.
