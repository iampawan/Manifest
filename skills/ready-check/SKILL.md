---
name: ready-check
description: The PM-side readiness gate — "airport security for PRDs." A PM (or anyone) gives a PRD as any source — JIRA / Linear / Notion / Confluence / Google Doc / Slack link / GitHub issue / Figma URL, pasted text, an image, or a plain description — and the agent scores it against the Definition of Ready, surfaces the blockers the PM can fix themselves in plain language, and (when ready) mints a tamper-evident gate code + a clean hand-off for dev. Runs identically in Claude Code and Cowork. Use when the user says "ready check", "is this PRD ready", "check my PRD before dev", "gate this requirement", or invokes `/ready-check <source>` / `/ready <source>`. This is Level 1; the dev-side deep pass is `/contract pickup`.
---

# Ready Check (PM-side gate)

The world this is built for: a PM has a PRD and is about to hand it to
engineering for grooming and estimation. Today, half-baked PRDs get through,
dev chases the PM for basics, and dev eats the delay. Ready Check is the cheap,
2-minute check the PM clears *first*. Green → a gate code + hand-off; anything
missing → the exact gaps, in plain language.

It is deliberately a **floor**, not the deep judge. The precise, code-grounded
review (regression, security, feasibility, estimate) is Level 2 —
`skills/contract-pickup`, dev-side. Read `reference/READY-CHECK-RUBRIC.md` for
the rubric and the PM-vs-dev dividing line.

## Works for EVERY PRD — frontend, backend, API, data, infra

This gate is **stack-neutral**. It is not a UI-only tool, and there is no "this
is backend, the tool doesn't apply" escape. Every rubric item has a sensible
reading for a pure-backend or API PRD — treat the item, not the label:

| item | frontend reading | backend / API / data reading |
|---|---|---|
| `design` | Figma / mock link | **interface / contract spec** — OpenAPI, proto, GraphQL schema, event schema |
| `states` | empty / loading / done / error copy | **response & failure contract** — 2xx/4xx/5xx codes, error bodies, ret/idempotency |
| `flows` | screens touched | **endpoints, jobs, queues, consumers** touched |
| `scope` | platforms (iOS/Android/web) | **services** in scope, and what's explicitly out |
| `l10n` | copy final & localised | **response/payload format** finalised (schema version, error codes) |
| `writer` | writer/creator surface | **downstream consumers** (services, webhooks, subscribers) |
| `events` | analytics events | **metrics / logs / traces** (latency, error-rate, throughput) |

A backend PRD is **not** cleared by N/A-ing the UI items — it's cleared by
answering the backend equivalents above. If a PM says "it won't work, this is
backend," that's the signal to run it with these readings, not to skip it.

## Runs in both surfaces

This skill is plain markdown + one deterministic script, so it behaves
identically in **Claude Code** and **Cowork**. The offline web page
(`gate/prd-readiness-gate.html`) is the same rubric for PMs with no Claude
open; it mints the same gate-code format, so a code from any surface verifies
in all of them.

## Opening & auto-syncing the live panel in Cowork (the artifact)

