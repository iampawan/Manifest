---
name: rollback-postmortem
description: Close the loop after a feature is rolled back. Records landed:rolled-back, writes a blameless postmortem from the contract's own timeline + guard reports + Sentry, posts it to Slack, and reopens the work as a follow-up. Invoked by /postmortem <ID> after a human confirms the rollback. The one ending the end-to-end loop was missing.
requiredScopes:
  - sentry:read
  - slack:chat:write
  - github:issues:write
---

# Rollback postmortem

When `rollback-guard` recommends a rollback and the team reverts, the
loop has to actually *end* somewhere — with the status recorded and the
lesson captured, not just a flag flipped and silence. That's this skill.

It runs **after** a human has confirmed the rollback happened (you don't
flip flags — see rollback-guard). It's blameless by construction: the
output describes what the system did and what was learned, never who to
blame.

## Inputs

- Contract ID
- Optional: a one-line reason from the human ("iOS crash on cold start")
- Optional: the guard report that triggered it
  (`.manifest/contracts/<ID>.guard-*.md`)

## Process

### 1. Confirm a rollback actually happened

Read the contract. A postmortem is only appropriate once the feature is
no longer at its rollout stage (flag flipped off / previous release
redeployed). If the latest `guardVerdict` isn't `recommend-rollback`
and the human gave no reason, ask the human to confirm the rollback
before proceeding — don't write a postmortem for a feature that's still
live.

### 2. Reconstruct the timeline (from data the contract already has)

You don't need new infrastructure — the contract's own cycle-time
stamps plus the guard/deploy reports are the timeline:

- `promotedAt`, `prMergedAt`, `qaDeployedAt`, `canaryStartedAt`,
  `currentRolloutPercent` — when each stage happened and how far it got.
- The `guard-*.md` reports — the signal that breached, when it was
  first seen, and the values vs budget.
- Sentry (via MCP) — the top issues for the release tag: error class,
  first-seen, affected users, stack location.
- The deploy report(s) — what verification said before rollout.

### 3. Write the postmortem

`.manifest/contracts/<ID>.postmortem.md`:

```markdown
---
contractId: <ID>
revision: <N>
type: rollback-postmortem
generatedAt: <ISO>
rolledBackAt: <ISO>
rolledBackAtStage: 10%
---

# <title> — rollback postmortem

## What happened
One paragraph: what shipped, how far it ramped, what signal breached,
when it was caught, and what action was taken. Plain, blameless.

## Timeline (IST / UTC)
| When | Event |
|---|---|
| <t> | Promoted; SLA started |
| <t> | Merged; deployed to QA (verify: ready-for-canary) |
| <t> | Canary started at 1% |
| <t> | Advanced to 10% |
| <t> | rollback-guard: recommend-rollback (error rate 4.2× baseline) |
| <t> | Flag flipped to 0% by <owner> |

## Signal that breached
The guard verdict + the signal table: observed vs budget, adoption %,
and the top Sentry issue(s) with first-seen and affected users.

## Contributing factors
Blameless. What about the change, the spec, or the verification let this
reach users? Was there an edge case the contract didn't cover (link the
finding if so)? Did verification pass because the failure only appears
under real traffic / a cohort QA didn't exercise?

## What went well
Detection worked — the guard caught it at N% before full rollout. Note
the blast radius that was avoided.

## Action items
- [ ] <owner> — concrete fix (with a tracking ref)
- [ ] Add the missed edge case to the contract before re-promoting
- [ ] (if verification gap) strengthen the AC / device-cohort coverage

## Re-ship plan
The contract reopens at the spec phase: address the contributing
factors in a new revision, re-verify, re-promote. Link the follow-up.
```

### 4. Stamp the contract

- `landed: rolled-back`
- `landedAt: <ISO>` (the rollback is the terminal state for this revision)
- `rolledBackAt: <ISO>`
- Leave `slaHit` as recorded; a rollback doesn't retroactively change
  whether the *first* 100% (if any) hit SLA — but note in the
  postmortem that the feature did not durably land.

### 5. Reopen the work — don't let it vanish

A rolled-back feature is not a finished feature. Create the follow-up so
it can't silently disappear:

- If Atlassian/JIRA or GitHub Issues MCP is connected: open a follow-up
  issue titled `<ID> re-ship after rollback`, linking the postmortem and
  the action items, and reference the original tracking issue.
- If the change is small and well-understood, suggest routing the fix
  through the **express lane** (`/fix`); otherwise the contract reopens
  at the spec phase for a new revision.

Never close the tracking issue as "done" — a rollback is the opposite of
done.

### 6. Post to Slack

Reply in the contract's thread with the verdict (`rolled-back`) and a
3-line summary, AND post a brief **top-level** alert (rollback is an
urgent-alert exception) linking the postmortem and the follow-up issue.
DM the contract owner the full postmortem link.

## Anti-patterns

- **Not blameless.** Never name a person as the cause. Describe systems,
  specs, and gaps.
- **Don't flip flags or revert.** The human already did the rollback;
  you record and learn from it.
- Don't write "success — caught early!" as if the rollback were the
  goal. Detection working is good; the feature still didn't land. Say
  both.
- Don't close the loop as "done." Reopen it.
- Don't invent a root cause the data doesn't support — if Sentry is
  thin, say the cause is unconfirmed and make "reproduce + confirm" the
  first action item.

## Slack threading

Replies go in the contract's thread (`thread_ts:
<contract.slackThreadTs>`, channel `<contract.slackChannel>`); the
rollback also posts the brief top-level alert. (See
reference/CONTRACT-FORMAT.md.)
