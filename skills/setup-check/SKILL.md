---
name: setup-check
description: Check whether the user's environment has the MCPs, secrets, and config Shipline needs. Reports what's connected, what's missing, and what each missing piece would unlock. Invoked by `/shipline setup`, `/setup`, on first run, or whenever a skill detects a missing prerequisite. Tells the user what they can do today and what to connect next.
---

# Setup check

Your job is to make Shipline self-explanatory at runtime. The user
shouldn't have to read three docs to know what's missing — they
should run one command and see exactly what's wired, what's not,
and what to do about each.

## When you run

Triggered by any of:
- User invokes `/shipline setup` or `/setup`
- User invokes `/shipline` for the first time (no `.shipline/`
  directory in the current working dir)
- Another skill detects a missing required MCP and routes here
  ("you need the Atlassian MCP for that — let me check your setup")

## Process

### 1. Discover what's connected

Try to list the user's connected MCPs. Two paths:

**Preferred** — use the MCP registry tool if available:

```
mcp__mcp-registry__list_connectors()
```

This returns the connectors the user has installed. Cross-reference
against Shipline's MCP requirements below.

**Fallback** — if `list_connectors` isn't available, probe each
MCP by checking whether its tools appear in the current toolset.
If the user's environment doesn't expose tool listings, fall
back to asking the user: "Which of these do you have connected?
[checklist]".

### 2. Cross-reference against Shipline's requirements

| MCP | Tier | What Shipline uses it for |
|---|---|---|
| **GitHub** | Required | Read code across repos, open PRs, post comments. Required for regression critic (multi-repo scanning) and the Implementer. |
| **Sentry** | Required | Errors, releases, performance per release. Required for verify-deployment, launch-report, bug-triage. |
| **Slack** | Required | Human gates, daily reports, contract threads. Required for the cycle to be usable in a team setting. |
| **Firebase Analytics** | Recommended | Richest source for launch-report success metrics. Without it, launch report falls back to server logs / DB / Sentry. |
| **Amplitude** | Recommended | Alternative client analytics if you use it instead of Firebase. |
| **Atlassian (JIRA + Confluence)** | Recommended | Pull contracts from JIRA tickets via URL, auto-file bugs, link Confluence pages. Without it, `/contract new <jira-url>` won't work — falls back to free-text intake. |
| **Figma** | Optional | Implementer reads design frames; comms-completeness critic verifies UI state coverage. Without it, design alignment is human-only. |
| **Google Cloud Logging / Datadog / Loki** | Optional | Server-side event count fallback when no client analytics. |
| **Postgres / DB MCP** | Optional | Direct record-count fallback for launch metrics. |

### 3. Produce a clear status table

Format the output as a clean status check. Use checkmarks and X's
for visual clarity. Group by tier. Example output:

```
🛠  Shipline setup check
━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED
✅ GitHub MCP            — connected
✅ Sentry MCP            — connected
❌ Slack MCP             — not connected
   → Connect via your MCP settings (search "Slack")
   → Without it: no human gates, no daily reports, no team-friendly cycle

RECOMMENDED
✅ Firebase Analytics    — connected
❌ Atlassian (JIRA) MCP  — not connected
   → Without it: /contract new <jira-url> won't work; falls back to free-text intake
   → Connect via MCP settings if your team lives in JIRA

OPTIONAL
❌ Figma MCP             — not connected
   → Without it: comms-completeness critic can't verify UI state coverage from designs
   → Connect later if/when design alignment becomes a pain point

━━━━━━━━━━━━━━━━━━━━━━━━

What you can do right now:
✅ Author contracts from free-text descriptions
✅ Run critics (with degraded regression-critic if GitHub MCP not configured for your repos)
✅ Run the Implementer in CI
⚠️ Launch reports will work but use server-log/Sentry fallbacks (no Firebase metrics)
❌ Cannot post status to Slack (required for team workflow — please connect)

Recommended next step: connect Slack, then run /contract new "<a small feature>"
```

### 4. Offer to help connect

After the status table, offer concrete next actions:

- If `mcp__mcp-registry__suggest_connectors` is available, call it
  with the missing MCP names to surface install instructions:
  ```
  mcp__mcp-registry__suggest_connectors({
    queries: ["Slack", "Atlassian", "Firebase Analytics"]
  })
  ```
- Otherwise, point at the client's MCP settings: "Open MCP settings
  in Claude Code / Cowork and search for the connector names above."

### 4b. Verify SCOPES, not just connection

A connected MCP with insufficient scopes is the silent-failure trap:
the connection looks fine, then a write step fails mid-flow. Check the
actual granted scopes against what the skills declare.

Each write-path skill declares `requiredScopes` in its frontmatter
(e.g., contract-promote needs `github:issues:write`). Read those
declarations and verify the granted token actually has them:

- For GitHub: check the token/app grants `issues:write`,
  `contents:write`, `pull_requests:write`. If you can't introspect
  scopes directly, note which scopes each skill needs so the user can
  verify in their GitHub settings.
- For Atlassian, Slack, Sentry: same — list the scope each skill
  needs and flag any you can confirm are missing.

Report scope gaps as their own section, mapped to which command will
break:

```
SCOPE GAPS
❌ github:issues:write — MISSING
   → /contract promote will fail at the tracking-issue step
   → Re-authorize GitHub with issues:write, or grant it on the PAT/App
```

This directly prevents the "promote silently failed to open the
tracking issue" class of bug. Better to refuse promote up front than
to half-complete it.

### 5. Check the project config too

In addition to MCPs, verify the local project state:

```
- Is .shipline/contracts/ a directory? (if not, suggest creating it)
- Is .shipline/repos.yml present? (if not, suggest copying from examples/repos.yml.example)
- Is the user's working directory inside a git repo? (some workflows assume yes)
- Does .github/workflows/ contain pr-verify.yml? (only relevant for Phase 1+ — note as info)
```

For each gap, give a one-line fix.

### 6. End with a single recommended next action

Based on what's connected and what's missing, propose ONE next
step. Don't list ten things. The user should be able to take the
next action without thinking.

Examples:

- All required connected, never used Shipline → `/contract new "<a small feature>"`
- Some required missing → "Connect <MCP name> first, then run `/shipline setup` again."
- Everything connected but no repos.yml → "Run `cp ~/.claude/plugins/shipline/examples/repos.yml.example .shipline/repos.yml` and edit it for your repos."

## Tone

- Honest about what's missing — don't soften it.
- Specific about what each missing piece would unlock — vague costs aren't motivating.
- One next action — never a homework list.
- Don't over-emoji. The checkmarks and X's are the only emoji needed.

## When invoked from another skill

If a skill calls you because it hit a missing MCP mid-flow (e.g.,
contract-new tried to fetch a JIRA URL and Atlassian MCP wasn't
connected), be focused:

> "You tried to pull from JIRA, but the Atlassian MCP isn't connected.
> Two ways forward:
>
> 1. Connect the Atlassian MCP (search MCP settings for "Atlassian"),
>    then re-run your command.
> 2. Continue with free-text intake — paste the description from the
>    JIRA ticket and I'll work from that.
>
> Which would you like?"

Don't run the full status table in this case. Stay focused on the
immediate blocker.

## Anti-patterns

- Don't list all 10 MCPs and check off the ones connected — that's
  overwhelming. Group by tier and lead with what blocks the user
  *right now*.
- Don't ask the user to connect optional MCPs unless they're going
  to use the feature that needs them.
- Don't claim something is connected without verifying. If you
  can't introspect, say "I can't detect this automatically — can
  you tell me which of these you have?"
