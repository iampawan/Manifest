---
name: canary
description: Show where a feature is in its canary ramp and the next recommended step. Reads the latest rollback-guard health verdict and the rolloutPlan. Recommends the next flag change for a human to make — never flips the flag itself.
---

# /canary <ID>

The face of the canary "orchestrator." For a feature currently rolling
out, it shows the current stage, how long it has baked, the latest
health verdict, and the **next recommended step** — which a human then
performs by flipping the flag.

## Usage

```
/canary SC-005
```

## What it shows

1. **Current stage** — `currentRolloutPercent` and how long it's been at
   that stage vs the stage's `holdHours` bake time.
2. **Health** — the latest `rollback-guard` verdict (proceed / hold /
   recommend-rollback) and the breached/warning signals, if any.
3. **Next step** — from the `rolloutPlan` (contract frontmatter, else
   `repos.yml` `conventions.rolloutPlan`):
   - healthy + baked → "advance flag `<name>` 10% → 50%"
   - healthy, not baked → "hold at 10% — N more hours before advancing"
   - warning → "hold and investigate `<signal>`"
   - breach → "flip flag OFF / redeploy `<previous tag>`"
   - final stage → "ramp complete — launch-monitor takes over"

## Important

This is a **recommend-and-approve** loop. Shipline never advances or
pauses the flag for you — advancing a rollout is a production change you
own. `/canary` (and the `rollback-guard.yml` cron behind it) give you
the call and the exact action; you flip the flag in your flag system,
and the guard records the new `currentRolloutPercent`.

If your project has no feature-flag system, there's no staged ramp —
`verify-deploy`'s "ready" verdict means "ready to deploy," and rollback
is a manual revert.

## See also

- `/rollback-check <ID>` — run a fresh health check now
- `/verify-deploy <ID>` — the pre-rollout readiness verdict
- `reference/CONTRACT-FORMAT.md` — `rolloutPlan`, `currentRolloutPercent`
