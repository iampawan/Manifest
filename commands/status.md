---
name: status
description: Show where a contract stands — phase, SLA time-left (IST + UTC), readiness, next action. Or `/status` with no ID for a dashboard of everything in flight. Read-only, deterministic.
---

# /status [<ID>]

A quick "where are we" view, computed from the contract — no guessing.

## Usage

```
/status <ID>      # one contract: phase + SLA + readiness + next action
/status           # dashboard: every in-flight contract, most urgent first
```

Invokes the **contract-status** skill (which runs
`validate.mjs --status` under the hood).

## One contract shows

```
AUTH-12 — Resend OTP on login
  phase:     ② In review
  ⏳ SLA: 23h 14m left (due 2026-05-21 13:30 IST / 2026-05-21 08:00 UTC)
  readiness: verified
  next:      review the PR and merge
```

## The dashboard (`/status` with no ID) shows

```
IN FLIGHT (3)

⚠️  AUTH-12  ② In review        SLA OVERDUE by 1h 20m   → review + merge
⏳⚠️ SC-007   ③ Canary rollout    3h 10m left             → approve next stage
⏳  PAY-3    ② Building          18h left                → @claude /implement PAY-3
```

Sorted overdue-first, then by least time left. Times always shown in
both IST and UTC. Read-only — never changes a contract.
