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
runs ~2-3. Each critic must return output conforming to the compact
`reference/CRITIC-RULES.md` (which it loads — not the full protocol).

**Keep critic input lean (cuts tokens ×N critics).** Give each critic the
contract's *spec* — frontmatter intent, behaviors, ACs, out-of-scope — and the
deterministic findings it should build on. Do NOT paste the machine provenance
into the prompt: the findings `.json` blocks (hashes, `regressionScan`,
`usage`, `verifiedWith`), the `.qa` sidecar, or prior raw findings dumps —
critics don't read those to do their job, and they multiply input across the
parallel batch. (Don't slice the *behaviors* per critic, though — a critic
needs the whole spec to catch cross-cutting gaps; trim provenance, not content.)

**Narrow the batch with the re-run plan (1b.D).** On a re-verify, only
run the localized critics over `localizedBehaviors`, only re-run the
cross-cutting critics if `rerunCrossCutting`, and follow the plan's
`regression` directive (rescan / reason-only / reuse). Findings you
don't re-run are carried over from the prior `<ID>.findings.json`.

**Model tiering — the validator already decided; just obey it.** Nobody
picks a model by hand. The validator output (step 2) includes a
`modelPlan` computed deterministically from the contract's `sizing`:

```jsonc
"modelPlan": {
  "complexity": "large",
  "heavyModel": "opus",
  "models": {
    "minimality": "haiku", "comms-completeness": "haiku",
    "edge-cases": "sonnet", "instrumentation": "sonnet",
    "perf-budget": "sonnet", "platform-parity": "sonnet",
    "regression": "opus", "security": "opus", "scalability": "opus"
  }
}
```

When you spawn the parallel Task batch, give **each critic the model in
`modelPlan.models[<critic>]`** — don't choose your own. The plan routes
the light critics (`minimality`, `comms-completeness`) to a fast model,
the mid critics to the default, and the heavy critics (`regression`,
`security`, `scalability`) to a strong model **only when the contract is
large/risky** — a trivial fix runs the whole suite cheap; an auth-flow
change across three platforms automatically pulls the strong model onto
the heavy critics, because `sizing` already flagged it. A team can
override any critic with `conventions.criticModels` in `.manifest/repos.yml`
(the validator folds this into `modelPlan` for you).

If the runtime doesn't support per-critic model selection, run them all
on the default model — the tiering is an optimization, not a correctness
requirement, and the deterministic verdict is identical either way.

