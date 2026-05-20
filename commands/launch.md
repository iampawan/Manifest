---
name: launch
description: Generate a launch report for a contract — quantitative + qualitative verdict on whether the feature landed. Can be invoked manually any day post-launch, or via the launch-monitor.yml cron at day 1/7/14/28.
---

# /launch <ID> [--day N]

Invokes the **launch-report** skill against the given contract.

## Usage

```
/launch SC-005                  # auto-detects current day index
/launch SC-005 --day 7          # force a day-7 style report
/launch SC-005 --day 28         # final verdict
```

## What it does

1. Reads the contract and latest revision.
2. Auto-detects the best measurement source: Firebase Analytics →
   Amplitude → server logs → DB query → Sentry release data →
   manual input. Uses the richest available.
3. Pulls errors from Sentry.
4. Pulls qualitative signals from JIRA, support tools, Slack (if
   connected).
5. Computes a verdict: `landed | partial | not-landed | rolled-back |
   unmeasurable-quant`.
6. Writes `.shipline/contracts/<ID>.launch-report-day<N>.md` with a
   Cycle Time section showing intake → prod duration.
7. Posts a 3-line summary to the contract's Slack thread.
8. Updates the contract's `landingTrack` array and `slaHit` field.

## When to use manually

- Spot-checking a feature mid-window.
- Generating an ad-hoc report for stakeholders.
- Re-running after a data issue is resolved.

For the standard cadence (day 1/7/14/28), the `launch-monitor.yml`
cron handles it automatically.

## Output

A markdown report at `.shipline/contracts/<ID>.launch-report-day<N>.md`
and a Slack message with the verdict line.
