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
/ready-check panel          # (Cowork) open the live sidebar panel
/ready       <source>       # alias
```

Invoke the **ready-check** skill. It reads the source, fills what it can, asks
you only what's missing, and gives a clear verdict.

## Examples

```
/ready-check https://your-org.atlassian.net/browse/ENG-1234
/ready-check https://www.figma.com/file/<...>            # design-led feature
/ready-check "saved payment cards at checkout, android + ios"
/ready-check "idempotent refund API, payments service"  # pure backend — works too
/ready-check                                             # interview me
```

Works for **every** PRD — frontend, backend, API, data, infra. A backend PRD
answers the same items the backend way (interface/contract spec, response &
error codes, endpoints, downstream consumers); there's no "backend → skip it"
path, and N/A only clears with a stated reason.

## What you get

- **Not ready** → the exact items to add, in plain words, each with an example.
  Fix them and re-run.
- **Ready** → a gate code (`RC-…`) and a hand-off block with your design link.
  Paste it into the ticket or the dev thread. Dev grooms only PRDs with a valid
  code.

## Verifying a hand-off (no panel needed)

```
/ready-check verify <ticket-or-page-link>   # best — nothing to paste
/ready-check verify                          # then paste the whole block
```

**Give it the link** and it fetches the ticket/page and finds the hand-off inside
it — no copying. Pasting works too, but paste the **whole** block including every
`• [id] …` line: the gate code is a *hash of the answers*, so the code on its own
can't be checked against anything (you'll get `UNVERIFIABLE`).

You get `VALID` / `STALE` / `INVALID`, or `UNVERIFIABLE` if the block wasn't
produced by the tool (a hand-written block proves nothing). If it carries a freeze
stamp, the PRD and design are re-fetched to confirm nothing changed since sign-off.

Also works from a terminal — and accepts a whole ticket dump, not just the block:
`node scripts/ready-check.mjs --verify <ticket-or-block>.txt`

## For devs — nothing extra to run

When you `/contract pickup <ticket>`, pickup reads the `Ready-Check:` code from
the ticket and verifies it automatically: it proceeds on `VALID`, and refuses
on `STALE` (the PRD changed after it cleared — ask for a fresh Ready Check) or a
missing/`INVALID` code. The gate enforces itself; the PM is the only one who
touches the code. (`node scripts/ready-check.mjs --verify <handoff>` is there as
a manual fallback if you ever want to check by hand.)

## The live panel (Cowork)

Installing the plugin gives you this `/ready-check` command. To pin the
always-open sidebar panel — where the smart edge-case review runs live in-page
via Claude, no backend — run `/ready-check panel` in Cowork (or say "open the
Ready Check panel"). It creates the artifact in your Cowork the first time and
reuses it after. Cowork only; in Claude Code the chat flow is the way.

## Where the depth is

Ready Check is Level 1 (the basics, judged from the PRD text). The deep,
code-grounded pass — regression, security, feasibility, estimate — is
`/contract pickup`, which runs dev-side after the gate is green.

See `reference/READY-CHECK-RUBRIC.md` for the full Definition of Ready.
