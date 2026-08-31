# JIRA sync — links in, tickets out, kept live

The single source of truth for how Manifest talks to JIRA. Three jobs:

1. **Read** — accept *any* JIRA link a human pastes and resolve it to an issue.
2. **Create** — auto-generate well-detailed tickets at planning time (opt-in).
3. **Update** — keep those tickets current as the work moves (progress, blockers).

All three run through the user's Atlassian connector. This doc is referenced by
`contract-new`, `contract-pickup`, `ready-check`, `contract-promote`,
`contract-decompose`, and `implement`.

## Connector tools & discovery

The Atlassian connector exposes these tools (names are stable; the
`mcp__<connector-id>__` prefix is an opaque per-install hash — **match by tool
name, never a guessed prefix**):

| Job | Tool |
|---|---|
| Read one issue | `getJiraIssue` |
| Search (JQL) | `searchJiraIssuesUsingJql` |
| Create issue | `createJiraIssue` |
| Edit issue (fields/description) | `editJiraIssue` |
| Comment | `addCommentToJiraIssue` |
| Move status | `transitionJiraIssue` (+ `getTransitionsForJiraIssue` first) |
| Link issues | `createIssueLink` (+ `getIssueLinkTypes`) |
| Project/issue-type metadata | `getVisibleJiraProjects`, `getJiraProjectIssueTypesMetadata` |
| Resolve assignee | `lookupJiraAccountId` |

**Discovery (Cowork especially).** Connector tools are *deferred* — they are NOT
in the tool list until loaded with `ToolSearch`. Before concluding Atlassian is
unavailable, run `ToolSearch` for the tool you need (e.g. `getJiraIssue`,
`createJiraIssue`). Only if it returns nothing is the connector genuinely not
connected — then say so and fall back (paste text / skip the ticket). Never
report "not connected" without having searched.

## 1. Read — accept any sharable JIRA link → issue key

Humans paste many URL shapes. Extract the **issue key** (`[A-Z][A-Z0-9]+-\d+`,
e.g. `PROD-1234`) from whichever of these you get, resolve the cloud once, then
call `getJiraIssue({ cloudId, issueIdOrKey: key })`:

| What the human pastes | Where the key is |
|---|---|
| `https://SITE.atlassian.net/browse/PROD-1234` | path: `browse/<KEY>` |
| `…/browse/PROD-1234?focusedCommentId=…` | path before `?` |
| `…/jira/software/projects/PROD/boards/12?selectedIssue=PROD-1234` | query: `selectedIssue=<KEY>` |
| `…/jira/software/c/projects/PROD/issues/PROD-1234` | path: `issues/<KEY>` |
| `…/jira/software/projects/PROD/boards/12/backlog?selectedIssue=PROD-1234` | query: `selectedIssue=<KEY>` |
| `…/jira/core/projects/PROD/board?selectedIssue=PROD-1234` | query: `selectedIssue=<KEY>` |
| A raw key: `PROD-1234` | as-is |

**Rule:** scan the whole URL for the **first** match of `[A-Z][A-Z0-9]+-\d+` — in
practice it appears in exactly one of `selectedIssue=`, `/issues/<KEY>`, or
`/browse/<KEY>`. That one regex covers every format above, including short
"Share → Copy link" URLs. If a link has NO key match (a board/backlog link with
no `selectedIssue`), tell the human it points at a board, not an issue, and ask
for the specific ticket link.

The current Atlassian Rovo schemas also require a `cloudId` and call the issue
argument `issueIdOrKey`. Resolve `cloudId` once with
`getAccessibleAtlassianResources`, then use
`getJiraIssue({ cloudId, issueIdOrKey: key })`. Creation uses
`createJiraIssue({ cloudId, projectKey, issueTypeName, summary, description,
additional_fields })`; comments use `commentBody`; transitions use the ID
returned by `getTransitionsForJiraIssue`. Manifest plans expose these exact
argument shapes while still matching tools by their stable suffix.

After fetching, also scan the issue Description/Comments for **embedded links**
(Figma frames, Confluence pages) and follow those too — richest context comes
from the link chain.

## 2. Create — auto-generate tickets at planning (opt-in)

