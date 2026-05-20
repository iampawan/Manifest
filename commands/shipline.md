---
name: shipline
description: Shipline — welcome / help / tutorial. Run this when you're new, when you want to see what commands exist, or when you forgot the syntax.
---

# /shipline

The top-level entry point for Shipline. Invoke this when you're new
to the plugin or want a quick refresher.

## Usage

```
/shipline                 # tutorial + 3 paths to start
/shipline tutorial        # same as above
/shipline setup           # check MCPs and config (run this first time)
/shipline help            # reference card only
/shipline commands        # list all commands
```

Invokes the **tutorial** skill which adapts to what you're asking
for: full walkthrough, demo with the example contract, or just the
reference card. The tutorial runs a quick setup check first so it
knows what to recommend.

**First time installing?** Run `/setup` — on first run it's an
interactive wizard that detects your repos and stacks and writes a
complete config for you. Then `/shipline tutorial` for the orientation.

## What Shipline does (in one paragraph)

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
/shipline tutorial
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
| Breaking change, migration, auth/billing | normal cycle (Large) | Shipline for spec only |

Process is proportional to risk. Don't run the full contract for a
one-liner; don't `/fix` a multi-platform feature.

## Already know the workflow? Quick reference:

```
# Express lane (trivial)
/fix <bug-or-change>                     Triage → fix + regression test → PR

# Spec phase
/contract new <URL or "description">    Author from JIRA / Linear / text
/contract verify <ID>                    Run all 9 critics
/contract promote <ID>                   Freeze revision, start SLA

# Build phase
/implement <ID>                          Run implementer agent
/verify-pr <PR>                          Static AC coverage on a PR diff

# Ship + Land phase
/verify-deploy <ID> <URL>                Live verification against deployed env
/launch <ID>                             Manual launch report (day verdict)
/bug-triage <ID>                         Manual bug-cluster scan

# Meta
/shipline                                This tutorial
/setup                                   Check MCPs and config
```

## Deep dives

- `GUIDE.md` — how it all works, end to end
- `docs/MVP-PLAN.md` — demo strategy and phased rollout
- `reference/CONTRACT-FORMAT.md` — contract schema reference
- `docs/INSTALL-FOR-TRYERS.md` — sharing with teammates
