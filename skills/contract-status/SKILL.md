---
name: contract-status
description: Show the current status of a contract (or all in-flight contracts) right in the CLI — phase, SLA time-left (IST + UTC), readiness, and the next action. Use when the user says "status", "where are we", "what's in flight", "time left", or invokes `/status [<ID>]`.
---

# Contract status

A quick "where does this stand" view, computed deterministically — no
LLM guessing about phase or time. Powered by `validate.mjs --status`.

## Usage

- `/status <ID>` — one contract
- `/status` — every contract currently in flight (status `promoted`
  and not yet `landed`), most-urgent first

## One contract

Run:

```bash
node <plugin-root>/scripts/validate.mjs --status .shipline/contracts/<ID>.md
```

It prints (deterministically from the contract frontmatter):

```
AUTH-12 — Resend OTP on login
  phase:     ② In review
  ⏳ SLA: 23h 14m left (due 2026-05-21 13:30 IST / 2026-05-21 08:00 UTC)
  readiness: verified
  next:      review the PR and merge
```

Relay it as-is. If `--status` exits non-zero, the SLA is overdue —
call that out.

## All in-flight (the dashboard)

1. List `.shipline/contracts/*.md` (exclude `.findings.md`, `.r*.md`,
   `.deploy-*`, `.launch-report-*`, `.bug-log.md`, `.decomposition.md`,
   and `.fixes/`).
2. For each whose `status` is `promoted` and `landed` is unset, run
   `--status`.
3. Sort by SLA urgency: overdue first, then least time left.
4. Print a compact table:

```
IN FLIGHT (3)

⚠️  AUTH-12  ② In review        SLA OVERDUE by 1h 20m        → review + merge
⏳⚠️ SC-007   ③ Canary rollout    3h 10m left                  → approve next stage
⏳  PAY-3    ② Building          18h left                     → @claude /implement PAY-3

Epics: AUTH-30 (3/4 children shipped)
```

5. If nothing is in flight, say so and suggest `/contract new` or
   `/fix`.

## Notes

- Times always show BOTH IST and UTC (the validator's formatter does
  this; don't reformat).
- This is read-only — it never changes a contract. Safe to run anytime.
- For an epic, show child progress (how many children have `landed`).
- Phase and next-action come from `derivePhase` in the validator, so
  they're consistent with what every other update shows.

## Anti-patterns

- Don't recompute phase or time-left by hand — use `--status` so it
  matches every other surface.
- Don't list landed/closed contracts in the in-flight view (only
  promoted-and-not-landed).
