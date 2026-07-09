---
name: contract-new
description: Author a new Manifest contract from a rough idea, a one-liner, OR a link to an existing source of truth — JIRA ticket, Linear issue, Notion page, Confluence doc, GitHub issue, or Figma file. Use when the user says "new contract", "draft PRD", "spec out a feature", "pull contract from this JIRA ticket", or invokes `/contract new` with either prose or a URL. Pre-fills as much of the contract as possible from the source, then asks the user only what's still missing.
---

# Contract intake

Your job is to turn a feature idea — however the user expresses it —
into a draft contract the critics can verify. Be opinionated, not
exhaustive. The critics will find the gaps. Aim for a *good* first
draft in under 5 minutes of user time when the user provides a source
link, or under 10 minutes when starting from prose.

## Input modes

Detect which mode the user is in from their input:

### Mode A — Source link (preferred when possible)

The user pastes a URL. Detect the type and route:

| URL pattern | MCP to use | What to pull |
|---|---|---|
| Any JIRA link — `browse/<KEY>`, `…?selectedIssue=<KEY>`, `…/issues/<KEY>` (see below) | Atlassian / JIRA | Summary, Description, AC field, Comments, Attachments, Linked issues, Labels |
| `*.atlassian.net/wiki/spaces/<...>` | Atlassian / Confluence | Page content, child pages |
| `linear.app/<org>/issue/<KEY>` | Linear | Title, Description, Sub-issues, Labels, Project |
| `notion.so/<...>` | Notion | Page content, sub-pages, databases |
| `docs.google.com/document/...` | Google Drive (if connected) | Document content. If the Google Drive MCP isn't connected, tell the user to paste the doc content as text and continue in Mode B. |
| `github.com/<org>/<repo>/issues/<N>` | GitHub | Title, Body, Comments, Labels, Linked PRs |
| `figma.com/file/<...>` | Figma | File frames, comments, frame names |

**JIRA sharable links.** Users paste board/deep/share links, not just
`browse/<KEY>`. Extract the issue key by scanning the whole URL for the first
`[A-Z][A-Z0-9]+-\d+` — it covers `browse/PROD-1234`,
`…/boards/12?selectedIssue=PROD-1234`, and `…/jira/software/c/projects/PROD/issues/PROD-1234`.
See `reference/JIRA-SYNC.md` for the full table. A board link with no key → ask
for the specific ticket.

Then **also** scan the fetched content for *additional* embedded links
(Figma frames inside JIRA, Confluence inside Notion, etc.) and fetch
those too. The richest contracts come from following the link chain
one level deep.

### Mode B — Free-text description

The user describes the feature in prose. Use the five-question
interview (see "Five-question intake" below).

### Mode C — Hybrid

