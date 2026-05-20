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
already `promoted`, refuse. Set status to `verifying`.

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

### 3. Run ONLY the judgment critics

The deterministic layer already covered field presence, AC coverage,
sizing, and platform-subset checks. Do NOT re-run those as LLM critics.
Spawn sub-agents (one Task batch, parallel) ONLY for the critics that
require reasoning:

- critic-edge-cases — missing scenarios
- critic-security — auth/PII/injection reasoning
- critic-scalability — N+1, growth, hot-path reasoning
- critic-regression — cross-repo conflict analysis (reads code)
- critic-instrumentation — *judgment only*: event naming quality,
  collision risk (NOT "is the field present" — validator did that)
- critic-comms-completeness — *judgment only*: is the error copy
  actionable, on-brand (NOT "is the field present")
- critic-perf-budget — *judgment only*: are the budgets realistic
  (NOT "is the field present")
- critic-platform-parity — *judgment only*: is the platform-specific
  UX actually described (NOT "is platforms ⊆ contract.platforms")

Each critic must return output conforming to `reference/CRITIC-PROTOCOL.md`.

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
