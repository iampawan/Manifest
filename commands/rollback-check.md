---
name: rollback-check
description: Check a feature's live health during its rollout window against the contract's budgets and get a proceed / hold / recommend-rollback recommendation. Recommends only — never executes a rollback.
---

# /rollback-check <ID>

Runs the **rollback-guard** skill for a contract that is currently
rolling out. Samples Sentry errors, crash-free rate, release adoption,
and perf against the contract's budgets, and returns a recommendation.

## Usage

```
/rollback-check SC-005
```

## What it does

1. Reads the contract's budgets (`perfBudget`, crash-free / error
   budgets, optional `rollbackTriggers`).
2. Samples live signals via Sentry / Crashlytics / APM for the rollout
   window.
3. Emits a schema-checked verdict (`scripts/validate.mjs --check-guard`):
   - **proceed** — healthy, keep ramping.
   - **hold** — a warning or low confidence; pause the ramp, investigate.
   - **recommend-rollback** — a clear breach; recommends reverting and
     posts a top-level Slack alert to the owner.
4. Writes a guard report and stamps `guardVerdict` on the contract.

## Important

This command **recommends; it never acts.** Pausing a canary, flipping
a flag, or rolling back is a production change a human approves and
performs. The guard gives you the defensible call and the exact action
to take — you pull the trigger.

## When to use

- Manually, any time during a rollout you want a health read.
- Automatically on a tight cadence via `rollback-guard.yml` while a
  canary is live (`canaryStartedAt` set, `prodRollout100At` not yet).

## See also

- `/verify-deploy` — pre-rollout readiness verdict
- `/launch` — the slower day 1/7/14/28 "did it land" reports
- `reference/CONTRACT-FORMAT.md` — `rollbackTriggers` + guard fields
