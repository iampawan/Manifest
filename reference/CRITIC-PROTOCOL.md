# Critic protocol (shared rule layer)

Every critic skill references THIS file instead of redefining severity,
output format, or anti-patterns. One source of truth. If you change a
rule, change it here and every critic inherits it.

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
and the model that produced it:

```yaml
verifiedWith:
  pluginVersion: 0.2.0
  model: claude-opus-4-6
  protocolVersion: 1
  contractHash: sha256:abc123…   # hash of the contract content verified
```

This makes findings reproducible-by-reference: if two devs get
different findings, compare `contractHash` (different contract content)
and `model`/`pluginVersion` (different engine). The eval suite pins
all three so behavioral drift is caught in CI, not in production.

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