**Prefer the chat flow.** Running `/ready-check <link>` in chat is the primary,
most reliable experience — it renders a live, panel-like **scorecard** (Phase 4)
and fixes are a one-line reply. It has none of the sandbox limitations of the
artifact (no per-user connector wiring, no snapshot/version drift, no flaky
in-page bridge), so lead with it. The sidebar panel below is an **optional**
convenience for PMs who want an always-open surface; when a PM hits panel
trouble (a link won't fetch, a stale build), the answer is "run `/ready-check
<link>` in chat" — it just works.

In **Cowork**, you can also give the user a persistent sidebar panel — the
artifact built from `gate/ready-check-cowork.html`, where the deterministic gate
runs in-page and the edge-case review is done by Claude via
`window.cowork.askClaude` (no backend). The plugin can't ship the artifact itself
(plugins bundle skills/commands, not artifacts), so create it on demand.

**The pinned panel is a saved *snapshot*, not a live link to the plugin file.**
Cowork stores a *copy* of the HTML when the artifact is created and never
re-reads the plugin file on its own — so the panel does **not** magically update
when the plugin updates. It only refreshes when THIS skill reconciles it with
`mcp__cowork__update_artifact`. To make that reliable, run the reconciliation
below **at the start of every Cowork invocation of ready-check** (not only
`/ready-check panel` / "open the panel") — that way the pinned page self-heals
to the current build whenever the PM uses Ready Check. It's cheap: one
`list_artifacts` plus at most one `Read`.

**Reconcile (create-or-update, id `ready-check`):**

1. **List.** Call `mcp__cowork__list_artifacts`; find the artifact whose id is
   `ready-check` and note its `path`.
2. **Compare build numbers — read them from the file contents, not the path.**
   Both the plugin's bundled `gate/ready-check-cowork.html` and the stored
   artifact carry `<meta name="ready-check-build" content="N">`. `Read` the
   bundled file and, if the artifact exists, `Read` the file at its `path`, and
   parse the integer `N` from that meta tag in each. (Reading `N` "from the path
   string" — the old instruction — never worked; that's why the panel went
   stale. You must open the file and read the tag.)
3. **Act on the comparison:**
   - **No `ready-check` artifact yet** → create it (fields below).
   - **Bundled N > stored N** → the plugin shipped a newer panel: this is the
     step that was being skipped. Call `mcp__cowork__update_artifact` with `id`
     `ready-check`, `html_path` = the **baked scratch file** (the bundled panel with
     `__RC_ATLASSIAN_MCP__` replaced by THIS user's discovered prefix — see the bake
     step under the create fields), a one-line `update_summary` (e.g. "Ready Check
     panel → build N"), **and re-pass `mcp_tools` with THIS user's Atlassian tools**.
     Both matter: the id is unique per user, so a panel that shipped with someone
     else's id (or none) can't fetch links until it's re-baked + re-granted here.
     Approve and the pinned page updates in place.
   - **Stored build unparseable / missing tag** (a pre-build-tag artifact) → treat
     as older and update it.
   - **Equal (or stored ≥ bundled)** → do nothing; only mention "already current"
     if the user explicitly asked to open/refresh the panel.
   Never create a second artifact with the same id.

   **Discover this user's Atlassian prefix first** — `ToolSearch` for
   `getJiraIssue` and take its `mcp__<id>__` prefix. The connector id is unique
   per user, so this must be discovered in THIS user's session, never hardcoded.

   **BAKE that prefix into the panel HTML before creating/updating** — this is
   what makes link-fetch work reliably for every user (not just whoever's id was
   shipped). Don't pass the bundled file directly: `Read`
   `gate/ready-check-cowork.html`, replace the literal token `__RC_ATLASSIAN_MCP__`
   with the discovered prefix (e.g. `mcp__abc123__`), `Write` the result to a
   scratch file, and use THAT scratch file as `html_path` for both
   `create_artifact` and `update_artifact`. (If Atlassian isn't registered, leave
   the token as-is — the panel then cleanly prompts "paste the text / use
   /ready-check in chat" instead of calling a wrong id.) A manual
   `setAtlassianConnector('mcp__<id>__')` in the panel console still overrides.

   Then call `mcp__cowork__create_artifact` with:
   - `id`: `ready-check`
   - `html_path`: the **baked scratch file** (not the bundled file)
   - `description`: "Ready Check (live) — PM-side PRD readiness gate; smart
     edge-case review via Claude, no backend."
   - `mcp_tools`: the concrete per-user tool names — `<ATLASSIAN>getJiraIssue`,
     `<ATLASSIAN>getAccessibleAtlassianResources`, `<ATLASSIAN>getConfluencePage`,
     `<ATLASSIAN>editJiraIssue`, `<ATLASSIAN>createJiraIssue`,
     `mcp__figma-rest__get_file_version`, `mcp__figma-rest__audit_design`. Drop any
     whose connector the user hasn't registered. The baked prefix and the
     `mcp_tools` you pass must be for the SAME connector.
4. **Tell the user** the panel is in their Cowork sidebar (created / refreshed /
   already current) and persists across sessions. Worth surfacing what it does:
   - **Deterministic score & gate** — checking a PRD drafts answers from the PRD
     (each marked ✨ to review) and scores them; the result is **cached per PRD**
     (by content hash), so re-checking the *same* PRD always returns the *same*
     score — no drift. Edit the PRD to re-analyze. The gap findings are a helper
     (advice); a slow review bridge can't lock the PM out, and a cached PRD
     re-checks instantly with no bridge call.
   - **Playbook** (header) — good-vs-weak examples for all 13 fields, plus an
     inline "see example" on each field.
   - **Verify** (header) — dev pastes a hand-off → authentic / tampered /
     not-ready / invalid. In the PRD field paste a JIRA/Confluence **link** and
     it fetches the live doc to check source-version drift + content hash. Same
     freeze check as pickup, one click.
   - **Draft-from-idea** — "✨ Only have an idea?" drafts a starter PRD skeleton.
   - **Readiness score** ring + strong/weak sample buttons; green/red status dot.
   - **Design audit** — the panel is a sandbox and **cannot** reach the local
     `figma-rest` connector, so when a Figma link is present it tells the PM to
     run the design audit in **chat** (`/ready-check <figma-link>`) or dev-side
     pickup. The audit itself (platforms, states, placeholder copy) runs there —
     see Phase 3 item 6. The panel is deliberately just the **gate + hand-off**
     (checklist, score, smart review, JIRA/Confluence link *fetch*, gate code) —
     it no longer generates or publishes a PRD; dev picks up the hand-off with
     `/contract pickup`.
5. **Prompt for the connectors the panel uses**, and note which are missing so
   the user can authorize them in Cowork connector settings:
   - **Atlassian** — powers JIRA-issue & Confluence-page *fetch* and *publish*
     (update a linked ticket / create a new one). Without it the panel still
     works on pasted text; links just can't be fetched or published.
   - **Figma REST** — (for the v0.22 design-freeze: validate a design link,
     capture its version, export a snapshot). Note: the Figma **Dev Mode MCP**
     is NOT the one to use here — it needs the desktop app with the file open
     and exposes no file version, so it can't validate arbitrary links or pin
     versions. Design-freeze needs a Figma **REST** connector / token.
   The panel ships with `ATLASSIAN_MCP` and `FIGMA_MCP` (`mcp__figma-rest__`)
   set. If a user hasn't registered one of those connectors, blank its CONFIG
   line at the top of the panel HTML and drop its tools from `mcp_tools` so the
   panel degrades gracefully instead of erroring.

Bump the `ready-check-build` number in `gate/ready-check-cowork.html` whenever
you change that file, so the reconciliation above can tell "newer" from "same."
Two things gate whether a PM actually sees a new panel: (1) the **plugin** must be
updated in their Cowork — the pinned page is only ever as new as the bundled
`gate/ready-check-cowork.html`; if the plugin is still on an old version there's
nothing newer to push. (2) the **skill must run** so it can call
`update_artifact` — Cowork does not watch the file, so "auto" here means "on your
next `/ready-check`", not "instantly on plugin update." If a PM is stuck on an old
panel, have them update the Manifest plugin, then run `/ready-check` once (or
`/ready-check panel`) to pull the latest build.

Only works in Cowork (the artifact bridge is Cowork-only). In Claude Code there
is no sidebar panel — the `/ready-check` chat flow is the way. If the bundled
HTML can't be found, fall back to telling the user to open
`gate/ready-check-cowork.html` from the plugin folder directly.

**Optional — JIRA/Confluence-link fetching in the panel.** The panel can fetch a
pasted Atlassian link through the user's connector, but the connector-id is an
opaque per-install hash, so it must be **discovered, not hard-coded**. When you
create/update the artifact:

1. **Discover the prefix.** `ToolSearch` for `getJiraIssue` (and
   `getAccessibleAtlassianResources`). Take the returned tool name and extract its
   `mcp__<connector-id>__` prefix.
2. **Pass the tools** in `mcp_tools` (`…getJiraIssue`,
   `…getAccessibleAtlassianResources`, `…getConfluencePage`, and, if publishing,
   `…editJiraIssue` / `…createJiraIssue`).
3. **Point the panel at that prefix.** The panel reads the prefix from
   `localStorage['rc-atlassian-mcp']` (falling back to a documented default), and
   exposes `setAtlassianConnector('mcp__<connector-id>__')` for a dev to set it by
   hand from the console. Tell the user the one-liner if their links aren't being
   picked up. Broaden-URL handling now also accepts sharable/Rovo links and links
   with a little surrounding text, so a plain `browse/KEY` isn't required.

If no Atlassian connector is registered, Atlassian links simply prompt the PM to
paste the text or use `/ready-check <link>` in chat (which fetches via the
connector regardless of the panel).

## The engine vs the judgement

Two layers, mirroring how contracts work (`validate.mjs` + critics):

- **Deterministic engine — `scripts/ready-check.mjs`.** Scores presence +
  specificity of every required item, mints/verifies the gate code, renders the
  hand-off. Never an LLM guess. You MUST call it for the verdict and the code —
  do not eyeball readiness or invent a code.
- **Judgement — you.** On top of the engine, run the *text-judgeable* critics
  so the PM sees real blockers, not just empty fields: is the goal measurable,
  are obvious edge cases missing, are the UI states named, is the metric a
  number. This is what makes the check smart instead of a checklist.

## Process (5 phases)

```
1 Fetch + expand   Read the PRD from whatever source was given
2 Map to answers   Fill the 11 items from the text; ask the PM only what's missing
3 Judge            Run text-judgeable critics; flag blockers in plain language
4 Score + mint     Call ready-check.mjs → verdict; if ready, gate code + hand-off
5 Hand off         PM pastes the hand-off into the ticket / dev thread
```

### Phase 1 — Fetch + expand

Accept any input: a URL (JIRA, Linear, Notion, Confluence, Google Doc, Slack
message, GitHub issue, Figma), pasted text, an image (screenshot of slides / a
Figma frame), or a plain description. Fetch it with the matching MCP or reader.
If it's a Figma link, treat that as the design artifact for item 3. If multiple
sources are pasted, use them all.

**Fresh fetch, every run — never answer from a previous PRD.** Each invocation is
about the source given *right now*. Follow this every time, with no shortcuts:

1. **Fetch the current source before you judge anything.** Do not emit a verdict,
   score, or gate code until you have actually fetched THIS source in THIS run and
   can quote specifics from it. A confident-looking answer that isn't grounded in a
   fresh fetch is the bug PMs reported ("it showed results for the previous PRD").
2. **Echo what you fetched back to the PM first** — the issue key / page id and the
   title (e.g. *"Fetched ENG-1421 'FTC enhancement — pre-auth flow'; analysing this
   one."*). This lets a wrong or stale doc get caught immediately.
3. **A new link/source discards the previous one.** If the PM gives a different PRD
   than a moment ago, start clean — do not carry over the earlier PRD's answers,
   findings, or verdict. When in doubt, treat it as a brand-new check.
4. **If the fetch fails, say so and stop** — ask the PM to paste the text or connect
   the source. Never fall back to answering from memory or an earlier run.

**Discover the connector before deciding it's missing (Cowork especially).** In
Cowork, connector tools are *deferred* — they do **not** appear in your tool list
until you load them with `ToolSearch`. So a Confluence/JIRA/Notion link does not
mean "not connected" just because you don't see the tool yet. When the source is
such a link:

1. **Search for the fetch tool first.** Call `ToolSearch` with the obvious
   keywords before concluding anything — e.g. `confluence page`, `getConfluencePage`,
   `jira issue`, `getJiraIssue`, `notion page`. If a matching tool comes back,
   it's connected; load it and fetch. (Atlassian typically exposes
   `getConfluencePage`, `searchConfluenceUsingCql`, `getJiraIssue`,
   `getAccessibleAtlassianResources` under a `mcp__<connector-id>__…` prefix; the
   `<connector-id>` is an opaque hash, so match by the tool *name*, not a guessed
   prefix.)
2. **If ToolSearch returns nothing**, then the connector genuinely isn't
   registered — *now* ask the PM to paste the text or upload the doc, and mention
   they can connect Atlassian in Cowork connector settings to skip this next time.
   - **Sharable JIRA links work too**, not just `browse/<KEY>`. Extract the issue
     key by scanning the URL for the first `[A-Z][A-Z0-9]+-\d+` (covers
     `selectedIssue=`, `/issues/<KEY>`, `browse/<KEY>`), then `getJiraIssue`. See
     `reference/JIRA-SYNC.md`.
   - **Confluence TINY links work too** — the `…/wiki/x/<id>` form PMs actually copy
     from the Share button (e.g. `…/wiki/x/Z4IElg`) has **no numeric page id**. Don't
     reject it: `getConfluencePage` accepts the tiny-link id as `pageId` directly.
     Take `/pages/(\d+)` if present, else `/wiki/x/([A-Za-z0-9_-]+)`, and pass
     whichever you got.
   - **Confluence exposes no stable version number** via this MCP — only a *relative*
     `lastModified` ("yesterday at 5:35 AM"), which is useless as a freeze pin
     because its meaning changes with time. For `source.version` on a Confluence
     PRD, use a **content hash of the fetched body** instead:
     `node scripts/ready-check.mjs --hash <body.txt>`. At pickup, re-fetch and
     re-hash — any edit to the page changes the hash and trips `STALE-SOURCE`.
     (JIRA is fine: use the issue's `updated` timestamp.)
3. **Never say "X isn't connected" without having run ToolSearch for it.** That
   was the failure mode — reporting a connector absent when it was only deferred.

If nothing usable is given, ask the PM the 11 questions directly — the rubric
doubles as an interview.

### Phase 2 — Map the text to the 11 items

For each rubric item, pull the answer from the source if it's there. Build an
`answers` object:

```json
{ "title": "<feature name>",
  "items": {
    "goal":   { "detail": "..." },
    "design": { "detail": "https://figma.com/..." },   // or { "na": true } if no UI
    "oldbeh": { "na": true },                            // brand-new feature
    ... } }
```

Only `skippable` items (design, oldbeh, states, writer) may take N/A — and **N/A
is never a free pass**. A bare `{ "na": true }` no longer clears the item; it
only clears as `{ "na": true, "reason": "<why it genuinely doesn't apply>" }`
with a reason ≥ 3 chars, which rides into the hand-off for dev to accept or push
back. Prefer the **stack-appropriate answer** over a skip: for a backend/API
change, `design` is the **interface/contract spec** (OpenAPI, proto, schema) and
`states` is the **response & failure contract** (status codes, error bodies) —
answer those rather than marking them N/A. Reserve N/A for items that truly have
no analogue (e.g. a pure internal cron with no consumers → `writer` N/A "no
downstream consumers"). For everything you can't find, ask the PM in plain words,
one short batch. Do not invent answers.

**Waivers — when the PM genuinely can't answer a required item.** Any required
item may be *waived with a written reason* (e.g. the metric is owned by another
team, a decision is pending). Record it as `{ "waived": true, "reason": "..." }`:

```json
"metric": { "waived": true, "reason": "owned by growth; target decided this week" }
```

A waiver clears the item so the PRD can move, but the engine hashes the reason
into the code and surfaces it in the hand-off under a "Waivers (dev to accept or
push back)" block. An empty/absent reason does **not** clear. Offer a waiver
only when the PM truly can't answer — not as a shortcut past a question they
could answer.

### Phase 3 — Judge (make it smart — actually find the edge cases)

This is the heart of the check, and it must go beyond "is the field filled."
**Actively run the text-judgeable critics on the PRD and surface real
findings the PM can fix themselves** — do not just confirm presence.

1. **Edge cases — always run the `critic-edge-cases` critic on the PRD.**
   Enumerate the failure/boundary cases this specific feature implies and
   check each against the PRD: empty, offline, timeout, expired, concurrent
   edit, permission denied, partial failure, mid-flow cancel, and any
   domain-specific ones. List every case the PRD *doesn't* cover, one plain
   line each. A PRD whose `edge` answer misses cases the critic finds is
   **not** ready just because the field is non-empty — reopen it.
2. **Clarity (`critic-minimality`)** — is the goal a real problem and the
   metric an actual number with a window? "Improve engagement" fails; "+6% D1
   retention in 4 weeks" passes.
3. **UI states (`critic-comms-completeness`)** — for a user-facing change, is
   there copy for nothing-yet / loading / done / error?
4. **Instrumentation (`critic-instrumentation`)** — will the stated events
   actually let us measure the success metric? If not, name the gap.
5. **Scope / parity** — explicit out-of-scope present? Behavior consistent
   across the stated platforms?
6. **Design audit (when a Figma link is present).** If the `design` item is a
   Figma URL and the `figma-rest` connector is available, call its
   **`audit_design`** tool (tool name depends on install — e.g.
   `mcp__figma-rest__audit_design` or `mcp__Figma_REST_Ready_Check__audit_design`;
   discover it via the available tools). Read the file and fold the gaps in:
   - **Platforms** — if the PRD scopes mobile but the file has no mobile-width
     frames (only desktop/tablet), that's a **blocker** on `scope`. Web-only when
     the PRD implies mobile → flag it.
   - **UI states** — if no error / empty / loading screen is found by name,
     surface each as a **warning** on `states` (frame-naming is heuristic — say
     so, and ask the PM to confirm those states exist rather than hard-failing).
   - **Copy** — any placeholder/lorem/TODO text layers are a **blocker** on
     `design` ("N text layers still contain placeholder copy").
   This is the design-side of Ready Check. It runs **here, in chat** (and at
   dev-side `/contract pickup`) — the Cowork *panel* is a sandbox and can't reach
   a local connector, so the panel defers the design audit to this flow. Say
   which frames/counts you saw so the PM can trust it.

Present these as a short, plain-language blocker list the PM can act on
immediately. The point of Ready Check is that the PM sees — and fixes — the
edge cases *before* dev, not that dev finds them later.

Guardrail: don't push code-level *decisions* onto the PM (schema choices,
security design, perf strategy). Surface the product-level gap; if the answer
needs the repo, note it for Level 2. Finding a missing edge case is the PM's
job here; deciding its implementation is dev's.

### Access modes — the depth scales with what's available

Run at the deepest mode you have access to; each is a strict superset:

- **Text only (always works).** Judge purely from the PRD. Catches most
  product-level edge cases and every completeness gap. No setup.
- **+ code-context cache.** If `.manifest/.cache/code-context.json` exists,
  call `ready-check.mjs --cache-check <answers.json>
  .manifest/.cache/code-context.json` and fold the notes in — event-naming
  drift, a flow that touches more surfaces than the PRD lists, known past
  failures on this surface. No repo credentials needed.
- **+ repo read access (opt-in).** If the PM/session has read-only access to
  the product repo(s) in `.manifest/repos.yml`, ground the edge-case pass in
  real code: check that the `flows` named actually match the surfaces in the
  code, and pull historical edge cases from prior handling of the same screen.
  This is the same evidence Level 2 uses, run earlier — so PMs can catch more
  themselves. **Grant this deliberately:** read-only, per the team's policy;
  it's optional, and the check degrades cleanly to the modes above without it.

Whatever mode you're in, say which one you used, so the PM knows how deep the
edge-case check went.

### Phase 4 — Score + mint (deterministic), rendered as a live scorecard

**Chat is the primary experience — render a panel-like scorecard, not a wall of
prose.** The chat flow is the reliable one (full connector access, the real
model, no sandbox), so make it *feel* like the panel: one glance to read, one
reply to fix. Write the `answers` to a temp JSON and run the engine:

```
node scripts/ready-check.mjs --scorecard answers.json   # readable panel-like scorecard
node scripts/ready-check.mjs --check     answers.json   # verdict JSON, exit 1 if not ready
node scripts/ready-check.mjs --handoff   answers.json freeze.json   # hand-off + freeze stamp
```

**Always pass `freeze.json` when the PRD came from a fetched source.** Write the
version you fetched in Phase 1:

```json
{ "freeze": true,
  "source": { "type": "jira", "id": "ENG-1234", "version": "<JIRA updated ts>" },
  "design": { "version": "<figma file version, if any>" } }
```

(Confluence: `"type":"confluence"`, `id` = page id, `version` = `version.number`.)
This stamps `Source: … v<version>` and `PRD-Hash: H…` into the hand-off, which is
what lets `/contract pickup` detect the PRD **document** being edited after
sign-off — not just the hand-off text. Without it, that drift check is silently
skipped. Omit `freeze.json` only when the PRD was pasted as raw text (no source
version to pin).

Show the **`--scorecard`** output as-is — it's already the panel: a progress
bar, the verdict, a **numbered "To fix" list with a concrete prompt per gap**,
the grouped "Answered / N/A / Waived" items, and (when ready) the gate code. Pass
`meta.source` (e.g. `JIRA FTC-1421` / `Confluence <id>`) so the card names which
PRD it is. Then overlay the smart findings from Phase 3 (specific missing edge
cases / vague answers) as a line or two under the relevant numbered item, so the
PM sees *what* to fix, not just *that* something's missing.

**The card already invites the fix — just run the loop.** The scorecard ends with
a numbered gap list and an "↳ e.g. …" reply hint, so the PM can answer by number
or in free text. When they reply, fold their answers into the `answers` object,
re-run `--scorecard`, and show the updated card — the progress bar fills and the
score climbs. Accept free-text ("metric is +6% D1 in 4 weeks"), a numbered list
("2: …; 4: …"), or `N/A: <item> — <reason>` / `waive <item> — <reason>`. Keep
looping until it clears. Read like a panel, fix like a chat.

- **Not ready** — show the scorecard + the fix prompt above. Never mint a code.
- **Ready** — show the scorecard (now ✅), then the hand-off block from
  `--handoff`. The gate code is in it.

### Phase 5 — Hand off to dev

> **🚨 NEVER hand-write the hand-off block.** It MUST be the verbatim stdout of
> `node scripts/ready-check.mjs --handoff answers.json freeze.json`. Do not retype
> it, reformat it, summarise it, drop the `• [id] … | …` item list, or reword the
> footer. That item list *is* the content the gate code hashes — without it the
> block is **unverifiable**: `--verify` can only recover a couple of items, so the
> code can't be checked against anything and pickup reports `NOT-READY`. A
> hand-written block looks official and proves nothing, which is worse than no
> gate at all. Same rule for `Source:` — it must read `<type> <id> v<version>`;
> without the `v<version>` the freeze stamp doesn't parse and drift-detection is
> silently skipped. If you don't have the version, say so rather than emitting a
> half-stamp.
>
> Self-check before you paste: the block contains `The basics, answered:` followed
> by one `• [id]` line per satisfied item, a `PRD-Hash:` line (when the PRD was
> fetched), and a `Source: … v…` line. If any are missing, you didn't use the
> engine — re-run it.

Tell the PM exactly where the block goes: the JIRA ticket, or the dev Slack
thread. If a Slack/JIRA MCP is connected and the PM asks, post it for them in
their voice. The block carries the **design link** and the **gate code** so the
feature and its design travel together.

## Generate the PRD + publish to JIRA (the "right format")

Ready Check holds the structured answers, so it can also *author* a clean,
publish-ready PRD — the same 11-section format as `gate/examples/PRD-good-*.md`:

```
node scripts/ready-check.mjs --prd answers.json    # prints the 11-section PRD (markdown)
```

The PRD carries the gate code and lists any waivers under "Waivers (dev to
accept)". Offer it once the PM has the basics in — even Not-Ready renders (it
marks missing sections), but it's most useful at Ready.

**Publish (ask the PM which):**

- **Update the linked ticket** — if the PRD came from a JIRA link, write the PRD
  into that ticket's description via the Atlassian MCP `editJiraIssue`
  (`fields.description`, `contentFormat: "markdown"`). Safest — no new tickets.
- **Create a new ticket** — `createJiraIssue` with `projectKey`, `issueTypeName`
  (ask; default Story/Task), `summary` = the feature title, `description` = the
  PRD. Confirm the project key with the PM first; never guess it.
- **Copy only** — hand the PM the PRD markdown to paste in themselves.

Always show the PM the PRD and confirm before writing to JIRA. (The Cowork panel
exposes the same three via a **Generate PRD / Copy / Publish** row.)

## Enforcement — "no code, no grooming" (automatic)

The gate code is content-bound (a djb2 hash of the answers), so it's checkable,
not decorative. **Dev runs nothing extra.** When the dev runs `/contract
pickup <ticket>`, pickup reads the `Ready-Check:` line from the ticket/hand-off
and verifies it automatically, then acts:

- `VALID` → proceed; record `readyCheck: RC-…` in the contract frontmatter.
- `STALE` (PRD changed after it cleared) → stop and ask the PM for a fresh
  Ready Check.
- `INVALID` / missing → refuse pickup: the PRD never passed the gate.

So the only person who ever thinks about the code is the PM (they paste the
hand-off once). Dev just picks up as usual and the gate enforces itself. The
manual `ready-check.mjs --verify <handoff>` exists as a fallback for anyone who
wants to check by hand, but the normal flow needs no command.

## Freeze check (v0.22) — did the PRD or design change after sign-off?

When the PRD was fetched from JIRA/Confluence (and, if Figma REST is wired, has a
design), the hand-off carries a freeze stamp:
`Source: <type> <id> v<version>`, optionally `Design-Version: <n>`, `PRD-Hash: H…`.
At `/contract pickup`, after verifying the gate code:

1. Re-fetch the **current** source version (JIRA `updated` / Confluence
   `version.number`) and, if applicable, the Figma file version
   (`mcp__figma-rest__get_file_version`).
2. Write them to a temp JSON `{ "version": …, "designVersion": …, "prdHash": … }`
   and run:
   ```
   node scripts/ready-check.mjs --verify-freeze <handoff.txt> current.json
   ```
3. It prints `VALID` / `STALE-SOURCE` / `STALE-DESIGN` / `STALE-CONTENT`.
   - `VALID` → proceed.
   - any `STALE-*` → stop: the PRD doc or the design changed since it cleared.
     Ask the PM to re-run Ready Check and re-sign.
   - No freeze lines in the hand-off → skip (older hand-off; nothing to check).

This is what makes "the PRD/design can't quietly change after the gate" real —
you detect the drift at the moment dev picks it up.

## Scenarios to handle

- **Backend / API-only feature** — do **not** just N/A the UI items. Answer their
  backend equivalents: `design` = the interface/contract spec (OpenAPI, proto,
  schema), `states` = the response & failure contract (status codes, error
  bodies, retry/idempotency). Only mark an item N/A when it has no analogue at all,
  and then only *with a reason* (e.g. `writer` → N/A "internal job, no downstream
  consumers"). Everything else is required, read the backend way.
- **Brand-new feature** — mark `oldbeh` N/A (nothing exists yet).
- **No writer/creator impact** — mark `writer` N/A with that reason.
- **Figma-only hand-off** — the Figma URL satisfies `design`; still need the
  other 10.
- **Vague "make it better" PRD** — expect Not Ready; the value is showing the
  PM precisely what's missing.
- **Re-check after edits** — re-run; a changed answer re-mints the code, so an
  old hand-off correctly goes `STALE`.
- **No code-context cache** — the check runs on text alone; skip the cache
  notes without erroring.
- **Can't answer an item** — waive it with a reason (`{ "waived": true,
  "reason": "..." }`). It clears but shows in the hand-off's Waivers block for
  dev to accept or push back. Empty reason doesn't clear.
- **N/A a skippable item** — same rule: `{ "na": true, "reason": "..." }`. A bare
  N/A no longer clears; the reason rides into the hand-off. Prefer the
  backend-equivalent answer over N/A wherever one exists.
- **Not a PM** — a dev pre-checking their own pickup can run it too; same gate.

## Anti-patterns

- Don't eyeball the verdict or hand-write a gate code — always run the engine.
- Don't let a PM N/A a non-skippable item to slip through — and don't accept a
  bare N/A on a skippable one either; it needs a reason, or better, the
  backend-equivalent answer.
- Don't treat a backend/API PRD as out of scope — run it with the backend
  readings in "Works for EVERY PRD" above.
- Don't emit a verdict from a previous run — fetch the current source first and
  echo back what you fetched (issue key + title) before judging.
- Don't demand implementation detail from the PM (that's Level 2's job) — keep
  blockers to product decisions judgeable from text.
- Don't fetch source through non-approved means if an MCP fails — say so and ask
  the PM to paste the text.
