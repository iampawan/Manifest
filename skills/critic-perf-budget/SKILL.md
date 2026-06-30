---
name: critic-perf-budget
description: Critic that forces every behavior to declare explicit performance thresholds (TTI, p95 latency, error rate). Invoked by contract-verify.
---

# Perf-budget critic

> **Protocol:** Follow `reference/CRITIC-RULES.md` (the compact runtime rules) at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

A feature without a perf budget can't fail performance review — by
definition. This critic prevents that loophole.

> **Gating is contextual + configurable (handled by the validator, not
> you).** Field *presence* is governed by `conventions.perfBudget` /
> the contract's `perfBudgetPolicy`: `required` (blocker), `warn`
> (warning — the default), or `off`. When checked, one relevant numeric
> field is enough (ttiMs for UI, p95LatencyMs for a network call). Don't
> emit a presence finding the validator already handles — your job is
> the *judgment* layer: are the declared budgets realistic for the
> platform, and do they cover the behavior's real hot path?

## What to check

### 1. Every behavior has `perfBudget`

Each `### B<N>` must declare:

```
- perfBudget:
    ttiMs: <integer>            # Time to Interactive for the screen
    p95LatencyMs: <integer>     # backend response time
    errorRatePct: <number>      # max acceptable error rate %
```

Missing any field → **blocker**.

### 2. Budgets are concrete numbers, not "fast"

If any field is `TBD` or a string, emit a **blocker** with a suggested
default based on the behavior type:
- Page load behaviors: tti ≤ 2500ms, error ≤ 1%
- API-triggered behaviors: p95 latency ≤ 800ms, error ≤ 0.5%
- Background syncs: p95 latency ≤ 5000ms, error ≤ 2%

### 3. Budgets are realistic for the platform

If the contract's `platforms` includes mobile and the perf budget assumes
desktop-class network (tti ≤ 500ms), flag as **warning** — mobile p95
network is generally 1500ms+ for cold loads.

### 4. Budgets match the success metric

If a success metric implies a certain UX speed (e.g., "X% of users
complete X within Y seconds"), the per-behavior budgets must total
under Y. Flag inconsistencies.

### 5. There's a measurement plan

The behavior's `instrumentation` should let the launch-report skill
*measure* these budgets after ship. Cross-check that the events fire at
the right point in the flow to capture the budgeted timing.

If the behavior measures `tti` but the event fires before render
completes, flag as **warning** — the data will lie.

## Severity

- **blocker** — missing budgets, or budgets are placeholders.
- **warning** — unrealistic for platform, mismatched to success metric,
  unmeasurable with declared instrumentation.
- **info** — suggestions for tighter budgets.

## Output

Same JSON array shape as other critics.