User provides a link AND adds context ("here's the JIRA, but
specifically focus on the mobile parts"). Fetch the link, then take
the user's hint as steering for which behaviors to prioritize.

## Process

### 1. Resolve input — check the MCP first

If a URL was provided, FIRST check whether the relevant MCP is
connected before trying to fetch. If it isn't, invoke the
**setup-check** skill briefly to inform the user, then offer two
paths:

1. Connect the MCP and re-run the command.
2. Continue with free-text intake — paste the description from the
   ticket and proceed as Mode B.

Don't fail with a cryptic MCP error. Always give the user a path
forward.

If the MCP is connected, fetch via the appropriate MCP. Examples
for JIRA:

```
# Get the ticket (issueKey extracted from the link — see reference/JIRA-SYNC.md)
getJiraIssue({ issueKey: "PROD-1234" })

# Get linked / sub-issues
searchJiraIssuesUsingJql({ jql: "parent = PROD-1234" })
```

(Tool names shown without the `mcp__<connector-id>__` prefix — match by name;
load them via `ToolSearch` first in Cowork where connectors are deferred.)

For Figma links found in the JIRA description:

```
mcp__figma__get-file({ fileKey: <extracted-from-url> })
```

For Confluence pages linked from JIRA:

```
mcp__atlassian__get-page({ pageId: <extracted-from-url> })
```

### 2. Check existing contracts

Read `.manifest/contracts/` to see used IDs. Pick the next unused ID
using a sensible prefix derived from:
- The JIRA project key (e.g., `AUTH-` if the ticket is in the AUTH
  project)
- Or a keyword from the feature title
If the directory doesn't exist, create it.

### 3. Extract structured fields

From the fetched source, attempt to extract:

| Contract field | Where to look |
|---|---|
| `title` | JIRA summary / Linear title / Notion page title |
| `Goal` | JIRA description first paragraph; Linear description; Notion intro |
| `platforms` | Labels (e.g., `mobile`, `web`, `ios`), components, custom fields |
| `Success metrics` | "Success criteria" or "Goals" sections; OKR refs |
| `Behaviors` | Acceptance Criteria field, user story bullets, "How it works" |
| `Acceptance criteria` | Given/When/Then sections, bullet ACs |
| `Out of scope` | Explicit "Out of scope" headers; "Not in this iteration" |
| `Open questions` | "Questions" / "TBD" / "@-mention questions in comments" |

For Figma frames, list each frame name as a candidate UI state to
reference in `commsStates`. Don't try to extract actual designs;
just enumerate frame names so the comms-completeness critic can
check coverage.

### 4. Identify what's still missing

Compare your extracted draft against the contract format:

- Is there at least one success metric with a quantitative target?
- Are behaviors clearly enumerated, each with at least a draft AC?
- Are all platforms in scope mentioned?
- Are out-of-scope items explicit (preventing scope creep)?

For anything missing, prepare a SHORT follow-up question. Cap at 3
questions — anything more becomes the critics' job, not intake's.

Common gaps to ask about:
- Success metric target ("the JIRA says 'increase conversion' — by
  how much, in what window?")
- Platform scope ("the ticket has a `mobile` label — both iOS and
  Android, or just one?")
- Out-of-scope ("anything from the description we're *not* doing in
  this iteration?")

### 5. Five-question intake (Mode B fallback)

If no link was provided OR the link's content is too sparse to
auto-extract, fall back to the five-question interview:

1. *What problem does this solve, for whom, and why now?*
2. *Which platforms — web, iOS, Android, server, email — are in scope?*
3. *What's the single quantitative success metric and target?*
4. *What are the 2–5 main user behaviors this feature introduces?*
5. *What's explicitly out of scope?*

Ask all five in one round, not back-and-forth.

### 6. Draft the contract

Use the format in `reference/CONTRACT-FORMAT.md` at the plugin root. Required
sections:

- YAML frontmatter, written in **two labelled groups** so the author
  knows what's theirs (see CONTRACT-FORMAT "Editing a contract"):
  a `# ── YOU AUTHOR (edit these) ──` group (id, title, changeType,
  platforms, createdBy) and a `# ── MANIFEST MANAGES — don't edit ──`
  group (status=draft, complexity=null, revision=1, the cycle-time
  timestamps initialized to null, fix counters, guard/rollout fields,
  bugFollowups). Keep optional blocks (`rollbackTriggers`, `rolloutPlan`)
  out unless needed — note they're optional and deletable.
- **`changeType`** — set `bug-fix` when the source is a bug (JIRA bug
  issue type, a link/description that says "fix"/"broken"/"regression",
  or an existing-behavior defect); else `feature`. **This is the single
  biggest guard against over-engineering a small bug** — a bug-fix
  contract scaffolds and verifies lean (see below).
- `source:` field in frontmatter pointing back to the original
  JIRA/Linear/Notion URL — this is the audit trail
- `## Goal`
- `## Success metrics` — at least one for a `feature`, with eventName
  placeholder if the user doesn't know it yet. **For `bug-fix`: OMIT
  this section** (or write one line: "the bug no longer reproduces; a
  regression test covers it"). Do NOT invent a new analytics event for
  a bug fix.
- `## Behaviors` — each as `### B<N>. <Imperative description>` with
  placeholder fields for instrumentation, perfBudget, commsStates. **For
  a `bug-fix`, keep behaviors minimal and use `instrumentation: none`**
  unless the bug is literally "we aren't measuring X". Don't enumerate
  speculative edge cases — put them in Out of scope as follow-ups.
- `## Acceptance criteria` — at least one Given/When/Then per
  behavior, numbered AC1, AC2, ...
- `## Diagrams` — **optional**: add a Mermaid flowchart only when a
  branching/state/multi-actor flow makes the contract clearer; skip it
  for a simple change or a bug-fix. (It renders in IDE markdown preview,
  or via `/contract diagram <ID>` → standalone HTML.)
- `## Out of scope`
- `## Open questions` — explicitly note anything the user or the
  source couldn't answer

### 7. Write the file

Write to `.manifest/contracts/<ID>.md`.

### 8. Link back to the source

If the input was a JIRA/Linear/etc URL, post a comment on the source
ticket linking to the contract:

```
mcp__atlassian__add-comment({
  issueKey: "PROD-1234",
  body: "📋 Manifest contract drafted: [<ID>](<repo-url>/.manifest/contracts/<ID>.md). Run `/contract verify <ID>` to surface gaps."
})
```

This makes the contract discoverable from JIRA and creates a
two-way link.

### 9. Offer to auto-verify

After writing the file, tell the user:

- "Draft saved to `.manifest/contracts/<ID>.md`."
- "Pre-filled from: <source URL>. Confidence: <high|medium|low>
  based on how complete the source was."
- "Open the file, edit anything off, then run `/contract verify <ID>`
  to surface gaps. Or want me to run verify now?"

If the user says yes, **chain immediately to `/contract verify`**.

## Be opinionated

- If the user says "web and app", default to `[web, ios, android]`
  and ask them to remove the ones not in scope. Over-coverage is
  safer.
- If they don't have a success metric, propose one based on the
  feature type and ask them to confirm. Don't leave it blank — the
  instrumentation-coverage critic will block readiness.
- For each behavior, propose a draft Given/When/Then AC.
- For JIRA tickets where the Description is a one-liner, treat it
  as Mode B (free-text) and ask the five questions — don't fake
  detail you don't have.

## Anti-patterns

- Don't fabricate behaviors or success metrics that aren't in the
  source. If the JIRA ticket is sparse, ask the user, don't
  hallucinate.
- Don't ask 20 questions; cap at 5 in Mode B or 3 in Mode A.
- Don't auto-promote after writing. Promotion is a deliberate human
  action (it starts the SLA timer and freezes a revision).
- Don't try to fill in instrumentation or perf budgets — those are
  critic jobs once the basics are in place.
- Don't promise the contract is complete; tell the user critics
  will catch gaps.
- Don't write the contract before showing the user the extracted
  draft for confirmation when in Mode A. They need a chance to
  correct extraction errors.
