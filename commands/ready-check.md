---
name: ready-check
description: The 2-minute PM-side readiness gate before a PRD reaches dev. Give any source — a JIRA / Notion / Doc / Slack / Figma URL, pasted text, an image, or a description — and Ready Check scores it against the Definition of Ready, shows the blockers in plain language, and (when ready) mints a tamper-evident gate code + a clean hand-off for dev. Runs in Claude Code and Cowork. Aliases: /ready.
---

# /ready-check

Airport security for PRDs. Clear this before handing a feature to engineering —
no more dev chasing you for basics.

```
/ready-check <a JIRA / Notion / Doc / Slack / Figma URL, or "a description">
/ready-check                # no args → I'll ask you the questions directly
/ready       <source>       # alias
```

Invoke the **ready-check** skill. It reads the source, fills what it can, asks
you only what's missing, and gives a clear verdict.

## Examples

```
/ready-check https://your-org.atlassian.net/browse/ENG-1234
/ready-check https://www.figma.com/file/<...>            # design-led feature
/ready-check "saved payment cards at checkout, android + ios"
/ready-check                                             # interview me
```

## What you get

- **Not ready** → the exact items to add, in plain words, each with an example.
  Fix them and re-run.
- **Ready** → a gate code (`RC-…`) and a hand-off block with your design link.
  Paste it into the ticket or the dev thread. Dev grooms only PRDs with a valid
  code.

## For devs — nothing extra to run

When you `/contract pickup <ticket>`, pickup reads the `Ready-Check:` code from
the ticket and verifies it automatically: it proceeds on `VALID`, and refuses
on `STALE` (the PRD changed after it cleared — ask for a fresh Ready Check) or a
missing/`INVALID` code. The gate enforces itself; the PM is the only one who
touches the code. (`node scripts/ready-check.mjs --verify <handoff>` is there as
a manual fallback if you ever want to check by hand.)

## Where the depth is

Ready Check is Level 1 (the basics, judged from the PRD text). The deep,
code-grounded pass — regression, security, feasibility, estimate — is
`/contract pickup`, which runs dev-side after the gate is green.

See `reference/READY-CHECK-RUBRIC.md` for the full Definition of Ready.
