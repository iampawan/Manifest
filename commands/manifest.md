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
| New behavior, 1 platform, ≤3 behaviors | `/contract pickup` (Small) | full ceremony, 24h |
| 2 platforms, ≤8 behaviors, additive schema | `/contract pickup` (Medium) | full ceremony, 72h |
| Breaking change, migration, auth/billing | normal cycle (Large) | Manifest for spec only |

`/contract pickup <source-or-description>` is the canonical Spec
entry — accepts JIRA / Linear / Notion / Google Doc / Slack URLs,
Figma files, pasted text, images, or a free-form description, and
walks the gap-sort + fix loop end-to-end. Process is proportional
to risk: don't run the full contract for a one-liner; don't `/fix`
a multi-platform feature.

## Already know the workflow? Quick reference:

```
# Express lane (trivial)
/fix <bug-or-change>                     Triage → fix + regression test → PR

# Spec phase  (canonical)
/contract pickup <source-or-description> Fetch + draft + critics + 3-bucket gap sort + PM Q&A
/contract fix <ID>                       Re-run the conversational fix loop on an existing contract
/contract promote <ID>                   Freeze revision, start SLA

# Spec phase  (power-user / backward-compat)
/contract new <URL or "description">     Legacy alias — use pickup instead
/contract verify <ID>                    Re-check after manual contract edits

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
/manifest cost                           Token/$ rollup by complexity, model tier, critic
/setup                                   Detection wizard / MCP check
```

## /manifest cost — is the model routing actually saving money?

```
/manifest cost                # rollup across .manifest/contracts
/manifest cost <dir>          # a different contracts dir
```

Runs the deterministic rollup over every `*.findings.json` that recorded a
`usage` block:

```
node <plugin-root>/scripts/validate.mjs --cost [dir]        # human table
node <plugin-root>/scripts/validate.mjs --cost [dir] --json # machine JSON
```

It reports total spend and a breakdown by **complexity**, **model tier**, and
**critic**, priced from `reference/model-pricing.json` (estimates — update when
Anthropic prices change). This is how you tune the routing rubric from data:
if `haiku`-tier critics are cheap but you're re-running them often, or the
advisor's line is larger than the tiering saved, the numbers say so. Usage is
observability only — it never affects a verdict.

## Deep dives

- **`FLOW.md` — who runs what, when** (PM → Dev → Lead → Auto; the one-glance map)
- `GUIDE.md` — how it all works, end to end
- `reference/CONTRACT-FORMAT.md` — contract schema reference
- `docs/INSTALL-FOR-TRYERS.md` — sharing with teammates
