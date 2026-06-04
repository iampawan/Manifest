---
name: manifest
description: Manifest — welcome / help / tutorial. Run this when you're new, when you want to see what commands exist, or when you forgot the syntax.
---

# /manifest

The top-level entry point for Manifest. Invoke this when you're new
to the plugin or want a quick refresher.

## Usage

```
/manifest                 # tutorial + 3 paths to start
/manifest tutorial        # same as above
/manifest setup           # check MCPs and config (run this first time)
/manifest help            # reference card only
/manifest commands        # list all commands
```

Invokes the **tutorial** skill which adapts to what you're asking
for: full walkthrough, demo with the example contract, or just the
reference card. The tutorial runs a quick setup check first so it
knows what to recommend.

**First time installing?** Run `/setup` — on first run it's an
interactive wizard that detects your repos and stacks and writes a
complete config for you. Then `/manifest tutorial` for the orientation.

## What Manifest does (in one paragraph)

Takes a feature idea — a JIRA ticket, a Linear issue, a Notion page,
or a one-line description — and runs it through a quality-gated
pipeline from spec to production. Nine critics check the contract
for completeness (edge cases, instrumentation, comms, perf budgets,
regression, security, scalability, platform parity, sizing). An
agent implements verified contracts. Launch reports run for 28 days
post-ship to verify the feature actually landed. Everything lives as
markdown in your repo; git is the audit trail.

## First-time?

```
/manifest tutorial
```

Walks you through it in about 3 minutes. Then you'll be ready to
run `/contract new` against a real feature.

## Pick the right path for the size of change

| Change | Path | Process |
|---|---|---|
| Typo, CSS value, config flip | just edit + commit | none |
| One-line bug, copy tweak, dep bump | `/fix` | triage → fix + regression test → PR |
| New behavior, 1 platform, ≤3 behaviors | `/contract` (Small) | full ceremony, 24h |
| 2 platforms, ≤8 behaviors, additive schema | `/contract` (Medium) | full ceremony, 72h |
| Breaking change, migration, auth/billing | normal cycle (Large) | Manifest for spec only |
| PM authored PRD elsewhere (JIRA / Doc / Slack), dev picks it up | `/contract pickup <source>` *(0.18 beta)* | code archaeology + 3-bucket gap sort; PM stays in their tool |

Process is proportional to risk. Don't run the full contract for a
one-liner; don't `/fix` a multi-platform feature.

## Already know the workflow? Quick reference:

```
# Express lane (trivial)
/fix <bug-or-change>                     Triage → fix + regression test → PR

# Spec phase
/contract new <URL or "description">    Author from JIRA / Linear / text (PM-led)
/contract pickup <source>                Pick up a PRD that lives elsewhere; 3-bucket gap sort (dev-led, 0.18 beta)
/contract verify <ID>                    Validator + relevant judgment critics
/contract fix <ID>                       Bounded verify→fix loop (blockers only)
/contract promote <ID>                   Freeze revision, start SLA

# Build phase
/implement <ID>                          Run implementer agent
/verify-pr <PR>                          Static AC coverage on a PR diff

# Ship + Land phase
/verify-deploy <ID> <URL>                Live verification against deployed env
/launch <ID>                             Manual launch report (day verdict)
/bug-triage <ID>                         Manual bug-cluster scan

# Status + meta
/status [<ID>]                           Phase + SLA (IST+UTC) + next; or all in-flight
/manifest                                This tutorial
/setup                                   Detection wizard / MCP check
```

## Deep dives

- `GUIDE.md` — how it all works, end to end
- `reference/CONTRACT-FORMAT.md` — contract schema reference
- `docs/INSTALL-FOR-TRYERS.md` — sharing with teammates
