---
name: contract-pickup
description: Dev-centric flow — dev gets a PRD (JIRA / Google Doc / Slack / Notion / paste / image), agent does the code archaeology, drafts a contract, and sorts every gap into three buckets (auto-fill from code, dev decides, PM must answer). PM stays in their normal tool (JIRA comment, Slack DM); they never have to touch Manifest. Use when the user says "pick up this PRD", "start on this ticket", "I got a doc from PM", or invokes `/contract pickup <source>` / `/pickup <source>`. Beta — this is the dev-driven counterpart to `/contract new`, optimized for the case where the PM authored the spec elsewhere and walked away.
---

# Contract pickup (dev-centric orchestrator) — BETA

The world this skill is built for: the PM wrote a PRD somewhere (JIRA,
Google Doc, Slack, Notion, a screenshot of slides), assigned it to a
dev, and walked away. The dev is the one who has to make the spec
build-ready — using code, history, and dependency context the PM
doesn't have. Manifest's job is to do most of that code archaeology
*for* the dev, then surface only the decisions and questions that
genuinely need a human.

PMs should not have to learn Manifest to use this flow. Their inbox
stays where it already is — JIRA comments or Slack — and the agent
talks to them in the dev's voice through those existing channels.

## What this skill does (in 4 phases)

```
Phase 1: Fetch + expand     →  ~10s  Read the PRD + linked docs + history
Phase 2: Draft + critique   →  ~20s  Draft contract, run critics in parallel
Phase 3: Sort gaps          →  ~5s   Three buckets — auto-fill / dev / PM
Phase 4: Hand off to dev    →        Dev reviews; sends batched questions to PM
```

Total time-to-decision for the dev: about 1 minute of agent work,
then 3–5 minutes of dev review. Compare to today's "read PRD + grep
repo + check Slack + ask around" cycle which can take an hour.

## Inputs

The dev provides any of:

- A URL — JIRA, Linear, Notion, Confluence, Google Doc, Slack
  message link, GitHub issue, Figma file.
- Pasted text — e.g. a copy of a Slack message or email body.
- An image — screenshot of slides, sketch, or a Figma frame export.
- A description in chat — "pick up the search filters thing Pawan
  mentioned in #product-launches yesterday." Agent uses Slack MCP
  to find the thread.

If multiple sources are pasted in one go (URL + a clarification +
"and look at SC-103 for context"), treat them all as input.

## Process

### Phase 1 — Fetch + expand

**1a. Detect source type and route to the right MCP.**

Reuse the source-detection table from `contract-new` SKILL.md.
Add Slack:

| URL pattern | MCP | What to pull |
|---|---|---|
| `<workspace>.slack.com/archives/<channel>/p<ts>` | Slack | Message + full thread + reactions |

For pasted text and images, skip to draft generation in Phase 2.

If the relevant MCP isn't connected, tell the dev exactly which MCP
and offer the paste-as-text fallback. Do not refuse.

**1b. Follow embedded links one level deep.** A JIRA ticket often
links to a Notion page + a Figma frame. A Google Doc often links to a
tech spec + a competitor doc. Fetch all of them in parallel.

**1c. Pull related history in the background, in parallel:**

- **Past contracts on the same surface area.** Search
  `.manifest/contracts/` + `.manifest/archive/` for contracts whose
  behaviors mention the same feature, file paths, or domain
  vocabulary. Especially flag ones with `landed: rolled-back` or
  `landed: partial` — they're full of lessons.
- **Past bugs / postmortems.** Read recent `<ID>.bug-log.md` and
  `<ID>.postmortem.md` files in the archive, filtered to the same
  surface.
- **Recent Sentry clusters** in the affected modules — via Sentry MCP
  if connected.
- **Active concurrent work** — open PRs in the target repo touching
  the same files; in-flight contracts in `.manifest/contracts/`.
- **Past Slack threads with this PM** mentioning this feature — via
  Slack MCP; the dev may not have read them.

Cache the slow-changing parts (codebase event catalog, i18n keys,
dependency graph) — rebuild nightly, reuse during the day.

### Phase 2 — Draft + critique

**2a. Generate the draft.** Invoke the `contract-new` skill with the
fetched material — that skill already knows how to turn a source
+ history into a draft contract. The dev becomes the de-facto author
in the contract's frontmatter (`owner: <dev>`); add a
`promptedBy: <PM>` field too so credit/attribution is preserved.

**2b. Run critics in parallel.** Single Task batch. Include:

- The standard judgment critics that `contract-verify` selects based
  on the contract content (edge-cases, regression, security, etc.)
- The new dev-side critic — `critic-code-context` — which produces
  the auto-fill suggestions and code-context dev-decides items. See
  `skills/critic-code-context/SKILL.md`.

Run with `verifyMode: full` on first pickup (the dev will iterate after
this — first pass needs the full picture). Subsequent re-verifies in
this same pickup session can use `--changed` like the normal verify
flow.

### Phase 3 — Sort gaps into three buckets

