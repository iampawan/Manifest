# Critic protocol (shared rule layer)

This is the **full** reference: the runtime rules a critic needs *plus* the
orchestrator/maintainer concerns (provenance, model pinning, cost, advisor
mechanics, rationale). One source of truth for the rules.

**At run time, critics load the compact `CRITIC-RULES.md` digest instead of
this file** — it carries only what's needed to emit valid output (schema,
severity enum, ID prefixes, determinism caps, anti-patterns, framing, the
advisor constraint), so ~9 parallel critics don't each re-read this whole
document every verify. This file stays the source of truth; if you change a
hard rule (severity enum, ID prefixes, the 12-cap, schema), update the digest
to match — `eval/validate.test.mjs` enforces that the digest and the validator
agree, so drift fails CI. The orchestrator (`contract-verify`) still reads this
full file for provenance/cost/advisor orchestration.

Each critic SKILL.md should open with:

> Follow `CRITIC-PROTOCOL.md` at the plugin root for severity
> definitions, output schema, and shared anti-patterns. This skill
> only defines WHAT to look for; the protocol defines HOW to report.

---

## Output schema (STRICT)

Every critic returns a JSON array. Every element MUST match this schema
exactly. The deterministic validator (`scripts/validate.mjs`) checks
critic output against this schema and **rejects** any element that
violates it — out-of-schema output is a bug, not a finding.

```json
[
  {
    "id": "string — <CRITIC_PREFIX>-<NNN>, e.g. EC-001",
    "critic": "string — one of the canonical critic names below",
    "severity": "blocker | warning | info",
    "message": "string — one-line statement of the gap",
    "suggestion": "string — concrete fix the author should make",
    "fragmentRef": "string — B2 | AC3 | frontmatter | <section>",
    "references": ["string — optional, repo:path:line entries"],
    "source": "github-mcp | local-clone | contract-only",
    "status": "open | resolved | dismissed | acknowledged"
  }
]
```

### Finding status + the gate

`status` is one of: `open` (live), `resolved` (fixed in the contract),
`dismissed` (the finding was wrong, with a reason), `acknowledged` (a
human reviewed it and accepts it as-is). Only `open` findings count.

**The hard gate is blockers, not all findings.** A contract is
*promotable* when it has **zero open blockers** — that's the finite,
deterministic-plus-serious-judgment set. Warnings and info are advisory:
they refine the readiness signal but never block promotion. This is what
stops verify from feeling endless — a dev clears the stable blocker set
and ships; they don't chase run-to-run-variable warnings to zero. A
warning a human accepts is marked `acknowledged` so it leaves the open
set and never re-litigates.

### Severity is a CLOSED enum

Allowed values, and ONLY these three:

- **`blocker`** — prevents the contract from progressing. Reserved for:
  data corruption risk, permission/security holes, missing required
  fields (instrumentation, ACs, perf budget, comms states), broken
  API contracts between repos, breaking changes to shipped behavior.
- **`warning`** — should be addressed but doesn't block readiness on
  its own. Bad UX, weak error copy, missing platform-specific detail,
  scaling concerns without a cliff.
- **`info`** — worth knowing, not blocking. Style nits, suggestions,
  related code worth being aware of.

**FORBIDDEN values:** `high`, `medium`, `low`, `critical`, `major`,
`minor`, `p0`, `p1`, numeric severities, or anything else. If you
catch yourself wanting "high," it's a `blocker`. "Medium" is a
`warning`. "Low" is `info`. The validator will reject anything else
and the run will fail loudly — do not emit them.

### Canonical critic names

Use exactly these in the `critic` field:

```
minimality
edge-cases
platform-parity
instrumentation
comms-completeness
perf-budget
regression
security
scalability
sizing
```

### ID prefixes

```
minimality         → MIN-
edge-cases         → EC-
platform-parity    → PP-
instrumentation    → INS-
comms-completeness → COMMS-
perf-budget        → PERF-
regression         → RG-
security           → SEC-
scalability        → SC-
sizing             → SZ-
```

---

## Determinism rules

To minimize variance run-to-run:

1. **Don't invent severities.** Use the closed enum. (See above.)
2. **Cap findings.** Max 12 per critic per contract. If you have more,
   raise your bar for what counts — don't pad.