**When it can happen (dev's choice — always opt-in, never automatic):**

- **At `/contract pickup`** — right after the contract is drafted, the dev can
  create/update the ticket *early* for visibility. Best when the source **was
  already a JIRA ticket**: update that ticket in place rather than making a new
  one. The contract is still draft here, so an early ticket will keep changing —
  that's fine, the §3 update hooks keep it current.
- **At `/contract promote`** — the canonical point (plan is frozen): epic + AC
  sub-tasks, full detail.
- **At `/contract decompose`** — epic + one child issue per child, with
  dependency links.
- **Anytime on demand** — the dev can just say "create/update the JIRA ticket(s)"
  and the skill runs this section against the current contract.

**Idempotency — never double-create.** Whoever creates first stores the key in
frontmatter (`jira.issue` / `jira.epic` / a child's `jira`). Every later entry
point **checks for an existing key and *updates* that ticket** (`editJiraIssue`)
instead of creating a new one. So "create early at pickup" and "create at
promote" converge on the same ticket, never two.

**What the dev confirms** before any create:

> "Create the JIRA tickets for this now? (epic + N child issues in project PROD)"
> — proceed only on an explicit yes. Confirm the **project key** and **issue
> type** first; never guess the project.

**What a generated ticket carries (all details, not a stub):**

- **Summary** — the contract/child title.
- **Description** (markdown) — problem/goal, the acceptance criteria as a
  checklist, platforms/scope, the design link, success metric, the
  `Ready-Check:` gate code, and a link back to the contract markdown in the repo.
- **Issue type** — Epic for the parent; Story/Task for children (ask; default
  Story). Risky/human-led children (migrations, auth) get a label `human-led`.
- **Fields** — `duedate` = the contract's `slaDeadline`; `labels` include
  `manifest` and the size (`small`/`medium`/`large`); assignee = the child's
  `owner` if set (`lookupJiraAccountId`).
- **Hierarchy & deps** — children link to the epic (parent/Epic-Link); each
  `dependsOn` becomes a "is blocked by" `createIssueLink` between the child keys.

**Store the keys back** in the contract frontmatter so later steps can update the
right ticket:

```yaml
jira:
  epic: PROD-1200          # promote/decompose (epic)
  issue: PROD-1201         # single-contract promote, or a child
  project: PROD
children:                  # decompose only, mirrors the child list
  - { id: SC-a, jira: PROD-1201, owner: be-dev,   repo: api }
  - { id: SC-b, jira: PROD-1202, owner: fe-dev-1, repo: web }
```

If a contract **came from** a JIRA link, prefer **updating that existing ticket**
(`editJiraIssue`, `fields.description`) over creating a new one — no duplicates.
Always show the dev the ticket body and confirm before writing.

## 3. Update — keep tickets live as work moves

Once a ticket exists (`jira.issue` / `jira.epic` / a child's `jira`), each
lifecycle event posts to it. Transitions use the ticket's **real** workflow —
call `getTransitionsForJiraIssue` and pick by name (don't hard-code IDs; map to
the nearest of To Do / In Progress / In Review / Done / Blocked).

| Event (skill) | JIRA action |
|---|---|
| `implement` starts | Transition → **In Progress**; comment "🛠️ Implementation started · contract `<ID>` · branch `<branch>`." |
| AC / milestone done | Comment a short progress line ("✅ AC2 done — 3/5 acceptance criteria passing"). Batch per iteration, don't spam per commit. |
| **Blocker** hit | Comment "⛔ Blocked: `<reason>`"; add label `blocked`; transition → **Blocked** if that status exists. For a PM-answer blocker, @-mention the PM and note the SLA is paused (`ballLedger`). |
| PR opened | Transition → **In Review**; comment with the PR link. |
| `verify-pr` / `code-review` verdict | Comment the pass/fail summary + the review link. |
| `verify-deploy` verdict | Comment canary-readiness. |
| `/launch` verdict | Comment **landed / partial / not-landed**; if landed and the child is a leaf, transition → **Done**. |
| Rollback / `/postmortem` | Comment the rollback + postmortem link; reopen (transition back) and link the follow-up issue. |
| `/status` | **Read-only** — never writes; it may *read* the ticket's current status to show alongside the Manifest phase. |

**Guardrails.**
- **Comment, don't overwrite.** Progress goes in comments; only `promote`/manual
  edits rewrite the Description. Never clobber a human's edits to the ticket body.
- **Confirm side-effects the first time**, then it can run inline for the rest of
  that session (transitions and comments are the expected cadence, not surprises).
- **Degrade cleanly.** If Atlassian isn't connected, do the Manifest-side work and
  report exactly what didn't sync ("done; skipped JIRA — Atlassian not
  connected"). Never block the actual work on the tracker.
- **Epic rollup.** When every child transitions to Done and the metric moves, the
  epic can go Done — mirrors "landed only when all children land" (`epicRollup`).