Every finding (deterministic + judgment + dev-side) ends up in
exactly one of three buckets. The bucket is the action signal.

**Bucket A — "Agent fills from code/history"** (auto-fill)

The agent already has a high-confidence answer pulled from the repo,
the event catalog, the i18n keys, or a similar past contract. The
dev sees the proposed value and accepts (or edits) with one click.

Examples:
- "perfBudget for chip render — use stack default 50ms?"
- "Event name — use `filter_applied` (matches `events/catalog.ts`)?"
- "Empty-results copy — reuse `i18n/search.no_results`?"
- "AC for B3 — draft from SC-088's combined-filter AC."

Source the candidate from `critic-code-context` output. Always show
*where* the value came from (the file/contract), so the dev can verify
in one glance.

**Bucket B — "Dev decides"** (needs code judgment, not PM judgment)

The agent has surfaced something that requires engineering judgment
the PM can't give. Dev answers from their head.

Examples:
- "Past contract SC-103 (rolled back 2024) had a memory leak in the
  chip component. Use the new pattern from SC-211 instead?"
- "Search endpoint p95 is 50ms; two filters will likely push past.
  Add a cache layer?"
- "Open PR #4421 from @bharath also touches this file path. Conflict
  risk — coordinate?"

Each item has [Yes] / [No] / [Show me more] (which expands the
code/history context). Default action is "ask me, don't assume."

**Bucket C — "Only PM can answer"** (genuine product unknowns)

The agent could not infer the answer from code or history. Needs PM
input. Each item is drafted as a PM-facing question — scoped to a
specific behavior, written in plain language, with the relevant code
or history snippet linked so PM can decide informed.

Examples:
- "B2: top-5 categories from search history, OR static category list?
  PRD just says 'category filter.'"
- "B4: should 'clear all filters' also clear the saved-filters feature
  (SF-012, in build next sprint)?"

