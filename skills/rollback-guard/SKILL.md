---
name: rollback-guard
description: During a feature's rollout window, watch Sentry errors, crash-free rate, and release adoption against the contract's budgets and RECOMMEND proceed / hold / recommend-rollback. Never executes a rollback — it proposes and a human approves. Invoked by /rollback-check or the rollback-guard.yml workflow (tight cadence while a canary is live). Closes the gap between "deployed" and "safe."
requiredScopes:
  - sentry:read
  - slack:chat:write
---

# Rollback guard

`verify-deployment` decides whether a build is *ready* to start rolling
out. You are the watcher for the period **after** that — while the
feature ramps from canary to 100%, you keep asking "is this still
healthy, or is it quietly on fire?" and surface a clear recommendation
the moment it stops being healthy.

You **recommend; you do not act.** Pausing a canary or rolling back is a
production change with blast radius — a human approves and performs it
(or flips the flag). Auto-executing a rollback is out of scope by
design, and matches `verify-deployment`'s "don't auto-rollback" stance.

## Inputs

- Contract ID (+ revision)
- Optional: explicit time window (default: since `canaryStartedAt`, or
  the last 30 min if a tighter sample is requested)

## When you should run

While a contract is **in its rollout window**: `canaryStartedAt` is set
and `prodRollout100At` is not — or it just reached 100% and you're in
the first 24h of full traffic. Outside that window, the slower
`launch-report` cadence (day 1/7/14/28) takes over. The
`rollback-guard.yml` workflow runs you on a tight cadence during that
window; `/rollback-check <ID>` triggers you manually.

## Process

### 1. Read the contract's budgets

From `.manifest/contracts/<ID>.r<N>.md`, pull the thresholds you'll
judge against. These come from existing fields plus an optional
`rollbackTriggers` block:

- Per-behavior `perfBudget` (latency / render / cold-start numbers).
- The crash-free / error-rate budget if declared.
- Optional `rollbackTriggers` frontmatter (explicit guardrails):

```yaml
rollbackTriggers:
  errorRateMultiplier: 3      # error rate > 3× pre-launch baseline → breach
  crashFreeFloor: 99.0        # crash-free users % must stay ≥ this
  newIssueSeverity: blocker   # any new Sentry issue at/above this → breach
  minAdoptionForSignal: 0.05  # ignore noise until ≥5% of users are on the release
```

If `rollbackTriggers` is absent, fall back to sensible defaults
(error rate > 3× baseline, crash-free < 99%, any new high-volume
unhandled-exception issue), and say in the report that defaults were
used.

### 2. Sample the live signals

Use the Sentry MCP (and Crashlytics / APM if connected) for the window:

- **Error rate** for the release tag vs the pre-launch baseline (same
  window length before launch).
- **New issues** first-seen after the release tag, sorted by event
  count and affected users; note severity.
- **Crash-free users %** (mobile) for the release.
- **Release adoption %** — what fraction of users are on this release.
  Below `minAdoptionForSignal`, treat metrics as low-confidence (don't
  recommend rollback off 11 sessions).
- **Perf** (Sentry Performance / APM) vs each behavior's `perfBudget`.

If no measurement source is connected, do not fabricate a verdict:
emit `hold` with a signal explaining the guard is blind here and the
human must watch dashboards manually (mirrors launch-report's
"unmeasured" honesty).

### 3. Form the recommendation

Output a single verdict object (schema-checked by
`scripts/validate.mjs --check-guard`):

```json
{
  "verdict": "proceed | hold | recommend-rollback",
  "reason": "one-paragraph defensible summary tied to the signals",
  "signals": [
    { "name": "error-rate", "observed": "4.2× baseline", "budget": "≤3×", "status": "breach" },
    { "name": "crash-free", "observed": "99.6%", "budget": "≥99.0%", "status": "ok" },
    { "name": "adoption", "observed": "18%", "budget": "≥5%", "status": "ok" }
  ],
  "generatedAt": "<ISO>"
}
```

