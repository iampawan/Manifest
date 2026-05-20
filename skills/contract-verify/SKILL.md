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

Read `.shipline/contracts/<ID>.md`. If it doesn't exist or status is
already `promoted`, refuse.

### 1b. Cache check — skip the expensive critics if nothing changed

Before doing any work, check whether a prior verify still applies:

```bash
node <plugin-root>/scripts/validate.mjs --cache-check .shipline/contracts/<ID>.md
```

- **Exit 0 (cached)** — the contract content, plugin version, and
  protocol version are unchanged since the last verify. The existing
  `.findings.md` is still valid. **Skip the critics entirely** and tell
  the user: "Nothing changed since the last verify (<reason>). Reusing
  findings from <timestamp>. Run `/contract verify <ID> --force` to
  re-verify anyway." This saves the full LLM critic cost on no-op
  re-runs (CI re-runs, habit re-runs, iterating on other files).
- **Exit 1 (stale)** — content or version changed. Proceed to a full
  verify.

If the user passed `--force`, skip this cache check and always run a
full verify.

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
node <plugin-root>/scripts/validate.mjs .shipline/contracts/<ID>.md
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
| critic-edge-cases | ALWAYS |
| critic-regression | ALWAYS (every change can conflict with shipped code) |
| critic-security | ALWAYS, unless the change is purely cosmetic (copy/CSS) with no data, auth, or input handling |
| critic-instrumentation | only if the contract declares success metrics or new events (there's something to evaluate) |
| critic-comms-completeness | only if behaviors are user-facing (skip for pure backend/server contracts) |
| critic-platform-parity | only if `contract.platforms` has MORE THAN ONE platform |
| critic-scalability | only if behaviors touch data, server, or backend (skip pure client-UI changes) |
| critic-perf-budget | only if a behavior sets a non-default perf budget OR touches a known hot path (the validator already enforced presence + stack defaults) |

Spawn the selected critics as sub-agents in ONE parallel Task batch.
A single-platform web feature typically runs ~5 critics; a backend
change runs a different ~5; a copy tweak that somehow reached a
contract runs ~3. Each critic must return output conforming to
`reference/CRITIC-PROTOCOL.md`.

State which critics you ran and which you skipped (and why) in the
findings file, so the verdict is transparent.

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

Sizing comes from the validator's `sizing` field. If a security blocker
exists in the judgment findings, sizing escalates per the validator's
rules (re-run sizing logic with the judgment findings if needed).

### 6. Write the findings file

`.shipline/contracts/<ID>.findings.md` with frontmatter recording
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
---
```

Sections: Open blockers / Warnings / Info. Each finding shows its
`source` (contract-only = deterministic, github-mcp/local-clone =
judgment-with-code-reading).

### 7. Update the contract and report

Set `status` (verified or back to draft), `complexity`. Tell the user
the verdict, finding counts by severity, and the next step.

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