3. **Be specific, not speculative.** A finding without a concrete
   `fragmentRef` (and `references` for regression) is weaker than one
   with them. Prefer fewer, grounded findings.
4. **Don't re-report what's already in the contract.** Read first.
5. **Order findings by severity** (blockers first), then by fragment
   order. Stable ordering reduces diff noise between runs.

---

## What's deterministic vs judgment

Some checks are mechanical and run in CODE before any critic fires
(see `scripts/validate.mjs`). Critics must NOT duplicate these — they
are already enforced deterministically:

| Deterministic (handled by validate.mjs — don't re-check) | Judgment (your job) |
|---|---|
| Every behavior HAS an `instrumentation` block | Is the event name semantically right? Collision risk? |
| Every behavior HAS a `perfBudget` with numeric fields | Are the budgets realistic for the platform? |
| Every behavior HAS empty/loading/success/error states | Is the error copy actionable? On-brand? |
| Every behavior HAS ≥1 acceptance criterion | Do the ACs cover the real edge cases? |
| Behaviors declare `platforms ⊆ contract.platforms` | Is the platform-specific UX actually described? |
| Sizing rule arithmetic (platform count, behavior count) | (sizing is fully deterministic — see validate.mjs) |
| Output JSON schema validity | (validated automatically) |

If the validator already emits a finding for a missing field, you do
NOT also emit one. You add the *judgment* layer on top: the validator
says "B3 has no instrumentation"; you (instrumentation critic) propose
the right event name and flag collisions.

---

## Model + version pinning

Every findings file records, in its frontmatter, the plugin version
and the models that produced it. Critics no longer all run on one model
— the deterministic router (`computeModelPlan` in `scripts/validate.mjs`)
assigns each critic a model from the contract's sizing — so provenance
records the **per-tier model map** that was used, not a single scalar:

```yaml
verifiedWith:
  pluginVersion: 0.19.0
  protocolVersion: 2
  complexity: large              # the sizing bucket that drove routing
  models:                        # the model each tier ran on (from modelPlan)
    light: claude-haiku-4-5      # minimality, comms-completeness
    default: claude-sonnet-4-6   # edge-cases, instrumentation, perf-budget, platform-parity
    heavy: claude-opus-4-8       # regression, security, scalability
  contractHash: sha256:abc123…   # hash of the contract content verified
```

This keeps findings reproducible-by-reference: if two devs get different
findings, compare `contractHash` (different contract content), `models`
(different engine per tier), and `pluginVersion`. The model map is a
deterministic function of `complexity`, so the same contract always
routes the same way — the routing decision is reproducible, not a
per-run guess. The eval suite pins all of these so behavioral drift is
caught in CI, not in production.

**Provenance schema is versioned by `protocolVersion`.** v1 recorded a
single `model:` scalar; v2 records the `models` map above. Bumping
`protocolVersion` deliberately invalidates the verify cache (see
`cacheStatus`), because a findings file written under the old schema
can't faithfully describe which model produced each finding.

Note: the **advisor** (used by the Implementer, not by verify critics) is
non-deterministic by design and is therefore NOT part of this reproducible
provenance or any eval gate; when it fires, the Implementer records it in
its PR output, never in a verdict-bearing findings file.

## Cost / token usage (observability — NOT a gate)

Token usage is non-deterministic, so it follows the same rule as the
advisor: it's recorded for observability and is **never** a gate input or
part of the reproducible-provenance comparison. But turning recorded usage
into a dollar figure is deterministic code (`computeCost` in
`scripts/validate.mjs`, priced from `reference/model-pricing.json`), which is
what lets you measure whether model tiering and the advisor actually saved
money.

When the runtime exposes per-subagent token counts, record them in the
findings `.json` companion (best-effort — omit the block if unavailable):

```jsonc
"usage": {
  "recordedAt": "<ISO>",
  "byCritic": {
    "minimality": { "model": "claude-haiku-4-5",  "inputTokens": 8000,  "outputTokens": 300 },
    "security":   { "model": "claude-opus-4-8",    "inputTokens": 15000, "outputTokens": 1200 }
  },
  "advisor": null            // or { model, inputTokens, outputTokens } if consulted
}
```

The rollup (`validate.mjs --cost`, surfaced as `/manifest cost`) scans these
blocks and reports cost by complexity, model tier, and critic. Because it's
observability, a missing or partial `usage` block degrades gracefully — the
verdict and caching are entirely unaffected.

## Advisor escalation (critics) — advisory findings ONLY

A critic running on a fast tier may consult the advisor (Claude Code's
`/advisor`) on a **borderline** call — but only within a hard boundary that
protects the deterministic verdict:

- **Allowed:** deciding whether to emit, or how to phrase, a `warning` or
  `info` finding the critic is genuinely unsure about. The advisor helps the
  cheap model match the judgment of a strong one *on the soft, advisory layer*.
- **Forbidden:** influencing a `blocker` in any way. Blockers are the gate
  (promotable = zero open blockers) and must stay a deterministic-plus-protocol
  judgment, never an advisor's non-deterministic call. The deterministic
  validator **rejects** an advisor-influenced blocker (`validateFindings`), so
  this isn't merely a convention — it's enforced, and a run that tries it fails
  loud.
- **Mark it.** An advisor-influenced finding sets
  `metadata.advisorConsulted: true` (and may record the advisor model). The run
  records `advisorConsulted: true` in `findings.json` provenance.
- **Not reproducible, and that's fine.** Advisor-influenced findings are
  excluded from the reproducible-provenance comparison and the eval recall
  gates — they're a quality aid on the advisory layer, never part of the
  reproducible verdict. Since they can only be `warning`/`info`, they never
  touch promotability.

Opt-in per repo via `conventions.criticAdvisor: true` in `.manifest/repos.yml`
**and** an advisor being available in the runtime; otherwise critics run
exactly as before. The point is to spend a strong model's judgment only where a
soft call is genuinely ambiguous, without ever destabilizing the gate.

---

## Shared anti-patterns (apply to every critic)

- Don't emit severities outside the closed enum.
- Don't duplicate deterministic checks the validator already does.
- Don't speculate without grounding (fragmentRef / references).
- Don't exceed 12 findings; quality over volume.
- Don't propose code changes — propose *spec clarifications*. (Code is
  the Implementer's job.)
- Don't soften a real blocker into a warning to be "nice." If it
  blocks, it blocks.
- Don't degrade silently on bad input. If you can't run (missing repo
  access, null input), say so as an `info` finding with a clear
  reason — never produce a misleading verdict from missing data.
- **Write `message` and `suggestion` in plain English a non-author can
  act on.** The structured fields (`id`, `critic`, `fragmentRef`,
  `severity`) carry the machine detail; the human text should read like
  a reviewer's note, not a log line. Spell out jargon ("the 50ms
  responsiveness budget", not "the p75 ttiMs budget"); say where in human
  terms ("under Acceptance criteria"), and don't lead the sentence with
  the ID.
- **`suggestion` must show HOW to fix it, not just name the gap.** A
  good suggestion tells the author *where* to edit and gives the *shape*
  of the fix — a fill-in template or example — so they can paste-and-fill
  rather than guess. Don't write "add a description"; write "in B2's
  description, add a sentence naming who's authorized, e.g. 'Only the
  re-authenticated account owner can delete.'" Don't write "add an AC";
  write `Under "## Acceptance criteria", add: "- AC<n> (B2): Given …,
  when …, then …."` If the fix is "this isn't needed here," say
  explicitly to move it to `## Out of scope`. The deterministic
  validator already does this for its findings — match that bar.

## Framing: offer deferral, don't only demand handling

A finding is "handle X **or** explicitly defer X." Every critic's
`suggestion` must allow the author to *descope* — move the item to
`## Out of scope` as a follow-up — not just "add handling for X." This
is what stops scope from growing one finding at a time: the author can
clear a finding by deferring it, and reaching readiness no longer
*requires* building everything a critic noticed.

Calibrate to the change: read `changeType` and `complexity`. On a
`bug-fix` (or small change), **bias toward deferral** — the bar is "what
does fixing this bug actually require," not "what would a net-new feature
need." Speculative edge cases, new telemetry, and new flags on a bug fix
should be flagged for deferral, not demanded. (The `minimality` critic
is the dedicated counterweight, but every critic shares this framing.)