**Advisor escalation (opt-in, advisory findings only).** If
`conventions.criticAdvisor: true` in `.manifest/repos.yml` AND an advisor
is available, a fast-tier critic may consult the advisor on a *borderline
`warning`/`info`* call — never a blocker (see `CRITIC-PROTOCOL.md` §"Advisor
escalation"). Mark any such finding `metadata.advisorConsulted: true`, and
if the advisor was consulted at all this run, set `advisorConsulted: true`
in the findings `.json` provenance. The validator **rejects** an
advisor-influenced blocker, so the promotability gate stays deterministic.
Default off — when disabled or unavailable, critics run exactly as before.

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

The `.md` frontmatter is **deliberately tiny and human** — only what a
person glancing at the file wants. Do NOT put hashes, scan provenance,
critic lists, or normalization notes here; that machine metadata lives
in the `.json` companion (next). A wall of `sha256:` lines is the first
thing that makes findings feel unreadable — keep it out of the `.md`.

```yaml
---
contractId: <ID>
verifiedAt: <ISO>
pluginVersion: <from plugin.json>
readiness: <verdict>             # not_ready | review_needed | verified
promotable: <true|false>         # the gate that matters (0 open blockers)
openBlockers: <n>
openWarnings: <n>
verifyMode: full                 # full | fast — "fast" is NOT promotable
---
```

All machine provenance — `fragmentHashes`, `apiSurfaceHash`,
`regressionScan` (the incremental/--changed inputs), `verifiedWith`
(the per-tier `models` map + `complexity` + `protocolVersion` +
`contractHash` — copy `models`/`complexity` straight from the validator's
`modelPlan`; see `reference/CRITIC-PROTOCOL.md` for the v2 schema),
`criticsRun`/`criticsSkipped`, and any critic-normalization notes — goes
in `<ID>.findings.json` ONLY. The `--changed` planner and tooling read
the `.json`; the human reads the `.md`.

**Record token usage if the runtime exposes it (observability only).**
When you can see per-critic token counts for the critics you spawned, add
a `usage` block to the `.json` (schema in `CRITIC-PROTOCOL.md` §"Cost /
token usage") — `byCritic[<critic>] = { model, inputTokens, outputTokens }`,
using the model each critic actually ran on (from `modelPlan.models`). This
powers `/manifest cost`. It is **observability, never a gate**: if usage
isn't available, omit the block entirely — the verdict, readiness, and
caching are unaffected. Do NOT let cost data influence findings or the
verdict.

**Write the `.md` for a human, not a machine** — the `.json` companion
(below) carries the machine detail, so the `.md` is plain English and
action-first. Lead with a banner that says whether it's promotable and,
crucially, that the reader edits the *contract*, not this file:

```markdown
# Findings — Saved cards on checkout (SC-005)

**Promotable: ❌ not yet — 2 must-fix items below.**
You fix these by editing the contract (`SC-005.md`), then run
`/contract fix SC-005` (or re-verify). Don't edit this file — it's
regenerated every verify.

## Must fix (blockers)

1. **B2 has no acceptance criterion.** Add a Given/When/Then under
   "Acceptance criteria" that references B2.  _(security · SEC-002)_
2. **The delete-account step doesn't say who's allowed to do it.**
   Spell out auth + ownership in B1's description.  _(security · SEC-003)_

## Worth a look (warnings — optional, won't block)

1. **The error copy "Something went wrong" isn't actionable.** Tell the
   user what to do next.  _(comms · COMMS-007)_ — fix, or `acknowledge`.

## FYI (info)

- Minor: B3's event name could be more specific.  _(instrumentation)_
```

Each item: a plain-English statement of what's wrong + the concrete edit
to make, written so a non-author can act on it. Demote the critic name +
ID to a small trailing tag — don't lead with `EC-024`. Say *where* in
human terms ("under Acceptance criteria", "in B1's description"), not
`fragmentRef: AC3`. Spell out jargon (write "the 50ms responsiveness
budget", not "the p75 ttiMs budget").

**List blockers in full; SUMMARIZE the advisory items.** Blockers are
the must-fix set — show every one with its fix. But don't dump 25
warnings + 26 info as 51 full paragraphs; that's the other half of "hard
to read." For warnings, give a one-line-per-item list grouped by theme;
for info, a one-line count per critic with a pointer ("full text in
`findings.json`"). The human acts on blockers now and skims the rest.

End with a short **"What to do next"** section: the smallest path to
promotable (which edit clears the blocker(s)), then the optional polish.
A convergence line ("blockers: 4 → 1 across runs") is a nice reassurance
that the loop is working — include it when prior findings exist.

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

## Fix mode — `/contract fix <ID>` (the bounded verify→fix loop)

This collapses the slow manual round-trip (verify → "Claude, fix it" →
re-verify → new blocker → repeat) into ONE command. Invoked by
`/contract fix <ID>`. It targets **blockers only** — warnings are
advisory and don't keep the loop running.

Loop:

1. **Verify.** First pass: full. Later passes: incremental (use the
   `--changed` plan against the prior `.findings.json` — re-run only
   changed fragments + cross-cutting critics; reuse the rest).
2. **If 0 open blockers → stop.** Report the promotable contract (plus
   any advisory warnings). Done.
3. **Else apply the fixes — all open blockers in one batch.** Edit the
   contract to resolve each. **Add new fragments COMPLETE:** if a fix
   introduces a behavior/AC, give it every required field at once
   (instrumentation [or `none` for a bug-fix], perfBudget per policy,
   commsStates if user-facing, ≥1 AC) so the next pass does NOT bounce a
   fresh deterministic blocker on the thing you just added. This is the
   #1 cause of "re-verify finds new blockers" — adding incomplete
   fragments — so never do it.
4. **Increment `verifyFixIterations`** in the contract frontmatter.
5. **Loop** from step 1 (incremental). Stop when 0 blockers OR
   `verifyFixIterations >= maxFixIterations` (default 3).
6. **On cap reached with blockers remaining: STOP and escalate to the
   human.** List the unresolved blockers. Looping past the cap means a
   blocker needs a judgment call you shouldn't keep guessing at — don't
   churn.

Rules: only ever *fix* (edit the contract) or, for a finding that's
genuinely wrong, mark it `dismissed` with a reason — never silently
drop. Don't touch warnings unless trivial. The human still reviews the
contract before `/contract promote`; this loop just gets it to
"promotable" without N hand-driven passes. For speed during the loop,
honor `changeType: bug-fix` (lean critic set) and the incremental plan.

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
