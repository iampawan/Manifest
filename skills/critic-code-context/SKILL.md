---
name: critic-code-context
description: Dev-side critic for the pickup flow. Surfaces auto-fillable defaults the agent can pull straight from the repo + history (Bucket A in contract-pickup), and code-context dev-decides items where engineering judgment is needed (Bucket B). Different from critic-regression — that one flags *risks*; this one proposes *answers*. Invoked by contract-pickup as part of the parallel critic batch.
---

# Code-context critic

> **Protocol:** Follow `reference/CRITIC-PROTOCOL.md` at the plugin root for
> severity definitions, output JSON schema, ID prefixes, and shared
> anti-patterns. This critic uses two non-standard tags in its output —
> `bucket: "A"` (auto-fill) or `bucket: "B"` (dev-decides) — which the
> `contract-pickup` skill consumes. Any finding without a bucket tag defaults
> to the standard severity-based handling.

You are the dev's research assistant. Other critics tell the dev what's
*wrong* with the contract; you tell them what the right *answer* probably
is, sourced from the codebase and the project's history. The pickup flow
uses your output to fill in the parts of the contract the PM left blank,
without having to ask anyone.

The PM-side critics (edge-cases, security, etc.) treat the contract in
isolation. You treat the contract as one feature in a living codebase
with shipped history, ongoing work, and conventions the dev already
follows.

## Inputs

- The draft contract.
- `.manifest/repos.yml` (target repos).
- The codebase analysis cache (`.manifest/.cache/code-context.json` if
  present; rebuild via `scripts/build-code-context.mjs` — TBD). If cache
  is missing or older than `pickup.cacheTTL`, rebuild on the fly with a
  warning that this pickup will be slower.

## What the cache contains

The cache is the precomputed answer-source for Bucket A. It's not exotic;
it's mostly grep + parse, run nightly:

```yaml
events:              # for `instrumentation` auto-fill
  catalog:           # known event names + their payload shapes
    - name: filter_applied
      file: src/analytics/events.ts:42
      payload: { surface, filter_type, filter_value }
    - ...
  naming_patterns:   # snake_case verb_noun, etc.
    convention: snake_case
    examples: [ "search_performed", "filter_applied" ]

i18n:                # for `commsStates` auto-fill
  - key: search.no_results
    file: i18n/en.json:18
    value: "No results — try fewer filters."
  - ...

stack_defaults:      # from STACK-PROFILES.md
  perf_budget_ms:
    web: 50
    flutter: 80
  comms_states_required: [ idle, loading, success, error, empty ]

similar_contracts:   # for AC pattern reuse
  - id: SC-088
    surface: search.filters
    landed: true
    behaviors:
      - id: B3
        title: "Combined date + category filter"
        acceptance_criteria_text: "..."

surface_index:       # which files belong to which feature surface
  search.filters:
    - src/search/filters/
    - src/components/FilterChip.tsx
    - cypress/search/filters/

dependencies:        # cross-feature touchpoints
  - feature: search.filters
    touches:
      - flag: experiments.saved_filters
      - module: src/storage/preferences.ts (shared with saved-filters)
      - api: /v2/search (50ms p95 budget)

history:             # rolled-back / partial contracts on this surface
  - id: SC-103
    landed: rolled-back
    reason: "memory leak in chip rendering"
    file_culprit: src/components/LegacyChip.tsx
```

The cache is the slow part; building it nightly means every pickup is
sub-second on the lookup side.

## What you look for

For each contract behavior + each missing field in the contract,
ask: *can I propose a confident answer from the codebase?*

### Auto-fill candidates (Bucket A)

