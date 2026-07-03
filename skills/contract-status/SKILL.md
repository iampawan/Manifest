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
node <plugin-root>/scripts/validate.mjs --status .manifest/contracts/<ID>.md
```

It prints (deterministically from the contract frontmatter):

```
AUTH-12 — Resend OTP on login
  phase:     ② In review
  ⏳ SLA: 23h 14m left (due 2026-05-21 13:30 IST / 2026-05-21 08:00 UTC)
  readiness: review_needed  ·  promotable: ✅ (0 blockers, 2 advisory warnings)
  next:      promote, or address warnings first
```

Relay it as-is. If `--status` exits non-zero, the SLA is overdue —
call that out. **Lead with `promotable` (0 open blockers) — that's the
real gate.** When `promotable` is true, say so even if readiness is
`review_needed`; open warnings are advisory and never block, so a dev
isn't stuck. (Read open blocker/warning counts from the latest
`<ID>.findings.json` if present.)

**Who holds the ball (PM accountability).** If the contract has a
`pickup.ballLog`, compute the ledger — `node scripts/ready-check.mjs
--ledger <ballLog.json> <slaHrs> <promotedAt>` — and lead with it when the
ball is with the PM. The SLA is charged **only for dev-side time**, so report
the *effective* SLA (paused while blocked on PM), not raw elapsed:

```
🟡 blocked on PM 2d 4h (SLA paused) · dev used 6h/48h · 2 bounces
   → nudge the PM, or proceed on the dev's assumption
```

This is the anti-blame line: a dev is never shown as overdue for time the PRD
gap left the ball with the PM.

## All in-flight (the dashboard)

1. List `.manifest/contracts/*.md` (exclude `.findings.md`, `.r*.md`,
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

## Epic rollup — `/status <epic-ID>` (multi-person feature view)

When the ID is an **epic** (`type: epic` with `children: [...]`), show the whole
feature in one glance instead of per-contract. This is the coordination view for a
feature worked by several people across repos.

1. Read the child contracts listed in `children`. For each, collect
   `{ id, owner, repo, size, status, landed, dependsOn }`.
2. Compute the rollup deterministically:
   `node scripts/ready-check.mjs --rollup <children.json>`. It returns per-child
   **state** (`landed` / `blocked` / `ready` / in-flight status), each blocked
   child's `blockedBy`, the **critical path**, `done/total`, and `landed` (true
   only when **every** child has landed).
3. Render — lead with the finish line and the critical path, group by owner:

```
EPIC  SC-100 · Saved cards at checkout        2/4 shipped · not landed
critical path:  SC-a → SC-b → SC-d
success metric: +6% checkout conversion (measured once the feature lands)

  @be-dev    SC-a  backend  ✅ landed
  @fe-dev-1  SC-b  web      ② building
             SC-d  web      ⛔ blocked — waiting on SC-b, SC-c
  @fe-dev-2  SC-c  web      ▶ ready to start (deps met)

next: SC-c is unblocked — @fe-dev-2 can start. SC-d is the critical-path tail.
```

4. **Feature accountability** — a feature isn't "done" because one dev finished;
   it lands only when **all** children land and the metric moves. Lead with any
   cross-child block (who's waiting on whom) so nobody stalls silently, and pair it
   with the PM ledger (blocked-on-PM) where relevant.

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
