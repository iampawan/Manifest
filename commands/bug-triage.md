---
name: bug-triage
description: Manually run bug triage for a contract — scan Sentry, support tickets, and app store reviews for new bug clusters, dedupe against existing JIRA tickets, file new ones. Normally fires automatically via the daily launch-monitor cron, but invoke this when you want an ad-hoc check.
---

# /bug-triage <ID>

Invokes the **bug-triage** skill against the given contract.

## Usage

```
/bug-triage <ID>                  # scope to one contract
/bug-triage                       # all contracts currently in their 4-week landing window
```

## When to use it manually

The bug-triage skill normally runs every day automatically via the
`launch-monitor.yml` cron. You'd run it manually when:

- A known incident just happened and you want fresh data before the
  next cron tick.
- You're preparing for a stakeholder update and want today's bug
  list, not yesterday's.
- You're piloting Manifest without CI workflows installed yet and
  the cron isn't firing — manual is your only option.
- You're testing changes to the bug-triage skill itself.

## What it does

1. Reads `.manifest/contracts/*.md` to find contracts currently in
   their 4-week monitoring window.
2. For each: queries Sentry for new issues in the last 24h filtered
   to that release.
3. Pulls qualitative signals from JIRA / support tools / app store
   reviews (if those MCPs are connected).
4. Clusters findings by likely root cause.
5. Dedupes against existing JIRA tickets (via Atlassian MCP).
6. Files new tickets with contract back-references, severity, and
   reproduction steps inferred from stack traces.
7. Appends to `.manifest/contracts/<ID>.bug-log.md`.
8. Posts a daily summary to the contract's Slack thread.

## Output

A markdown bug-log entry per affected contract, plus JIRA tickets
filed, plus a Slack summary.

## Anti-patterns

- Don't run this repeatedly in quick succession (the dedup logic
  handles overlap but you'll just be re-confirming the same data).
- Don't use this as a real-time error monitor — it's a daily-rhythm
  tool. Sentry alerting is the real-time path.