**Tag every finding here with `bucket: "A"` and severity `info` (auto-fills
are never blockers; they're proposals the dev accepts or overrides).**

Per behavior, check whether the contract is missing any of:

| Missing field | What to look up | What to propose |
|---|---|---|
| `instrumentation` | events catalog | nearest matching event name from `naming_patterns`, with payload shape from a similar event |
| `perfBudget` | stack defaults | `perf_budget_ms[<platform>]` from `stack_defaults` |
| `commsStates` | i18n catalog | the existing keys for similar surfaces; flag missing ones |
| acceptance criterion | `similar_contracts` | draft AC text adapted from a landed contract's AC on the same surface |
| empty-state copy, error copy | i18n catalog | existing key if there's a near-match; flag for net-new copy if not |

Each finding's body must include:

```json
{
  "bucket": "A",
  "field": "<contract field path, e.g. behaviors.B2.instrumentation>",
  "proposal": "<the actual value to fill in>",
  "source": "<file:line OR contract-ID#fragment>",
  "rationale": "<one-line why this is the right default>"
}
```

The pickup skill renders these one per line with an [Accept] button.

### Dev-decides items (Bucket B)

**Tag with `bucket: "B"` and severity `warning` (these don't block, but the
dev shouldn't start until they've answered).**

Look for things where the codebase + history reveal a question that
requires engineering judgment:

- **Past rolled-back / partial contracts on the same surface.** If
  `history` contains a `landed: rolled-back` contract on this surface
  area, surface it: "SC-103 hit a memory leak; reuse the new pattern
  from SC-X?"
- **Active concurrent work.** Open PRs touching the same files (via
  GitHub MCP). "PR #4421 also touches `src/search/filters/`. Conflict
  risk — coordinate?"
- **Dependency budgets.** If a behavior touches an endpoint with a tight
  budget (`api: /v2/search (50ms p95 budget)`) and the behavior likely
  adds work, surface it.
- **Shared modules.** If the surface touches a module shared with another
  in-flight feature (`module: ... (shared with saved-filters)`), surface
  the coordination ask.
- **Locale / device / segment branches.** If the affected files contain
  `if (locale === ...)`, `if (Platform.isLowEnd)`, etc., and the contract
  doesn't address it, ask the dev: "the codebase has a low-bandwidth
  render path on this surface — should the new feature support it?"

Each finding includes:

```json
{
  "bucket": "B",
  "scope": "<behavior ID or 'contract'>",
  "question": "<the dev-facing question>",
  "context": "<the file/PR/contract reference that triggered this>",
  "options": ["<suggested answers if any>"]
}
```

### What goes to Bucket C

**Bucket C (only PM can answer) is NOT produced by this critic.** That
bucket is populated by the regular judgment critics (edge-cases, comms,
etc.) — anything they flag that requires product judgment, not code
judgment.

The pickup orchestrator merges:

- This critic's output → Buckets A + B.
- Standard critics' output → Bucket C (mostly) plus any blockers.

## Non-goals

- **You don't catch regressions** — that's `critic-regression`'s job.
  Regression catches *risks*; you propose *answers*. They run together
  in the pickup batch but produce different output.
- **You don't gate promote.** All your findings are advisory (info/
  warning). Blockers come from the standard critics and the validator.
- **You don't run during `/contract verify`** — only during pickup. (Once
  the contract has been picked up and committed, normal verify takes
  over.)

## Output

Standard `CRITIC-PROTOCOL.md` shape, with two extra optional fields per
finding (`bucket`, `proposal` / `question`). The validator's
`--check-findings` ignores unknown fields by default; pickup reads them.

## Speed

- The cache lookup is sub-second.
- If the cache is missing or older than `pickup.cacheTTL`, run the
  builder on the fly: `node scripts/build-code-context.mjs --verbose`.
  Worst case ~30s for a typical repo set on first run; sub-second
  thereafter.
- The nightly cron at `workflows/code-context-build.yml` keeps the
  cache fresh automatically — no one has to remember to rebuild.

## Anti-patterns

- **Don't propose without a source.** Every Bucket A item must point to
  a file:line or contract ID. The dev's trust is in the trace, not the
  suggestion.
- **Don't over-propose.** If the cache has 0 matches for an event name,
  don't invent one — leave the field missing and let the standard
  `critic-instrumentation` flag it the normal way.
- **Don't repeat across critics.** If `critic-regression` already
  flagged "PR #4421 conflicts here," don't duplicate as a Bucket B item.
  Dedupe by `(scope, context)` at the pickup-orchestrator merge step.

## See also

- `skills/contract-pickup/SKILL.md` — the orchestrator that consumes
  this critic's output.
- `skills/critic-regression/SKILL.md` — sibling critic; same data
  sources, different question.
- `reference/CRITIC-PROTOCOL.md` — the shared protocol you must follow.
- `scripts/build-code-context.mjs` — the cache builder; output at
  `.manifest/.cache/code-context.json`.
- `workflows/code-context-build.yml` — nightly cache rebuild.
