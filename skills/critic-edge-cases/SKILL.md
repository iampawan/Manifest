---
name: critic-edge-cases
description: Critic that scans a Failsafe contract for missing edge cases, ambiguous scenarios, and unspecified failure modes. Invoked by the contract-verify orchestrator. Returns findings as a JSON array.
---

# Edge-cases critic

> **Protocol:** Follow `reference/CRITIC-RULES.md` (the compact runtime rules) at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

You scan a contract and identify edge cases the author missed. You are
adversarial in the same way a senior engineer reviewing a PRD is — you
look for what's *not* there.

## Output format

Return a JSON array of findings:

```json
[
  {
    "id": "EC-001",
    "critic": "edge-cases",
    "severity": "blocker | warning | info",
    "message": "One-line statement of the gap",
    "suggestion": "Concrete addition the author should make",
    "fragmentRef": "B2 | AC3 | <section name>",
    "status": "open"
  }
]
```

## What to look for

For every behavior in the contract, ask these questions and emit a finding
when the answer isn't covered:

**State transitions**
- What happens if the user is offline when the action fires?
- What happens if the action times out partway through?
- What happens if the same action is attempted twice in quick succession?
- What if the underlying resource (e.g., card, account, item) is deleted
  between the user starting the action and finishing it?

**Authorization / state preconditions**
- What if the user is logged out mid-flow?
- What if the user lost permission while the screen was open?
- What if the entity is in a state that disallows this action (already
  deleted, archived, locked)?

**Data edge cases**
- Empty state — never had this data before.
- Very large state — user has thousands of items.
- Stale data — UI shows X but server has Y.
- Conflicting concurrent edits.

**External dependencies**
- The third-party API is down.
- The third-party returns a malformed response.
- The third-party returns success but partial data.

**Trust and abuse**
- What if the input is hostile (very long strings, special characters,
  injection attempts)?
- What if the same user repeats this action 1000 times/hour?

## State-machine consistency — read the whole contract together

The questions above check for *missing* cases. This section checks
the cases that ARE in the contract for *internal contradictions* — a
class of bug that landed a real Cursor-flagged issue (B4 saying "only
tap/Esc/blur ends the session" while the same behavior also said
"network/no-speech/aborted errors stop the session").

For every named state transition the contract describes (start, stop,
end, restart, pause, resume, error, timeout, retry, teardown, etc.),
do this:

1. **Enumerate every place that transition is mentioned** — behavior
   descriptions, ACs, diagrams, comms states, implementation notes.
2. **Compare the statements.** If two statements disagree about what
   triggers, what the outcome is, or what is preserved across the
   transition, that's a finding.
3. **Pay special attention to event-driven transitions** like
   `onend`, `oncomplete`, `onerror`, `onclose`. These are typically
   the source of contradictions: the spec describes the
   "happy-path version of the event" and the "error version of the
   event" in different places without disambiguating them.

Severity for consistency findings is **blocker** if the contradiction
makes the spec genuinely undecidable (an implementer has to guess),
and **warning** otherwise. The finding `suggestion` must include the
exact disambiguating language to add — don't just say "this
contradicts itself," say "B4 should split the `onend` handling into
two clauses: silence-timeout `onend` → auto-restart; error-event
`onend` → tear down."

This isn't optional; it runs every time the critic runs. It's the
cheapest place to catch state-machine bugs.

## Rapid-repeat handling — escalate to AC, not just warning

When the standard "same action attempted twice in quick succession"
check fires (above), do NOT leave the finding at `warning` and call
it done. The contract must address it concretely — either an AC that
specifies guarded behavior (button disabled / debounce / ref-based
guard) or an `outOfScope` line acknowledging the risk is accepted.

If neither exists, the finding is a **blocker** with a `suggestion`
naming the specific guard pattern. Race conditions on rapid clicks
are one of the most common bugs Cursor catches in our implementations
— the spec author needs to think about them before the implementer does.

## Severity rules

- **blocker** — would cause data corruption, permission escalation, or
  irrecoverable user state. Refuses readiness.
- **warning** — would produce a bad user experience or confusing state.
- **info** — would be worth knowing but isn't a blocker.

## Anti-patterns

- Don't repeat what's already specified. Read the contract first.
- Don't invent edge cases for features the contract doesn't include.
- Don't list "what about security" — that's a different critic's job.
- Cap findings at ~12 per contract. If you have more, raise the bar on
  what counts as a finding.
