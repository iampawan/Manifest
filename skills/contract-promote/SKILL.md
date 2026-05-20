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
build phase. Refuse to promote anything not in `verified` status.

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

1. **Read** `.shipline/contracts/<ID>.md`. Confirm `status: verified` and
   `complexity` is one of `small | medium | large`.

2. **Refuse if Large.** Large contracts use the normal cycle, not this
   pipeline. Tell the user to split or pursue conventionally.

3. **Create the revision.** Copy the current contract to
   `.shipline/contracts/<ID>.r<N>.md` where N is `revision`. This is the
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

9. **Post to Slack** (if Slack MCP is connected). Channel is
   `#shipline` by convention; user can override. Message
   format:
   > 🚀 *<title>* (<ID>) promoted — *<complexity>* · SLA <deadline relative>
   > <revision file link> · <jira epic link> · <github issue link>

10. **Tell the user** what's done and the next manual step: invite the
    assigned engineer to comment `@claude /implement <ID>` on their PR.

## Refuse conditions

- Contract status is not `verified`.
- Complexity is `large` or not set.
- The revision file already exists (means someone promoted in parallel).