Rubric:

- **proceed** — all sampled signals `ok`, adoption high enough to trust
  them. Safe to continue ramping.
- **hold** — at least one `warning` (approaching but not past budget),
  OR adoption too low to be confident, OR partial data. Pause further
  ramp, keep current %, investigate. Not an emergency.
- **recommend-rollback** — a clear `breach`: error rate past the
  multiplier, crash-free below floor, or a new blocker-class issue with
  real volume. The feature is hurting users; recommend reverting to the
  last good state (flag off, or redeploy previous release).

### 3b. Recommend the next ramp step (the canary "orchestrator")

The system does not advance the flag — you tell the human what the next
step is and they flip it. Read the `rolloutPlan` (contract frontmatter,
else `repos.yml` `conventions.rolloutPlan`) and the contract's current
rollout percent (`currentRolloutPercent`, default 1 once
`canaryStartedAt` is set). Add a `recommendedAction` string to the
verdict:

- On **proceed**, if the current stage has baked at least its
  `holdHours`: `"advance flag <name> 10% → 50% (next bake 8h)"`. If it
  hasn't baked long enough yet: `"hold at 10% — N more hours of bake
  before advancing"`.
- On **proceed** at the final 100% stage: `"ramp complete — leave at
  100%; launch-monitor takes over"`.
- On **hold**: `"hold at <current>% — investigate <signal> before
  advancing"`.
- On **recommend-rollback**: `"flip flag <name> OFF (or redeploy
  <previous tag>) — do not advance"`.

If there is no flag system / no `rolloutPlan`, set `recommendedAction`
to `"no staged ramp configured — this is a direct deploy; watch and
revert manually if needed"`. Stamp `currentRolloutPercent` on the
contract when the owner confirms they advanced it (or read it back from
the flag system if the MCP exposes it).

`recommend-rollback` exits the validator with code 3 so the workflow
can escalate loudly. Validate before posting:

```bash
node <plugin-root>/scripts/validate.mjs --check-guard <verdict.json>
```

### 4. Write the guard report

`.manifest/contracts/<ID>.guard-<timestamp>.md` with the verdict object,
the signal table, and links to the top Sentry issues. Set
`guardVerdict: <verdict>` and `guardCheckedAt: <ISO>` in the contract
frontmatter so `/status` and the dashboards can show current health.

### 5. Escalate appropriately

- **proceed** — reply in the contract's Slack thread, one line. No
  noise.
- **hold** — reply in the thread with the warning signals + the
  suggested action (hold the ramp, investigate X). Tag the contract
  owner.
- **recommend-rollback** — reply in the thread AND post a brief
  **top-level** Slack alert (the urgent-alert exception), tagging the
  owner, with: the breached signal, the recommended action (flip flag
  `<name>` off / redeploy `<previous tag>`), and a link to the guard
  report. **Do not perform the rollback** — ask the owner to confirm
  and do it. If the repo has no flag system, say the rollback is a
  manual revert/redeploy.

## What you must never do

- **Never flip a flag, change rollout %, redeploy, or revert.** You
  recommend; a human acts. (Modifying production rollout state is an
  explicit-permission action — out of scope for an automated guard.)
- Never recommend rollback off statistically meaningless data — respect
  `minAdoptionForSignal`.
- Never claim health you didn't measure — `hold` with an honest "blind
  here" signal beats a false `proceed`.
- Never bury a breach in soft language. If it breached, say
  `recommend-rollback` plainly.
- Don't double-report: one verdict per run; let the cadence repeat it.

## Slack threading

Replies go in the contract's thread (`thread_ts:
<contract.slackThreadTs>`, channel `<contract.slackChannel>`).
`recommend-rollback` and canary auto-pause also post the brief
top-level alert. (See reference/CONTRACT-FORMAT.md.)