Each item has [Ask PM] / [I'll handle it] / [Skip]. The default text
is sendable as-is; dev can edit before sending.

**Presentation.** Output one card in chat (not a file), sorted by
bucket, with counts. Match the format in `docs/PICKUP-CARD-FORMAT.md`
(see "Render the pickup card" below).

### Phase 4 — Hand off to dev

The dev sees the card and acts:

**4a. Burns through Bucket A in seconds.** Each item is a single tap.
Accepted values get written into the contract in memory; deferred to
disk as one batch at the end of the session.

**4b. Walks through Bucket B with their own judgment.** ~2–3 minutes
for a typical small contract. Same in-memory edit pattern.

**4c. Reviews Bucket C — sends batched questions to PM via PM's own
channel.**

- **Channel selection.** Default to the channel the source came from:
  JIRA ticket → JIRA comment; Slack thread → reply in thread; Notion
  → page comment; Google Doc → suggestion comment. Dev can override.
- **Posting.** Agent composes one batched message in the dev's voice,
  not Manifest's. The PM should not be able to tell the agent wrote it
  vs the dev (apart from the dev OK'ing the draft before send). The
  message names the dev as the asker and references the source by its
  identifier (`ENG-1234`, the doc title, etc.), not by Manifest IDs.
- **Per-question blocking flag.** Dev marks each question as blocking
  or non-blocking. Default non-blocking. Blocking questions pause
  implementation on the affected behavior; non-blocking ones let work
  continue and the AC updates incrementally when answered.

Sample posted JIRA comment:

```
Hey Pawan — picking this up, two quick questions before I start:

1. For the category filter (B2 in the PRD), did you mean
   top-5 from search history, or a static list? The PRD says
   "category filter" — leaning toward top-5 since we have the
   data, want to confirm.

2. We're shipping saved-filters next sprint (SF-012). When
   the user taps "clear all filters" — also clear the saved
   filter, or just active ones?

Starting B1, B3, B4 in the meantime. Ping me whenever.
— Anjali (via Manifest)
```

The trailing `— Anjali (via Manifest)` is the *only* place Manifest
identifies itself to the PM. (Optional — controlled by `repos.yml`
setting `pickup.identifyAgent: true|false`. Default true for audit.)

**4d. Write the contract file once at end of session.** All in-memory
edits flush to `.manifest/contracts/<ID>.md`. Single commit.

**4e. Start implementation (optional).** Dev clicks "Start
implementing what's clear." Agent invokes the standard handoff flow
(opens draft PR, posts `@claude /implement`, etc.). Blocked behaviors
are skipped; the implementer agent handles partial implementation
gracefully via the behavior-by-behavior structure already in the
implementer skill.

## Answer watcher

After Phase 4, the agent stays watching for PM answers to the
questions it posted. Implementation can be in flight.

**Polling cadence.** Every 5 minutes for the first 2 hours, every 15
minutes for the next 24, every hour thereafter. Hard timeout: 7 days
(after that, the question becomes stale and is surfaced to the dev as
"do you want to chase Pawan or proceed with your assumption?").

**On reply detected:**

1. Parse the reply. Match each answered question to its `Q-N` ID
   (frontmatter `openQuestions[]` — see `contract-verify` SKILL.md
   for the Q&A pattern).
2. Apply the answer as an AC edit (new AC, refined behavior
   description, or `outOfScope` add) per the Q&A flow described in
   the Q&A section of `contract-verify` SKILL.md.
3. Drop the provenance comment: `<!-- From: Q-N · <PM> · <date> -->`
4. Move the question from `openQuestions` to the sidecar
   `<ID>.qa.md` log file.
5. Re-verify incrementally (`--changed`) on the changed fragments
   only.
6. Ping the dev with a one-line summary of what changed.

If the PM's reply is ambiguous, the agent does NOT guess — it posts
a clarifying follow-up question (in the same thread) and notifies the
dev that a follow-up was sent.

## State stored on the contract

Add to the contract frontmatter:

```yaml
pickup:
  source: <URL or "paste" or "image">
  pickedUpAt: <ISO>
  pickedUpBy: <dev>
  pmChannel: jira | slack | notion | gdoc
  pmIdentifier: <e.g. atlassian user ID, slack user ID>
  openQuestions:
    - id: Q-1
      scope: B2
      text: <PM-facing question text>
      askedAt: <ISO>
      blocking: false
      status: posted | answered | follow-up-sent | stale
  resolvedQuestions: [<Q-IDs that moved to qa.md>]
```

The `qa.md` sidecar file mirrors the pattern used by `findings.md` —
human view of the full back-and-forth.

## Speed levers (don't skip these)

These are what make pickup feel fast vs. clunky.

1. **Run Phase 1 fetchers in parallel.** All MCPs, all linked-doc
   reads, all history pulls — one Task batch.
2. **Cache the codebase analysis.** Event catalog, i18n keys,
   dependency graph, locale-branch list, archived-contracts index.
   Rebuild nightly via `scripts/build-code-context.mjs` (runs locally
   or on the cron in `workflows/code-context-build.yml`); read from
   cache during pickup. Stale cache is OK; flag it but use it.
3. **Critics in parallel** (same as `contract-verify`).
4. **Speculative auto-fill drafting.** While critics run, agent
   pre-drafts Bucket A items for known patterns (perfBudget, event
   names, common ACs). By the time critics return, suggestions are
   ready to render.
5. **Hold contract state in memory across the pickup session.** Write
   to disk once at the end (Phase 4d). No per-edit I/O.
6. **Stream Phase 1 + Phase 2 results to chat as they arrive.** Don't
   make the dev wait for everything before showing anything. Phase 1
   results land first (the fetched material), then critics stream in.
7. **Batched PM message.** One post per session by default. Avoid
   "Pawan, one more thing…" 5 times across the day.

## Anti-patterns

- **Don't refuse on missing MCP.** Offer the paste-fallback.
- **Don't post to PM without dev approval.** Even when the question
  is obvious. The dev's name is on the PM-facing message; respect
  that.
- **Don't surface Manifest IDs to the PM.** Use the PM's identifiers
  (JIRA key, Slack message ts, doc title) in the PM-facing comment.
  `SC-005` never appears outside the dev's view.
- **Don't fill Bucket A without showing source.** Every auto-fill
  proposal must say where the value came from ("from
  `events/catalog.ts`", "from SC-088's combined-filter AC").
- **Don't run pickup AND `contract-new` separately on the same
  source.** Pickup wraps `contract-new`. If the dev invoked
  `contract new <URL>` directly, treat the result as input to pickup
  (warn about the duplication, ask if they want to upgrade to the
  pickup flow).

## Why this is opt-in (beta gate)

Pickup is a substantial flow change — the PM-facing message
generation, the answer watcher, and the cross-channel posting all
touch external systems in ways that are easy to get wrong. We're
beta-gating so teams can opt in repo-by-repo:

```yaml
# repos.yml
pickup:
  enabled: true
  identifyAgent: true       # add "— <dev> (via Manifest)" footer
  defaultChannel: jira      # override per-source if needed
  blockingByDefault: false  # questions are non-blocking unless dev flags
  cacheTTL: 24h             # codebase analysis cache lifetime
```

Without `pickup.enabled: true`, the `/contract pickup` command falls
back to running `/contract new` with a notice. No surprises.

## See also

- `skills/contract-new/SKILL.md` — the source-fetcher + drafter that
  pickup wraps.
- `skills/contract-verify/SKILL.md` — the critic runner + Q&A pattern
  that pickup reuses.
- `skills/critic-code-context/SKILL.md` — the new dev-side critic
  that feeds Bucket A.
- `commands/contract.md` — the `/contract pickup` subcommand entry.
- `scripts/build-code-context.mjs` — cache builder; output at
  `.manifest/.cache/code-context.json`.
- `scripts/answer-watcher.mjs` — PM-reply detection harness; emits a
  JSON report this skill consumes in apply-mode.
- `workflows/code-context-build.yml` — nightly cache rebuild.
- `workflows/answer-watch.yml` — 15-minute answer-watch cron.
