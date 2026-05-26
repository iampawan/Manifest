---
name: contract-promote
description: Freeze a verified contract into an immutable revision and start the SLA timer. Use when the user says "promote contract", "ship this PRD", "start the pipeline", or invokes `/contract promote <ID>`. Creates a JIRA epic, opens a tracking issue, kicks off implementation.
requiredScopes:
  - github:issues:write      # opens the tracking issue
  - github:contents:write    # commits the revision file
  - atlassian:write          # optional — creates the JIRA epic
  - slack:chat:write         # optional — posts the promotion message
---

# Contract promoter

Promote freezes a verified contract into a revision and starts the
build phase. **The hard gate is blockers, not warnings:** promote any
contract that is *promotable* (zero open blockers). Warnings and info
are advisory — they don't block promotion, so a dev is never stuck
chasing run-to-run-variable warnings to zero. Surface the open warnings
so the human is choosing knowingly; they can fix or `acknowledge` them,
but they don't have to.

## Precondition: verify required scopes BEFORE making changes

Before doing ANYTHING that writes, check the scopes this skill needs
(declared in frontmatter `requiredScopes`). If a required scope is
missing, STOP and tell the user exactly which scope is missing and
which step it would have broken — do NOT proceed and let a later step
fail silently.

Specifically:
- `github:issues:write` is REQUIRED — the tracking issue is core. If
  the GitHub token lacks it, refuse the whole promote with:
  "Cannot promote: GitHub token lacks `issues:write`, needed to open
  the tracking issue. Grant it (or re-auth) and retry."
- `github:contents:write` is REQUIRED — to commit the revision file.
- `atlassian:write` and `slack:chat:write` are OPTIONAL — if missing,
  proceed but SKIP those steps and tell the user they were skipped
  (e.g., "Promoted; skipped JIRA epic — Atlassian not connected.").
  Never silently skip; always report what didn't happen and why.

Run `/setup` (setup-check skill) to introspect granted scopes. If
scope introspection isn't available in the runtime, attempt the
write and treat a permission error as a hard, reported failure — not
a silent pass.

## Process

1. **Read** `.manifest/contracts/<ID>.md`. Confirm it is **promotable**
   — the latest verify's readiness has `promotable: true` (zero open
   blockers) — and `complexity` is one of `small | medium | large`. If
   there are open blockers, refuse and list them: those are the finite,
   stable set that must be resolved. If there are open *warnings*, list
   them too but proceed (note: "promoting with N advisory warnings — fix
   or `acknowledge` later if you want"). Do NOT require warnings to be
   zero.

   **Reject a fast-only verify.** Check the latest
   `<ID>.findings.md` frontmatter: if `verifyMode: fast`, the contract
   was only checked by the quick draft-loop (edge-cases + security, no
   regression scan, no localized critics). Refuse: "This contract's
   last verify was `--fast` (partial). Run a full `/contract verify
   <ID>` before promoting." A fast verify is for iteration, not the
   promote gate.

2. **If Large, route to decomposition — don't refuse.** A Large
   contract can't be agent-shipped on a timer, but it shouldn't be
   abandoned either. Invoke the **contract-decompose** skill (or tell
   the user to run `/contract decompose <ID>`): it breaks the Large
   contract into a dependency-ordered set of Small/Medium child
   contracts, with risky parts (migrations, auth) flagged human-led.
   Each child then promotes normally. Do NOT promote the Large
   contract itself into the build phase.

3. **Create the revision.** Copy the current contract to
   `.manifest/contracts/<ID>.r<N>.md` where N is `revision`. This is the
   immutable snapshot the build phase reads against. Future edits to the
   main contract fork a new revision.

4. **Compute SLA deadline**:
   - small → now + 24 hours
   - medium → now + 72 hours

5. **Update frontmatter** of the main contract:
   - `status: promoted`
   - `slaDeadline: <ISO datetime>`

6. **Create JIRA epic** (if Atlassian MCP is connected). Use the contract
   title, link to the contract markdown in the repo, set due date to
   `slaDeadline`. For each acceptance criterion, create a sub-task.
   Save the JIRA epic key in the contract frontmatter as `jiraEpic`.

7. **Open a GitHub tracking issue** with the contract title, the SLA
   deadline visible at the top, a link to the revision file, and a
   checklist of stages (Implement / PR Review / QA / Pre-prod / Prod /
   Land). The issue body has a "How to use" section:
   - "From a PR, comment `@claude /implement <ID>` to start the Implementer."
   - "The Verifier runs on every push automatically."
   - "Launch reports start at day 1 post-deploy."

8. **Commit and push** the contract changes and the new revision file.

9. **Post the Slack ANCHOR message** (if Slack MCP is connected).
   This is the ONE top-level message for this contract — every later
   update threads under it (see `reference/CONTRACT-FORMAT.md` Slack
   threading). Channel is `#manifest` by convention; user can override.

   > 🚀 *<title>* (<ID>) promoted — *<complexity>* · ⏳ SLA: 24h left (due <IST / UTC>)
   > <revision file link> · <jira epic link> · <github issue link>

   Generate the SLA line with
   `node <plugin-root>/scripts/validate.mjs --sla .manifest/contracts/<ID>.md`
   (just after stamping `promotedAt` + `slaDeadline`).

   **Capture the posted message's `thread_ts` and stamp it on the
   contract** as `slackThreadTs` (and `slackChannel`). All later skills
   reply into this thread so the channel stays one-line-per-contract.

10. **Tell the user** what's done, the SLA countdown, and the next
    manual step: invite the assigned engineer to comment
    `@claude /implement <ID>` on their PR.

## Refuse conditions

- Contract is not promotable — it has open **blockers**. (Open warnings
  do NOT block promotion; they're advisory.)
- The latest verify was `--fast` (`verifyMode: fast`) — run a full verify first.
- Complexity is `large` or not set.
- The revision file already exists (means someone promoted in parallel).
