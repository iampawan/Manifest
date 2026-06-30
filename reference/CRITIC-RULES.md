# Critic rules (compact runtime digest)

This is the **compact** rule layer a critic loads at run time — only what you
need to emit valid output. The full human/orchestrator reference (provenance,
cost, model pinning, rationale) is `CRITIC-PROTOCOL.md`; you do NOT need it to
run. Keep this digest and that file in sync (a test enforces the hard facts).

## Output — return a JSON array; every element matches this shape

```json
{
  "id": "<PREFIX>-<NNN>",          // e.g. EC-001
  "critic": "<canonical name>",    // see prefixes below
  "severity": "blocker | warning | info",
  "message": "one-line plain-English statement of the gap",
  "suggestion": "concrete fix: where to edit + the shape of the edit",
  "fragmentRef": "B2 | AC3 | frontmatter | <section>",
  "references": ["repo:path:line"],   // optional; required for regression
  "source": "github-mcp | local-clone | contract-only",
  "status": "open"                    // open | resolved | dismissed | acknowledged
}
```

## Severity — CLOSED enum, exactly these three

`blocker` (prevents progress: data/security/perms, missing required field,
broken cross-repo contract, breaking change) · `warning` (should fix, doesn't
block on its own) · `info` (worth knowing).
**FORBIDDEN:** `high`/`medium`/`low`/`critical`/`major`/`minor`/`p0`/`p1`/numbers.
The validator rejects anything else and the run fails loud. "High"→blocker,
"medium"→warning, "low"→info.

## Critic name → ID prefix

```
minimality MIN-   edge-cases EC-   platform-parity PP-   instrumentation INS-
comms-completeness COMMS-   perf-budget PERF-   regression RG-   security SEC-
scalability SC-   sizing SZ-
```

## Determinism (minimize run-to-run variance)

- Use the closed enum. Cap at **12 findings per critic** — raise your bar, don't pad.
- Ground every finding in a concrete `fragmentRef` (and `references` for regression).
- Don't re-report what's already in the contract. Read first.
- Order by severity (blockers first), then fragment order.
- **Don't re-check what `scripts/validate.mjs` already enforces** (field presence,
  AC count, sizing, platform-subset) — add the judgment layer on top.

## Anti-patterns

- Don't emit out-of-enum severities. Don't duplicate the deterministic checks.
- Don't speculate without grounding. Don't exceed 12. Don't propose code changes —
  propose *spec clarifications* (code is the Implementer's job).
- Don't soften a real blocker to be "nice." If it blocks, it blocks.
- Don't degrade silently on bad input — if you can't run (missing repo access,
  null input), say so as an `info` finding with the reason; never fake a verdict.

## Message + suggestion — write for a human

- `message`/`suggestion` are plain English a non-author can act on. Spell out
  jargon ("the 50ms responsiveness budget", not "p75 ttiMs"); say where in human
  terms ("under Acceptance criteria"); don't lead with the ID.
- `suggestion` shows HOW: where to edit + a fill-in template, not just "add a
  description." If a thing isn't needed here, say to move it to `## Out of scope`.

## Framing — offer deferral, calibrate to the change

Every finding is "handle X **or** explicitly defer X" (move to `## Out of scope`)
— so the author can clear it by descoping, and readiness never *requires* building
everything a critic noticed. Read `changeType`/`complexity`: on a `bug-fix` or
small change, **bias toward deferral** — speculative edge cases/telemetry/flags
should be flagged for deferral, not demanded.

## Advisor (only if enabled) — advisory findings ONLY

If an advisor is available, you may consult it on a **borderline `warning`/`info`**
call (whether to emit, or how to phrase it). **Never** on a `blocker` — the
validator rejects an advisor-influenced blocker, keeping the gate deterministic.
Mark any advisor-influenced finding `metadata.advisorConsulted: true`.
