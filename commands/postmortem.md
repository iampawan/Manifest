---
name: postmortem
description: After a feature is rolled back, record landed:rolled-back, write a blameless postmortem from the contract's timeline + guard reports + Sentry, post it to Slack, and reopen the work as a follow-up. Run once the human has flipped the flag off.
---

# /postmortem <ID>

Closes the loop after a rollback — the one terminal state the pipeline
otherwise had no ending for. Run it once you've actually reverted the
feature (flag off / previous release redeployed); `rollback-guard`
recommends the rollback, you perform it, then this records and learns
from it.

## Usage

```
/postmortem SC-005
/postmortem SC-005 "iOS crash on cold start at 10%"
```

## What it does

1. Confirms the feature was rolled back (asks if unclear — it won't
   write a postmortem for something still live).
2. Reconstructs the timeline from the contract's cycle-time stamps, the
   `guard-*.md` reports, the deploy reports, and Sentry.
3. Writes `.manifest/contracts/<ID>.postmortem.md` — blameless: what
   happened, the breached signal, contributing factors, what went well
   (detection caught it before full rollout), action items, re-ship plan.
4. Stamps the contract: `landed: rolled-back`, `rolledBackAt`.
5. Reopens the work — a follow-up tracking issue (never closes it as
   "done") or a route through `/fix` for small fixes.
6. Posts the verdict to Slack (thread + a top-level alert) and DMs the
   owner.

**Learns from it.** If a contributing factor is a code-shaped bug class
review could have caught, the postmortem proposes a *candidate* bug
pattern in `reference/bug-patterns.candidates.md` (staging — not yet
enforced). A maintainer reviews and, if it generalizes, promotes it into
`reference/BUG-PATTERNS.md`, where `code-review` then checks it on every
future diff — so the same class of bug can't ship twice. The human-accept
gate and the `warning`-until-proven default keep a new pattern from
blocking every PR. See the learning loop in `BUG-PATTERNS.md`.

## Blameless by design

The postmortem describes systems, specs, and gaps — never a person as
the cause. A rollback is information: detection worked and the blast
radius was bounded. The feature still didn't land, and that's the thing
to fix.

## See also

- `/rollback-check <ID>` / `/canary <ID>` — the rollout-window health + ramp
- `/contract verify <ID>` — re-verify the new revision before re-promoting
