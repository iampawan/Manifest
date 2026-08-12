# Changelog

All notable changes to Manifest. Versions follow semver. Install a
specific version by tag rather than tracking `main`, so your team gets
reproducible behavior:

```
/plugin install manifest@manifest   # pulls the tagged release in the marketplace
```

Every findings file records the `pluginVersion` that produced it (see
`CRITIC-PROTOCOL.md`), so you can always tell which version verified a
given contract.

## [0.26.1] — Fix: the pinned Ready Check panel now reliably self-updates

The Cowork sidebar panel is a saved *snapshot* — Cowork never re-reads the plugin
file, so the panel only refreshes when the skill calls `update_artifact`. Two bugs
kept that from happening: the reconciliation ran only on `/ready-check panel`, and
it tried to read the build number "from the artifact's path" (impossible), so a
newer build was never detected.

- The `ready-check` skill now **reconciles the panel on every Cowork run** (create
  if missing; update when the bundled `ready-check-build` is newer), reading the
  build number from the file's `<meta>` tag — not the path. A pre-build-tag
  artifact is treated as stale and refreshed.
- Documented the real model: "auto" means "on your next `/ready-check`," and the
  panel is only ever as new as the installed plugin — so a stale panel usually
  means the plugin itself needs updating first.
- Panel version label + build bumped (build 70) to match.

## [0.42.0] — One-command setup for any platform

Makes 0.41's portability actually reachable — generating `AGENTS.md` was possible,
now it's offered during setup and documented for every tool.

- **`docs/INSTALL.md`** — step-by-step install for Claude Code, Cowork, Cursor,
  Codex, Gemini CLI / Antigravity, Copilot, Windsurf / Aider / Zed, CI, and "no AI
  tool at all". Every command in it was executed and verified, including the
  documented exit codes (`0` valid · `1` stale · `2` unverifiable).
- **`setup-init` now offers to install `AGENTS.md`** into the repo (Step 6c). It
  respects zero-footprint mode (never writes to a team repo the user opted out of)
  and **appends rather than overwrites** an existing `AGENTS.md` — someone else's
  agent config is their document.
- `AGENTS.md` and `docs/INSTALL.md` added to the docs hub; README now points
  non-Claude users to the install guide up front.

## [0.41.0] — Works outside Claude: Cursor, Codex, Gemini CLI, Copilot, CI

Not everyone on the team has Claude. Manifest's value was already portable — the
gates are plain Node — but nothing told other tools how to use them.

- **`AGENTS.md`**, the Linux-Foundation-stewarded standard read natively by Codex,
  Cursor, Copilot, Gemini CLI, Aider, Windsurf and Zed. One file at repo root and
  Manifest works in all of them.
- **Generated, not hand-maintained** — `scripts/build-agents-md.mjs` builds it from
  the engine's `RUBRIC` and `plugin.json`, so it can't drift. `--check` fails if it's
  stale; an eval test enforces the same. Deliberately compact (~157 lines): the core
  PM/dev workflows only, since every tool loads it into context on every run.
- **Cross-tool trust.** A gate code minted by a PM in Gemini verifies identically for
  a dev in Cursor and for CI — it's a hash computed by Node, not a model judgement.
  Verified end-to-end using only the documented commands: score → 11/11 → write-back
  → freeze → hand-off → verify `VALID` → tamper → `STALE`.
- **Ready Check needs nothing installed.** Confirmed `ready-check.mjs` has *zero*
  dependencies — a single file plus Node 18+ is the whole PM-side gate. (Only the
  contract/repo tooling needs `js-yaml`.) AGENTS.md says so, lowering the barrier for
  non-dev teammates.
- Teammates with no AI tool at all can still clear the gate via
  `gate/prd-readiness-gate.html` in a plain browser — same rubric, same code format.

## [0.40.0] — The PRD stays complete, and anyone can verify a hand-off

0.30.x made hand-offs tamper-evident. This release closes the two gaps that were
left: answers a PM gave in chat never made it back into the PRD, and verifying a
hand-off was awkward enough that people wouldn't bother.

### The PRD no longer goes stale behind the hand-off

- **Answers given in chat are written back into the PRD.** When a PM unblocks a gap
  by replying ("here are the analytics events"), that answer used to live only in
  the conversation and the hand-off — the Confluence/JIRA doc stayed incomplete, so
  a dev reading the PRD never saw it. `--addendum <answers.json> [by]` renders just
  the newly-supplied items (flagged `addedInReview`), stamped with the gate code, to
  **append** to the source page/ticket. Never overwrites — the PRD is the PM's
  document — and the skill asks first.
- **Write-back can't cause a false alarm.** Appending changes the document's bytes,
  which would otherwise trip `STALE-SOURCE`. Two defences: the skill writes back
  **before** minting the hand-off and re-fetches the version, and `--hash` now
  strips any Ready Check addendum (`stripAddendum`) so appending — even twice —
  leaves the content hash byte-identical, while a genuine edit to the PRD body still
  trips `STALE-SOURCE`. (The gate code was never at risk: it hashes the answers, not
  the document.)

### Verifying a hand-off is now trivial

- **Verify from the link — nothing to paste.** `--verify` accepts a whole ticket or
  page dump and locates the hand-off block inside it (`extractHandoff`), so a dev
  can point at the ticket instead of hand-copying and risking a clipped block.
- **A gate code alone now explains itself.** Pasting only `RC-XXX-######` used to
  return a confusing `NOT-READY`; it now reports `UNVERIFIABLE` with the reason —
  the code is a *hash of the answers*, so without the `• [id] …` list there is
  nothing to check it against.
- **Three routes, none needing the panel:** paste in chat (`/ready-check verify`),
  `/contract pickup` (automatic), or `ready-check.mjs --verify` in a terminal.

37 engine tests (was 34), including regressions pinning "append ≠ drift, real edit =
drift" and block-extraction from a noisy ticket.

## [0.30.2] — Verifiable hand-offs: catch hand-written blocks, Confluence tiny links, real freeze pins

A real hand-off turned up in the wild with no `PRD-Hash`, a `Source:` line missing
its version, and no answered-items list. `--verify` reported a confusing
`NOT-READY`; the truth was that the block had been **hand-written by the agent
instead of emitted by `--handoff`**, so there was nothing to verify it against.

- **`--verify` now names the real problem.** If a block claims PASSED but has no
  `• [id] …` item list, it reports `UNVERIFIABLE — not produced by --handoff`
  (exit 2) and calls out the missing freeze stamp / PRD-Hash, instead of a
  misleading NOT-READY.
- **Every hand-off now says how to check it** — a "Check by hand:
  `ready-check.mjs --verify <block>.txt`" line, in the engine and both gates.
- **Half-stamps fail loudly.** `--handoff` warns when `freeze` is set but
  `source.version` is missing — that combination doesn't parse, so drift-detection
  would be silently skipped.
- **Skill hard rule:** never hand-write, retype, reformat, or summarise the
  hand-off — it must be the verbatim engine output, with a self-check list before
  pasting.
- **Confluence tiny links now work.** The `…/wiki/x/<id>` form PMs copy from the
  Share button has no numeric page id, and the fetch required `/pages/<digits>` —
  so those links were rejected outright. Both fetch paths now accept either shape
  (`getConfluencePage` takes a tiny-link id as `pageId` directly).
- **Confluence had no usable version to freeze against.** This MCP returns only a
  *relative* `lastModified` ("yesterday at 5:35 AM"), whose meaning drifts with
  time — pinning it would give false STALEs. New `--hash <file>` computes a content
  hash of the fetched body to use as `source.version`; re-fetch + re-hash at pickup
  catches any edit. (JIRA still uses the issue's `updated` timestamp.)
- Verified end-to-end on a live PRD (`…/wiki/x/Z4IElg`): 11/11 → gate code →
  `VALID`; weakened metric → `STALE`; widened scope → `STALE`; page edited →
  `STALE-SOURCE`; Figma changed → `STALE-DESIGN`; nothing changed → `VALID`.

## [0.30.1] — Tamper-evidence hardened: N/A reasons are hashed, chat hand-offs are frozen

Two integrity gaps found while auditing the hand-off after the chat-first change.

- **An N/A justification could be rewritten without invalidating the gate code.**
  `na` hashed as the bare token `na`, ignoring its reason — so "N/A — internal
  service" could be edited in the hand-off and still verify as `valid`. N/A now
  hashes **with its reason** (like waivers), in the engine and both JS ports;
  engine↔panel parity re-verified. ⚠ This changes the code for any PRD containing
  an N/A item — previously-minted codes with N/A go `STALE` and need a re-check.
- **Chat hand-offs carried no freeze stamp.** `--handoff` had no way to receive the
  fetched source version, so `Source:`/`PRD-Hash:` were omitted and pickup silently
  skipped the "PRD document edited after sign-off" check. `--handoff <answers.json>
  [freeze.json]` now accepts it, and the skill passes it whenever the PRD came from
  a fetched source.
- Verified end-to-end: untouched → VALID; answer edited → STALE; N/A reason edited
  → STALE; code swapped → STALE; source doc bumped v12→v13 → STALE-SOURCE.

## [0.30.0] — A genuinely panel-like scorecard in chat (progress bar, gaps-first, fix-by-reply)

Builds on the chat-first direction with a much more UI/UX-friendly scorecard.

- **Redesigned scorecard** (`ready-check.mjs --scorecard`): a visual progress bar
  (`▓▓▓░░░░░░░░ 3/11`), a **gaps-first "To fix" list** — numbered, each with a
  concrete prompt (e.g. *"Success metric — a number + window (\"+6% in 4 weeks\")"*)
  so the PM knows exactly what to write — then grouped **Answered / N/A / Waived**
  sections with each item's value, and the gate code on a pass. Optional items
  show as "＋ Also noted".
- **Fix by number or free text.** The card ends with a reply hint; the PM answers
  "2: …; 4: …" or in plain language, the skill folds it in and re-renders, and the
  bar fills. Read like a panel, fix like a chat.
- Rubric gained `short` labels + per-item `ask` prompts to power the card.
- Panel version synced to 0.30.0 (build 78); 33 engine tests green.

## [0.27.0] — Chat is the front door: a live, panel-like scorecard you fix by replying

The most reliable Ready Check experience is `/ready-check <link>` in chat — it has
full connector access, the real model, and none of the sandbox limits that made
the sidebar panel flaky. So the chat flow now *feels* like the panel.

- **Scorecard renderer** (`ready-check.mjs --scorecard`) — a clean, deterministic,
  panel-like status: the verdict, every item's state (✓ answered / ◦ N/A / ≈
  waived / ✗ needed) with its answer, and exactly what's left to add. Same format
  for every PM.
- **Edit-by-reply loop** — the skill shows the scorecard, lists only the gaps with
  concrete prompts, and the PM fixes them by just replying ("metric is +6% in 4
  weeks", or "N/A: writer — internal service"). The skill folds it in, re-renders,
  and the score climbs — read like a panel, fix like a chat.
- **Panel repositioned as optional.** The sidebar artifact stays for PMs who want
  an always-open surface, but chat is now the recommended path; when the panel
  misbehaves, the answer is "run `/ready-check <link>` in chat."
- Short rubric labels added for the scorecard; 33 engine tests (was 32).

## [0.26.7] — Robust per-user Atlassian: the connector id is baked into the panel

0.26.6 removed the hardcoded id and had the panel read its connector from the
artifact's runtime metadata — but that can be stripped from the rendered page,
resolving the id to empty and breaking link-fetch (even for the person it used to
work for).

- **The connector id is now baked into each user's panel.** The skill discovers
  the user's Atlassian prefix and replaces a `__RC_ATLASSIAN_MCP__` token in the
  panel HTML before creating/updating the artifact — no dependency on runtime
  DOM/metadata. Resolution order: manual `localStorage` override → baked id →
  best-effort metadata discovery. If none resolve, the panel cleanly prompts to
  paste the text or use `/ready-check` in chat (never a wrong hardcoded id).
- The skill re-bakes + re-grants the correct per-user tools on every panel
  reconcile, so a panel created with the wrong/empty connector gets corrected.
- Panel build → 76.

## [0.26.6] — Fix: panel link-fetch worked for only one user (hardcoded connector id)

Some users saw "couldn't fetch that page/link" even with Atlassian connected, while
others (the person whose id was baked in) were fine.

- **Cause:** the panel's Atlassian connector id was a **hardcoded constant** — one
  specific user's connector-id hash. That id is unique per user, so the panel called
  a tool id that doesn't exist in anyone else's session and the fetch failed.
- **Fix:** the panel now **self-discovers** its Atlassian prefix from the tools the
  artifact was actually granted (Cowork lists them in `#cowork-artifact-meta`,
  populated per user when the skill creates the panel), falling back to a manual
  `setAtlassianConnector()` / localStorage override. No hardcoded id.
- The `ready-check` skill now **re-passes the freshly-discovered `mcp_tools`** on
  every panel reconcile, so a panel first created with the wrong/empty tool list (or
  before Atlassian was connected) gets the correct per-user connector re-granted.
- Panel build → 75.

## [0.26.5] — Simpler + stable: drafts count, and the analysis is cached per PRD

Replaces 0.26.4's "confirm every field before it counts" model, which was
deterministic but confusing (a fully-analyzed PRD showed **0/11** until the PM
clicked through every field).

- **Drafts count again** — answers the review pulls from your PRD count toward the
  score immediately (each still marked ✨ to skim/edit), so you see a real score
  right after a check, not 0/11.
- **Determinism comes from a per-PRD cache instead.** The analysis is cached by the
  PRD's content hash, so re-checking the *same* PRD returns the *same* result every
  time — the score can't drift 10 → 8 → 6. Edit the PRD text to force a re-analysis.
- **Instant, bridge-proof re-checks** — a cached PRD re-checks with no LLM call, so
  re-checking works even when the in-panel AI bridge is flaky. Only *complete*
  analyses are cached (a timed-out partial run isn't), so a flaky first pass can be
  retried rather than frozen.
- Quality is preserved by the edge-case findings + editable ✨ fields, not by a
  gate that shows 0/11. Panel build → 74.

## [0.26.4] — Deterministic score: AI suggestions no longer count until confirmed

Fixes a critical bug where re-checking the *same* PRD returned different scores
(10/11, then 8/11, then 6/11). Cause: the LLM review auto-filled the 11 fields and
those drafts **counted toward the score immediately** — but an LLM extracts a
different set of fields each run (and long-PRD chunks sometimes time out and fill
fewer), so the score drifted even though the PRD was unchanged.

- **The score is now a pure function of confirmed answers.** AI-drafted answers are
  **suggestions** (marked ✨) that do **not** count toward the score or the gate
  code until the PM confirms them (one click "Confirm all", or edit any field).
  Re-running the review only re-proposes text for still-blank fields — it never
  moves the number on its own. This restores the gate's stated rule ("only
  confirmed answers count; presence of text is not readiness") and makes the score
  reproducible for a given set of confirmed answers.
- Suggestion copy updated to say plainly that drafts don't count until confirmed;
  the confirm buttons read "Confirm — count it" / "Confirm all — count these".
- Panel build → 73.

## [0.26.3] — Panel: self-documenting identity banner after a check

- After a PRD is checked, the panel shows a banner at the top with **which PRD
  this was** — the feature title, a live verdict (READY + gate code, or "Not
  ready · N/M"), the **source** (JIRA key + version / Confluence page + version /
  Figma / pasted text), the **time checked**, and a short **content hash** of the
  PRD. A screenshot of the result is now self-documenting — you can tell exactly
  what output belongs to what PRD. The banner clears when the PRD box is cleared.
- Panel build → 72.

## [0.26.2] — Fix: panel no longer carries a previous PRD's data across reloads

- **Stale-data fix (the recurring one).** The panel used to persist the PRD +
  answers to `localStorage` and restore them on every reload. After a reload the
  in-memory source fingerprint reset to null, so the new-PRD guard couldn't fire
  and the *previous* PRD's answers leaked into the next one. The panel now opens on
  a **clean slate** — no cross-reload persistence — and clearing the PRD box wipes
  all prior answers immediately. (Answers still live in memory for the whole
  working session; only a full reload starts fresh.)
- The version chip tooltip now tells a panel-only PM how to pull the latest build
  ("refreshes the next time you run /ready-check in chat").
- Panel build bumped to 71; panel version label → 0.26.2.

## [0.26.0] — Ready Check works for every PRD; N/A is no longer a free pass

Fixes PM feedback that Ready Check felt frontend-only, let PMs skate past items
via N/A, and (in the Cowork panel) leaked a previous run's results.

- **Stack-neutral rubric.** All 11 items now read for frontend, backend, API,
  data, and infra PRDs — `design` = design **or interface/contract spec**,
  `states` = user **or caller** (response/status codes), `flows` =
  screens/**endpoints**/jobs, `scope` = platforms **or services**, `l10n` =
  copy **or response format**, `writer` = writers/creators **or downstream
  consumers**, `events` = analytics **or telemetry**. Synced across the engine
  (`scripts/ready-check.mjs`), both gates (`gate/ready-check-cowork.html`,
  `gate/prd-readiness-gate.html`), `reference/READY-CHECK-RUBRIC.md`, and the
  skill. Backend PRDs clear by answering the backend way — not by skipping UI.
- **N/A now requires a reason.** A bare `{na:true}` no longer clears a skippable
  item; it must carry a reason (≥3 chars) that rides into the hand-off for dev to
  accept or push back. Closes the "just tick N/A" escape. The gate-code hash is
  unchanged (an N/A still hashes as `na`), so all three encodings stay in parity —
  verified engine↔panel. Skill now steers PMs to the backend-equivalent answer
  before any skip.
- **Fresh fetch, every run (skill).** Ready Check must fetch the source given
  *now*, echo back the key/title before judging, discard a previous PRD when a new
  one is given, and never emit a verdict from an earlier run — fixing "it showed
  results for the previous PRD" and "it answered immediately from a prior run."
- **Panel: no stale results.** The Cowork panel resets answers + review when the
  PRD source changes, and invalidates the prior verdict as the field is edited.
- **Panel: link fetching.** Broader Atlassian URL recognition (sharable/Rovo links
  and links with a little surrounding text), louder fetch-failure messages, and the
  connector prefix is no longer a shipped constant — it's discovered by the skill
  and overridable via `setAtlassianConnector()` / `localStorage`.

## [0.25.0] — JIRA: sharable links in, tickets out, kept live

The tracker now mirrors the whole lifecycle. New canonical reference
`reference/JIRA-SYNC.md` defines all of it; the skills point to it.

- **Accepts any JIRA sharable link.** Not just `browse/KEY` — board, deep, and
  "Share → Copy link" URLs (`…?selectedIssue=KEY`, `…/jira/software/.../issues/KEY`)
  all resolve. The key is pulled by scanning the URL for the first
  `[A-Z][A-Z0-9]+-\d+`. Wired into `contract-new`, `contract-pickup`, and
  `ready-check` (which also `ToolSearch`-discovers the deferred Atlassian tool
  before ever saying "not connected"). The Cowork panel already parsed these.
- **Auto-generates tickets at planning (opt-in), before implementation.** The dev
  chooses *when*: **at `/contract pickup`** (early — update the source ticket, or
  create one for visibility), **at `/contract promote`** (canonical — epic + AC
  sub-tasks), **at `/contract decompose`** (epic + a child issue per child), or
  **anytime on demand** ("create the JIRA ticket"). It's **idempotent** — the key
  is stored in frontmatter, so a later step *updates* the same ticket instead of
  creating a second one. Tickets carry full detail — problem/goal,
  ACs as a checklist, design link, success metric, the gate code, `duedate` =
  SLA, labels, **owner assigned**, and **`dependsOn` → "is blocked by" links** so
  the DAG shows in JIRA. Confirms the project key first; prefers *updating* the
  source ticket over creating a duplicate. Keys are stored in frontmatter.
- **Keeps tickets live during implementation.** `implement` transitions the
  ticket → In Progress on start, posts batched progress comments, flags blockers
  (comment + `blocked` label + transition, @-mentioning the PM and noting the
  paused SLA for PM-answer blockers), and moves it → In Review on PR. Verify /
  launch steps comment their verdicts; a leaf child goes → Done on land.
  Transitions use the ticket's real workflow (never hard-coded IDs).
- **Degrades cleanly.** No Atlassian connector, or the dev declines → the work
  proceeds and the skip is reported; the tracker never blocks the actual work.

### Fixes

- **Analytics events no longer missed on long PRDs.** On a long Confluence PRD,
  the smart review chunks the text and reviews chunks in parallel; if the chunk
  holding the events section timed out or the model didn't map its table onto the
  `events` field, the events were silently dropped. Now a **deterministic
  backstop** extracts event names from an explicit "Analytics Events / Events to
  Capture / Instrumentation" section (high-precision — needs a section header +
  real event ids), the review prompt calls that section out, and the panel
  **warns when a chunk fails** instead of showing a field blank with no reason.
  The offline page's auto-fill uses the same extractor, so both surfaces fill
  `events` with the real event names rather than a bare heading line.

## [0.24.0] — Offline page refreshed for 2026; Cowork connector-discovery fix

- **Fix: "Atlassian isn't connected" false negative in Cowork.** Connector tools
  are *deferred* in Cowork (not in the tool list until loaded via `ToolSearch`),
  so `/ready-check` on a Confluence/JIRA link wrongly reported the connector
  absent and asked the PM to paste. Ready Check's Phase 1 now **searches for the
  fetch tool first** (`getConfluencePage` / `getJiraIssue` / …) and only asks for
  a paste if ToolSearch genuinely returns nothing — it never claims "not
  connected" without checking.
- **Panel UX + UI redesign.** Cleaner, more professional Cowork panel: a
  redesigned numbered **flow map** ("you do steps 1 & 3"), labeled example
  buttons and tighter step-1 hierarchy so the primary action dominates, a
  progress-filled stepper, **bigger buttons**, and a **flat** treatment — the
  gradient logo and button glow are gone. Both surfaces share one consistent,
  flat, indigo look; the panel's engine and logic are unchanged.
- **Offline web page, refreshed for 2026.** `gate/prd-readiness-gate.html` (the
  no-sign-in browser version) gets the modern UI: an indigo palette with softer
  shadows/radius, the same top-of-page **flow map**, the **Playbook** (header
  modal + inline "strong vs. weak" on every question), "Your feature, in plain
  terms" renamed to **"Your answers"**, and a note pointing to the Cowork panel /
  `/ready-check` for the smart review and design audit. The deterministic engine
  (djb2 / `normAnswers` / `gateCode` / hand-off) stays **byte-identical** to the
  panel and `ready-check.mjs`, so a code minted offline still verifies dev-side
  (guarded by `verify_all.mjs`).

## [0.23.0] — Ready Check panel: real gate, Playbook, Verify, draft-from-idea

- **Gate-focused panel + clear end-to-end flow.** The panel is now purely the
  gate + hand-off (removed Generate-PRD / publish). Step 3 shows *what happens
  next* and a top-of-panel flow map makes the whole path explicit: **PM Ready
  Check → hand-off → Dev `/contract pickup` (deep findings) → PM fixes →
  grooming → Dev `/contract promote` → build**. `/ready-check` (Level 1, text)
  and `/contract pickup` (Level 2, code) are complementary, not either/or.
- **Auto-fill from the PRD.** Since the PM wrote the PRD, AI-drafted answers fill
  the fields and count immediately, each marked ✨ to verify — no manual "keep".
- **`FLOW.md` — one "who runs what, when" map.** A single authoritative reference
  for the whole lifecycle (PM → Dev → Lead → Auto): a step-by-step table (who,
  which command, the trigger, the output), a 30-second "which command do I run?"
  guide, the Level-1 vs Level-2 distinction, and how accountability is baked in.
  Linked from the README and `/manifest`.
- **Multi-person feature rollup.** `/contract decompose` now assigns each child
  an **`owner` + `repo`** (from `repos.yml`), so "2 FE / 1 BE" maps onto real
  children/people. New engine `epicRollup` (+ `--rollup` CLI, 4 tests) computes
  per-child state (landed/blocked/ready/in-flight), who's `blockedBy` whom, the
  **critical path**, and the feature is "landed" only when **every** child lands.
  `/status <epic>` renders it — the one-glance view grouped by person, leading
  with the finish line and any cross-child block.
- **PM accountability ledger.** New engine helpers `ballLedger` / `effectiveSla`
  (+ `--ledger` CLI, 6 tests): the SLA clock **pauses while "blocked on PM"**, so a
  dev is never shown overdue for time a thin PRD left the ball with the PM. Pickup
  records the ball log + bounce count; `/status` leads with who holds the ball and
  the *effective* (PM-paused) SLA. The gate code + `promptedBy` are the PM's
  attributed sign-off; waivers are risks the PM explicitly accepted.

- **Deterministic gate.** The hand-off/gate code unlocks when every basic is
  *confirmed* — nothing else. The smart review (suggestions + gap findings) is a
  helper, not a gate: its findings are **advice**, and a slow/flaky review bridge
  can never lock the PM out. Presence of text no longer counts as readiness — only
  confirmed answers do — so the same answers always give the same result.
- **No more keyword-stuffing.** Pasting a PRD no longer dumps raw heading
  fragments into the answer boxes. Only the smart review fills a field the PRD
  genuinely covers, blank-only, ≤16 words — so every filled answer is real.
- **Playbook.** A "good vs weak" reference for all 13 fields — a header modal, and
  an inline "see example" on every field.
- **Verify a pass (dev).** Paste a hand-off → *authentic / tampered / not-ready /
  invalid*. Give it the PRD as a **JIRA/Confluence link** and it fetches the live
  doc to check **source-version drift** *and* **content hash** — the same freeze
  check as `/contract pickup`, in the panel. The engine verifier is ported in and
  parity-checked against `ready-check.mjs`.
- **Hand-off carries a content hash** (`PRD-Hash:`) alongside the source-version
  and design-version pins, so edits are caught even within the same version.
- **Draft-from-idea on-ramp.** Describe an idea → a starter PRD skeleton drafts
  into the box (metrics/design left as explicit TODOs) to refine, then gate.
- **Readiness score** ring (% of basics covered) and **strong/weak** sample
  framing; staged loading messages; connection **status dot** (green live / red
  not connected) replacing the old "live" text.
- **Figma design-freeze is live** — the `figma-rest` `get_file_version` tool is
  wired into the panel, pinning `Design-Version:` at sign-off.
- **Design audit.** New `figma-rest` `audit_design` tool reads the linked Figma
  file and flags design-readiness gaps — missing mobile/web frames (vs the PRD
  scope), missing error/empty/loading screens, and placeholder/unfinished copy.
  Placeholder copy + mobile-missing-when-scoped are blockers; missing states are
  warnings. Runs in the **`/ready-check` chat flow** and, on the dev side, in
  **`/contract pickup`** (Phase 2c), which pairs the audit with a **design
  freeze/drift check** (`get_file_version` vs the pinned `Design-Version:` →
  STALE-DESIGN) and routes designer/PM-only gaps into the "PM must answer"
  bucket. The sandboxed panel can't reach a local connector, so it defers to
  these flows. 15 audit unit tests.
- **Deterministic readiness score.** The LLM's field-fills are now *suggestions*
  ("Use this" to keep) that never count toward the score or gate code until you
  confirm them. Same PRD + same confirmed answers ⇒ the same number every time,
  so PMs can trust it. The Figma link is pulled from the PRD deterministically.
  Answers persist across panel reloads. Determinism is covered by new harness
  checks (suggestions can't change the code or clear the gate).
- **Desktop-extension packaging.** `figma-rest` ships as an installable `.mcpb`
  (manifest with a keychain-encrypted `FIGMA_TOKEN`); the audit response drops the
  bulky per-screen list. The panel auto-detects the connector's tool namespace.
- Verification: 55-check parity + verify-port harness and 23 engine tests green.

## [0.22.0] — Freeze the PRD & design after sign-off (+ Confluence, PRD generation, JIRA publish)

- **Freeze the PRD.** The hand-off pins the source doc's version
  (`Source: jira|confluence <id> v<version>`) + a content hash. `/contract
  pickup` runs `ready-check.mjs --verify-freeze` → `VALID / STALE-SOURCE /
  STALE-DESIGN / STALE-CONTENT`, so a PRD edited after clearing is caught.
- **Freeze the design.** A bundled, **dependency-free** `figma-rest` connector
  (`tools/figma-rest-mcp/`, read-only Figma token) pins the Figma file version
  (`Design-Version:`); pickup flags a design changed after sign-off. Ships with
  the plugin via `mcpServers` — no npm install/publish.
- **Confluence + JIRA fetch** in the panel — paste a page/issue link and it loads.
- **Generate PRD + publish** — a clean 11-section PRD from the answers; copy, or
  publish to JIRA (append to the linked ticket / create a new one).
- **UX refresh** — numbered steps, a staged PRD panel, indigo accent, clickable
  findings that jump to the field, rotating progress messages, hardened re-run
  and clipboard copy.
- **Setup docs** — `gate/SETUP.md` (PM quick-start + admin), `gate/FIGMA-TOKEN.md`
  (2-minute token guide), `gate/V0.22-FREEZE-SPEC.md`.
- Engine: `prdHash`, `verifyFreeze`, `renderPrd`, `--prd`, `--verify-freeze`.
  153 unit tests + cross-surface parity, all green.

## [0.21.0] — Ready Check: a PM-side readiness gate before dev grooming

"Airport security for PRDs." A first, cheap gate the PM clears *before*
engineering estimates — so dev stops chasing PMs for basics and stops
eating the delay when a half-baked PRD moves mid-sprint.

- **New `/ready-check <source>` (alias `/ready`).** Give any source — a JIRA
  / Notion / Doc / Slack / Figma URL, pasted text, an image, or a plain
  description — and Ready Check scores it against the Definition of Ready
  (11 required items), surfaces the blockers a PM can fix themselves in plain
  language, and (when ready) mints a gate code + a clean hand-off for dev.
  Runs identically in Claude Code and Cowork.
- **Deterministic engine `scripts/ready-check.mjs`.** Presence + specificity
  scoring, a tamper-evident gate code (djb2 over the normalized answers), and
  hand-off render/parse. Mirrors `validate.mjs`: deterministic layer, with the
  skill's judgement layer on top.
- **"No code, no grooming" enforcement.** The gate code is content-bound, so
  `ready-check.mjs --verify <handoff>` returns `VALID | STALE | INVALID`.
  `contract-promote` records `readyCheck:` and refuses a contract without a
  valid one.
- **Offline web page (`gate/prd-readiness-gate.html`)** for PMs with no Claude
  open — same rubric, same gate-code algorithm, so a web-minted code verifies
  dev-side. Cross-port parity is pinned by `eval/ready-check.test.mjs`.
- **Code-aware, no repo access.** When `.manifest/.cache/code-context.json`
  exists, Ready Check adds non-blocking notes (event-naming drift, extra
  surfaces a flow touches) from the published digest — no source credentials.
- **Live smart check with no backend (Cowork artifact).**
  `gate/ready-check-cowork.html` is a Cowork artifact: the deterministic gate
  runs in-page and the edge-case review is done by Claude live via
  `window.cowork.askClaude` — Cowork is the backend, no server or API key. Same
  gate-code algorithm as the engine, so codes still verify dev-side.
- **Edge-case checking moves to the PM.** The skill's judgement pass runs the
  edge-cases critic (plus clarity / comms / instrumentation) to surface real
  missing cases, not just field presence. Depth scales with access:
  text-only → code-context cache → opt-in read-only repo access.
- **Waivers.** A PM can proceed without an item by waiving it *with a written
  reason*; the waiver is hashed into the code and surfaced in the hand-off for
  the dev to accept or push back. Empty waivers don't clear.
- **Auto-verify on pickup.** `/contract pickup` verifies the Ready Check code
  itself — the dev runs nothing extra; the PM is the only one who handles it.
- **Practical extras.** Dark mode, a Do's & Don'ts panel, a flat professional
  UI, and two annotated example PRDs (`gate/examples/PRD-good-*`, `PRD-bad-*`).
- **Cowork panel maturity.** One-click "Check my PRD" (Claude extracts fields +
  finds edge-case gaps in one pass), rotating progress messages, clickable
  findings that jump to the field, waivers with justification, an empty-input
  guard, robust clipboard copy, and a self-refresh build stamp. The connector
  for optional JIRA-link fetching is a single `ATLASSIAN_MCP` config line;
  set it per workspace, or leave empty to disable.
- **Generate the PRD + publish to JIRA.** `renderPrd` / `ready-check.mjs --prd`
  composes a clean 11-section PRD (with gate code + waivers) from the answers.
  The panel adds Generate PRD / Copy / Publish — publish updates a linked ticket
  (appends the PRD) or creates a new one from a project key. Same generation is
  available in Claude Code via the skill.
- Rubric: `reference/READY-CHECK-RUBRIC.md`. Level 2 (deep, code-grounded) is
  still `/contract pickup`, dev-side, after the gate is green.

## [0.19.0] — self-tuning models: smart routing, advisor escalation, cost observability, and a learning loop

The system now chooses the right model for each task itself, escalates the
hard calls to a stronger model, measures its own token cost, guards its own
determinism, and learns from each incident — without anyone having to pick a
model. The consistent rule: everything non-deterministic (model-choice
variance, the advisor, token cost) is kept strictly out of the verdict path,
so the "verdict is computed, not judged" property is unchanged.

### Added

- **Smart per-critic model routing (`computeModelPlan`).** The validator now
  emits a `modelPlan` that assigns each critic a model deterministically from
  the contract's `sizing` — light critics on a fast model, heavy critics
  (regression/security/scalability) on a strong model **only** when the
  contract is large/risky (8+ behaviors, 3+ platforms, or an auth/billing/
  migration flag). A trivial fix verifies cheap; an auth-flow change across
  three platforms automatically pulls the strong model onto the heavy critics.
  Nobody picks a model. Override per-critic with `conventions.criticModels` in
  `repos.yml`. Routing is pure code over an already-deterministic input, so it's
  reproducible — not an LLM classifier.

- **`/advisor` escalation.** The Implementer (the token-heaviest step) can pair
  a mid-tier main model with a strong advisor it consults at decision points —
  before committing to a plan, before declaring done, when a fix loop is stuck.
  Opt-in via the `MANIFEST_ADVISOR_MODEL` / `MANIFEST_IMPLEMENTER_MODEL` repo
  variables in `pr-verify.yml` (Anthropic-API only; unset = unchanged). Critics
  may also consult the advisor on borderline **`warning`/`info`** calls only,
  opt-in via `conventions.criticAdvisor` — never blockers (enforced; see below).

- **Cost / token observability (`/manifest cost`).** A deterministic rollup
  (`validate.mjs --cost`) prices recorded token `usage` from
  `reference/model-pricing.json` and reports spend by complexity, model tier,
  and critic, across both verify critics (`findings.json`) and the Implementer
  (`<ID>.implement.json`). This closes the loop on routing — you can measure
  whether tiering and the advisor actually saved money. Usage is observability
  only: never a gate or provenance input.

- **Finding-stability / variance tracker (`recall.mjs --stability`).** Scores N
  repeated runs of a fixture — per-gap hit rate, run-to-run stdev of required
  recall, and a flaky-gap list — failing if a required gap drops below
  `stabilityThreshold`. Guards the judgment layer against drift introduced by
  per-tier model routing. Opt-in `eval.yml` sweep gated on
  `MANIFEST_STABILITY_RUNS` (off by default — it multiplies LLM cost by N).

- **Postmortem → bug-pattern learning loop.** When `/postmortem` finds a
  diff-detectable bug class, it proposes a candidate in
  `reference/bug-patterns.candidates.md` (staging — unenforced). A maintainer
  promotes accepted patterns into `BUG-PATTERNS.md`, where `code-review`
  enforces them on every future diff, so the same class of bug can't ship
  twice. Safety: human-accept gate + `warning`-until-proven default. A
  deterministic catalog validator (`--check-patterns`, `--next-pattern-id`)
  guards structure (well-formed entries, unique + monotonic ids) and runs in CI.

- **Context-compaction resilience for long Implementer runs.** Multi-hour runs
  overflow the context window and the runtime auto-summarizes lossily. The
  Implementer now externalizes its working state to
  `<ID>.implement-state.json` (AC status, files touched, decisions),
  checkpoints after every behavior, and re-reads spec/plan/state files as
  ground truth instead of trusting summarized memory.
  `validate.mjs --implement-status <ID>` recovers what's done and what's left in
  ~100 tokens after a summarization and makes runs resumable. Schema + status
  unit-tested.

- **Compact critic rule digest (`CRITIC-RULES.md`) — cuts input tokens ×N.**
  The ~9 critics fanned out per verify each re-read the full `CRITIC-PROTOCOL.md`
  (≈290 lines) every run. They now load a compact digest (~70 lines) with only
  what's needed to emit valid output — schema, severity enum, ID prefixes,
  determinism caps, anti-patterns, framing, the advisor constraint. The full
  protocol stays the source of truth for orchestrator/maintainer concerns
  (provenance, cost, model pinning); a test enforces the digest can't drift from
  the validator's enum/prefixes/caps. The orchestrator also passes critics the
  spec content, not the machine provenance/sidecars.

### Changed

- **Findings provenance schema → v2 (`protocolVersion` 1 → 2).** `verifiedWith`
  now records a per-tier `models` map + `complexity` instead of a single
  `model` scalar, because critics run on different models. Documented in
  `CRITIC-PROTOCOL.md`. **Compatibility:** this bump invalidates v1 verify
  caches by design — a findings file written under the old schema can't say
  which model produced each finding, so the next verify re-runs. No action
  needed; it self-corrects on first re-verify.

- **The promotability gate stays deterministic even with the advisor.**
  `validateFindings` now **rejects** any advisor-influenced finding
  (`metadata.advisorConsulted: true`) that is a `blocker`. Advisor escalation is
  structurally confined to the advisory layer, so the gate (zero open blockers)
  is never influenced by a non-deterministic call. Enforced in code and gated by
  `--check-findings` in CI, not just documented.

### Notes

- Token `usage` blocks populate only when the runtime exposes per-subagent token
  counts; when unavailable the block is omitted and everything else is
  unaffected.
- Design rationale for the whole release is in
  `docs/proposals/model-tiering-and-advisor.md` and
  `docs/proposals/next-features-roadmap.md`.

## [0.18.2] — code quality hardening + dashboard-style PRs + plain-English comments

Driven by Cursor BugBot findings on the first Manifest-shipped PRs.
Three categories of bug were slipping past `code-review` and getting
caught in PR review instead. This patch closes them at three layers
(spec, implementer, critic) and reshapes the PR body so reviewers
read a single dashboard, not scattered comments.

### Changed

- **`critic-edge-cases`: new state-machine consistency check.** Catches
  contracts that contradict themselves about the same state transition
  (e.g. "only tap/Esc/blur ends the session" alongside "errors stop the
  session"). For every named transition the contract mentions, the
  critic now enumerates every statement about it and flags
  disagreements as blockers when the spec is genuinely undecidable.
  The "rapid double-action" finding also escalates from warning to
  blocker when no concrete guard (AC / outOfScope) is named — race
  conditions on rapid clicks were the second Cursor-flagged pattern.

- **`code-review`: three new high-recurrence patterns added to the
  checklist.** Each catches a real Cursor-flagged class:
  - Empty catch followed by state mutation / analytics / side effects
    that assume the try block succeeded → blocker.
  - `useState` flag used as a race guard (handler reads stale state
    across rapid double-clicks) → warning with `useRef` / `disabled`
    fix suggestion.
  - No-op error handling (caught and not re-thrown, logged, or
    surfaced) → warning, blocker when hiding user-visible failure.

- **`code-review`: findings now require plain-English fields.** Output
  schema gains `plainTitle`, `whatHappens`, `whyItMatters`, `theFix`,
  `codeSnippet` alongside the legacy `message`/`suggestion`. Findings
  render in the four-part style from `reference/PR-COMMENT-STYLE.md`
  — a busy reviewer (or a PM, or a junior dev) can act on a finding
  in 10 seconds. No more "useState flag used as concurrency guard"
  as the lead.

- **`implement`: pre-write reconnaissance is mandatory.** Before
  creating any file or symbol, the implementer must (a) grep for
  existing matches in the target repo, (b) read 1–3 sibling files in
  the target folder to learn conventions, (c) consult
  `.manifest/.cache/code-context.json` for existing events / i18n /
  flags / shared modules / similar past contracts. The recon findings
  go into the PR body so the reviewer can see what was checked. This
  is the single change that prevents duplicate-utility and
  convention-mismatch bugs.

- **`implement`: mandatory pre-push self-review pass.** The
  implementer now runs the `code-review` critic on its own diff
  *before* the first push. Max 2 fix iterations to clear blockers
  in-place; if anything remains, push with a self-review comment
  naming the open issues. Catches the empty-catch / race / no-op-error
  class before CI does. The implementer's own self-review summary
  becomes a section in the PR body so the reviewer can see what was
  caught and fixed.

- **`implement`: PR body becomes a dashboard.** New required template
  with sections: "What this PR does" (plain English), Contract +
  SLA + acceptance criteria count, **Mermaid diagram of the
  change**, Files changed (one-liner per file), AC coverage map,
  "What I read before writing code" (recon report), Self-review
  summary, How to test locally, Risk callouts. A reviewer with 30
  seconds knows what / why / what to look at; a reviewer with 5
  minutes can merge confidently without opening other tabs.

- **`reference/BUG-PATTERNS.md` — new living catalog of bug shapes.**
  Every external reviewer finding (Cursor BugBot, human reviewer,
  postmortem) that wasn't already caught is permanently added as a
  `BP-NNN` entry. The implementer reads the catalog before writing
  (pre-empts every pattern); the `code-review` critic checks the
  catalog on every diff. The catalog is one-way ratchet — patterns
  never get caught twice. Seeded with three entries from recent
  Cursor findings (empty-catch + side-effects, useState-as-race-
  guard, no-op error handling) plus two adjacent (analytics-before-
  success, state-after-unmount) and one common React (missing
  effect deps).

- **`reference/RECOMMENDED-LINT-RULES.md` — copy-paste lint configs
  per stack.** Most of BUG-PATTERNS is mechanically catchable by the
  right linter rules at the right severity. Document gives the
  exact ESLint / Dart analyzer / golangci-lint / ruff blocks plus
  TypeScript / mypy strictness flags. Repos that adopt all four
  sections typically see Cursor findings drop by ~70% within a few
  PRs — the catalog patterns get rejected at editor save time.

- **Self-review must re-scan the FULL catalog on every iteration.**
  This is the structural fix to the "Cursor finds new things each
  round" problem. Fixing one finding often introduces (or reveals)
  another. The implementer's pre-push loop now runs `code-review`
  with the entire BUG-PATTERNS catalog on each iteration — not just
  the previous round's class. Convergence: by iteration 2, every
  pattern has been scanned; round 3 catches only genuinely-new
  issues, not the next-shape-in-line.

- **Self-review is tunable, default on.** New `repos.yml` keys:
  - `selfReview: on | off | auto` — `auto` runs only when the diff
    has ≥ `selfReviewMinChangedLines` changed lines (default 0;
    set higher to skip on small diffs).
  - `selfReviewMaxIterations: 2` — cap on fix rounds before pushing
    with a self-review comment that names the unresolved issues.
  Cost note (in the example config + this release's docs): self-
  review adds ~30s – 3min per implementation run and ~1.5–2× the
  agent compute (`code-review` runs once pre-push and once in CI).
  Net wall-clock is a win when external reviewers would otherwise
  catch ≥1 thing per PR; a small overhead on PRs that would have
  been clean anyway. Tunable so teams can dial up the threshold or
  turn off if the overhead doesn't pay off for their diff sizes.

- **`reference/PR-COMMENT-STYLE.md` — new shared style guide.** Every
  PR comment (critic finding, verify-pr coverage, implementer
  self-review, fix-pr explanation, bug-triage update) follows the
  same four-part structure: plain-English title with emoji · what
  happens · why it matters · the fix with code snippet · file:line.
  Length budgets enforce concision (blocker ≤ 150 words; warning
  ≤ 80; info ≤ 1 line).

- **`workflows/pr-verify.yml`: optional stack-native static checks.**
  Added a commented-out block with the canonical lint / typecheck /
  test commands per stack (Node / Flutter / Go). Repos whose own CI
  already runs these can leave it off; repos relying on Manifest can
  uncomment the block for their stack and get strict pre-AI checks
  on every PR push.

### Why these are 0.18.2, not 0.18.1
0.18.1 fixed the *pickup* skill (the Spec entry). 0.18.2 fixes the
*implementer + reviewer* skills (the Build phase). Different code
paths, different bugs, different commit. The motivating Cursor
findings on UWS-502 voice-dictation PRs all landed in the implementer's
output and should never have reached the reviewer's queue in their
original form.

### Migration
None. All changes are additive (new critic patterns, new schema
fields, new SKILL.md sections, a new reference doc). Existing
contracts and PRs keep working. Repos relying on the pre-0.18.2
PR-body template will see a richer body on the next implementer
run — no config flip needed.

## [0.18.1] — pickup skill hardening from first real-run feedback

First end-to-end test of `/contract pickup` surfaced three real
gaps. All closed in this patch — no API changes, no new dependencies,
no migration. Existing 0.18.0 contracts and config keep working.

### Changed
- **Phase 2 now runs the full critic set inline, unambiguously.** The
  0.18.0 skill prose left room for the agent to draft the contract,
  run only `critic-code-context`, and then suggest `/contract verify`
  as a follow-up — which happened in the first real run. The skill is
  now explicit: pickup IS the verify. In Phase 2 the agent runs the
  validator + all the standard judgment critics selected per content
  (edge-cases / regression / security / instrumentation /
  comms-completeness / platform-parity / scalability / perf-budget)
  + `critic-code-context` in one parallel batch, and writes
  `.findings.{md,json}` exactly as `contract-verify` would. New
  anti-patterns explicitly forbid suggesting `/contract verify` as a
  next step and producing a card with only Bucket A.

- **Phase 1.0 preflight — no more silent degradation without
  `repos.yml`.** 0.18.0 ran pickup happily without
  `.manifest/repos.yml` and reassured the dev "fine here — automation
  is inert." That hid a real loss: cross-repo regression scan, cached
  auto-fill, PM-channel routing, and the answer-watcher all need
  `repos.yml`. The skill now gates Phase 1 on the file. If missing,
  the agent stops, lists the four affected features explicitly, and
  offers to run `/manifest setup` (~30 seconds) or proceed with
  `pickup.degradedMode: true` recorded in the contract frontmatter so
  the rest of the pipeline knows. Same gate when a critical MCP isn't
  connected for the pasted source. Anti-pattern added: don't say
  "fine here" — surface the loss, let the dev decide.

- **Card output reframed for someone reading their first pickup.**
  0.18.0 led with the contract ID (`SC-001`), bucket letters, and
  file paths as table columns — fine for someone who already knew the
  codebase, opaque otherwise. New rules: feature title in plain
  English leads (contract ID drops to a small metadata row); bucket
  headlines in plain English ("Agent filled in 4 from your code"
  instead of "Bucket A — auto-filled from code"); every technical
  reference gets a plain-English line above it; file paths drop to
  `↳ refs:` footnotes; jargon gets a parenthesized gloss the first
  time it appears; question IDs (`Q-N`) stay in frontmatter and never
  surface in the human card.

### Why these are 0.18.1, not 0.18.0
0.18.0 shipped the design + scaffolding. 0.18.1 closes the gaps the
first real run exposed. The skill prose was the difference between
"works on paper" and "behaves the way the docs claim" — that's a
behavioral change worth a version bump even though no `.json` schema
or workflow file changed.

## [0.18.0] — dev-centric pickup flow (opt-in)

A new mental model for the most common real-world case: the PM
writes a PRD elsewhere (JIRA / Google Doc / Slack / Notion / paste /
screenshot) and walks away, and the dev has to make it build-ready
on their own — using code, history, and dependency context the PM
doesn't have. Manifest does the code archaeology *for* the dev and
surfaces only the decisions that need a human.

The PM stays in their normal tool. They never have to touch
Manifest — questions go out as one batched JIRA comment / Slack DM
in the dev's voice; answers materialize as AC edits with provenance
comments.

This release ships the design + scaffolding for the flow. It's
opt-in per repo via `pickup.enabled: true` in `repos.yml`; without
the flag, `/contract pickup` falls back to `/contract new` with a
notice. Existing flows (`/contract new`, verify, promote, implement,
canary, launch) are unchanged.

### Added
- **`/contract pickup <source>`** — new subcommand for the
  dev-centric flow. Source can be any URL (JIRA, Google Doc,
  Linear, Notion, Confluence, Slack message link, GitHub issue,
  Figma), pasted text, or a dropped image. Fetches via the right
  MCP, follows linked docs one level deep, pulls related history
  (past contracts, postmortems, recent Sentry, active concurrent
  work). See [skills/contract-pickup/SKILL.md](skills/contract-pickup/SKILL.md).
- **Three-bucket gap sorter.** Every gap in the PRD lands in
  exactly one of: **A. agent fills from code/history** (one-tap
  accept), **B. dev decides** (engineering judgment), **C. only PM
  can answer** (drafted as a PM-facing question). Dev burns through
  A in seconds, walks B with judgment, sends batched C questions
  to the PM.
- **`critic-code-context`** — new dev-side critic that produces the
  Bucket A auto-fill proposals (perfBudget from stack defaults,
  event names from the existing catalog, copy from i18n keys, AC
  patterns from similar landed contracts) and Bucket B dev-decides
  items (rolled-back history, dependency budgets, shared modules,
  locale/device branches the codebase already handles). See
  [skills/critic-code-context/SKILL.md](skills/critic-code-context/SKILL.md).
- **PM-channel question posting.** Drafted questions go to the PM
  via the channel the source came from (JIRA comment, Slack
  reply-in-thread, Notion comment, Google Doc suggestion) in the
  dev's voice. Optional `— <dev> (via Manifest)` footer for audit
  (`pickup.identifyAgent` in `repos.yml`).
- **Answer watcher.** Polls the PM channel for replies; on
  detection, parses the answer, applies it as an AC edit with a
  provenance comment (`<!-- From: Q-N · <PM> · <date> -->`), moves
  the question to the sidecar `<ID>.qa.md` log, and re-verifies
  incrementally. Implementation on non-blocking behaviors can run
  in parallel.
- **`ROADMAP.md`** at the repo root — captures the broader vision
  (development / customer support / operations agents) and the
  impact-ordered immediate priority list this release is one piece
  of.

### Configuration
New `pickup` block in `repos.yml`:

```yaml
pickup:
  enabled: true            # opt in
  identifyAgent: true      # "(via Manifest)" footer on PM-facing posts
  defaultChannel: jira     # or: slack | notion | gdoc
  blockingByDefault: false # questions are non-blocking unless dev flags
  cacheTTL: 24h            # codebase analysis cache lifetime
```

### Cache builder + answer watcher (closed mid-cycle)
What started as deferred made it into this release:
- **`scripts/build-code-context.mjs`** — idempotent, atomically-writing
  cache builder. Scans target repos for event catalog, i18n keys, flags,
  shared modules; indexes past contracts by surface area; flags
  rolled-back / partial history. Output goes to
  `.manifest/.cache/code-context.json`. Sub-second lookups after the
  first build. Runnable locally (`node scripts/build-code-context.mjs`)
  or on cron via `workflows/code-context-build.yml`.
- **`scripts/answer-watcher.mjs`** — polls PM channels for replies to
  open pickup-flow questions. Stateless detector that emits a JSON
  report; the contract-pickup skill consumes the report and applies AC
  edits + provenance comments + qa.md updates. Runnable locally or on
  the 15-minute cron in `workflows/answer-watch.yml`.

### Known gaps (still deferred)
- **Answer-watcher channel adapters are stubs** — they log what they
  would call but return `mcp-unavailable` by default. Production
  detection needs either (a) running from inside Claude Code / Cowork
  with the relevant MCP, or (b) a thin REST proxy on the MCP host. v0.18
  ships the detection harness + report schema; production wiring lands
  in a follow-up.
- **Cross-repo scanning in the cache builder** uses the `path:` field
  from `repos.yml`. GitHub-only entries (no local `path:`) are skipped
  for now — pulling source via the GitHub MCP is a follow-up.
- **Slack message-link parsing** covers the common URL shape; exotic
  workspace URLs may need a follow-up patch.

### Mental model — when to use which entry point
- **PM authors in Manifest** (rare today, but the ideal) →
  `/contract new`. Same as before. Conversational; PM owns the
  contract.
- **PM authored elsewhere; dev picks it up** (the common case) →
  `/contract pickup <source>`. Dev owns the contract; PM stays in
  their tool.

## [0.17.0] — see your diagrams + findings tell you HOW to fix

### Added
- **`/contract diagram <ID>`** (`scripts/render-diagram.mjs`) — renders a
  contract's Mermaid blocks into a standalone `<ID>.diagram.html` you
  open in any browser, so you can SEE the diagram even when the `.md`
  isn't on GitHub and you're deciding from your IDE. Dependency-free
  (Mermaid via CDN at view time). Docs also point to IDE markdown
  preview, which renders Mermaid natively/with an extension. 5 new tests.
- **Diagrams are now optional** — add one only when a branching/state
  flow makes the contract clearer; skipped by default for simple/bug-fix
  changes (no more forced flowchart).

### Changed
- **Findings now tell you HOW, not just what.** The deterministic
  validator's `suggestion` strings are concrete paste-in templates —
  e.g. a missing AC suggests `- AC<n> (B2): Given …, when …, then …`; a
  missing commsStates gives the four-state skeleton with guidance.
  CRITIC-PROTOCOL now requires every critic `suggestion` to show the
  shape of the fix and where to make it, not just name the gap.

## [0.16.0] — migrate existing contracts to the new layout

### Added
- **`scripts/migrate-contract.mjs`** + `/contract migrate <ID>` — a
  deterministic reformat that brings an existing contract to the v0.15
  grouped frontmatter (YOU-AUTHOR / MANIFEST-MANAGES), adds `changeType`
  if absent, and leaves the body untouched. **Preserves every value** —
  managed state (timestamps, status, `landed`, `bugFollowups`) and any
  unknown fields — and is idempotent. Refuses frozen `<ID>.r<N>.md`
  snapshots. 6 new tests (88 total).
- Loads frontmatter with `JSON_SCHEMA` so ISO timestamps stay verbatim
  strings — the default schema parses them to `Date` and re-emits
  `...000Z`, which would silently rewrite every timestamp. (Caught by a
  preservation test.)

## [0.15.0] — author-friendly contracts (what to edit, where, what to remove)

The findings got readable in 0.14.0; this does the same for the contract
the author actually edits.

### Changed
- **Frontmatter split into two labelled groups** in CONTRACT-FORMAT and
  in what `contract-new` scaffolds: `# ── YOU AUTHOR (edit these) ──`
  (just `id`, `title`, `changeType`, `platforms`, `createdBy`) and
  `# ── MANIFEST MANAGES — don't edit ──` (status, complexity,
  timestamps, fix counters, guard/rollout fields, bugFollowups). No more
  guessing which fields are yours.
- **New "Editing a contract" section** — maps each findings location
  (`B2`, `AC3`, `frontmatter`, a section name) to exactly where in the
  file, says which sections you own, and clarifies *what to remove*:
  `Out of scope` is where you defer work, drop a behavior by removing the
  **whole** block (a half-specified behavior is a blocker), and the
  optional `rollbackTriggers`/`rolloutPlan` blocks are deletable.
- Optional frontmatter blocks are now clearly marked optional/deletable
  rather than shown as if required.

## [0.14.0] — readable findings (human-first `.md`)

Findings felt hard to read and people weren't sure how to edit them. Two
fixes — one a clarification, one a format change:

### Changed
- **You never hand-edit `findings.md`.** It's the read-only *output* of
  verify; you edit the **contract** and re-verify (or `/contract fix`),
  which regenerates it. Stated up front in the file's own banner and the
  docs.
- **`findings.md` is now human-first; machine metadata moved to the
  `.json`.** The `.md` frontmatter is tiny (readiness, promotable,
  counts) — the wall of `sha256:` hashes, `regressionScan`,
  `criticsRun`, and normalization notes that used to greet the reader
  now live in `findings.json` only (where the `--changed` planner and
  tooling read them). The body lists blockers in full with plain-English
  fixes, **summarizes** the advisory warnings/info (one line each, full
  text in the `.json`) instead of dumping dozens of paragraphs, demotes
  critic IDs to small trailing tags, and ends with "What to do next."
- **Critics now write in plain English.** CRITIC-PROTOCOL requires
  `message`/`suggestion` to read like a reviewer's note — jargon spelled
  out, location in human terms, ID not leading the sentence.

## [0.13.0] — bounded contract verify→fix loop

The slow part of authoring was the manual round-trip: verify → "Claude,
fix it" → re-verify → a *new* blocker appears → repeat, each pass paying
full verify cost. New `/contract fix <ID>` collapses it.

### Added
- **`/contract fix <ID>`** (contract-verify fix mode) — runs verify,
  applies the fixes for **all open blockers in one batch**, re-verifies
  **incrementally**, and loops until 0 blockers or a 3-pass cap
  (`maxFixIterations`), then reports a promotable contract. Targets
  blockers only (warnings stay advisory); on the cap it stops and hands
  back the remaining blockers instead of churning. One command instead
  of N hand-driven passes.
- Key rule that kills the "re-verify finds new blockers" whack-a-mole:
  when a fix adds a behavior/AC, it's added **complete** (all required
  fields at once) so the next pass doesn't block on the fragment just
  added — the #1 source of cascading blockers.
- New `verifyFixIterations` frontmatter counter (distinct from the PR
  loop's `fixIterations`; both capped by `maxFixIterations`).

## [0.12.0] — solo / zero-footprint mode

### Added
- **Solo / zero-footprint mode** (GUIDE §1f + a setup-init choice) — use
  Manifest as an individual contributor without adding a single file,
  workflow, or Action to a team's repo. Contracts + `repos.yml` live in
  a separate repo you own (or a local-only folder) and point at the team
  repo by its `github:` slug via your existing read access; you run the
  skills (`/contract`, `/code-review`, `/implement`) locally and open a
  normal PR. The team sees nothing Manifest-related. `setup-init` now
  asks team-vs-solo and, in solo mode, writes config elsewhere and skips
  workflow installation entirely. No format changes — adopt the full CI
  loop later if the team wants it.

## [0.11.0] — native iOS / Android deploy verification

`verify-deployment` could verify web, Flutter, and backend, but native
Swift/Kotlin apps fell through (the Flutter sub-mode is keyed on
`languages: [dart]`), so a native contract had no runnable sub-mode.

### Added
- **Sub-mode D: native mobile** in `verify-deployment` — iOS (Swift,
  `xcodebuild test`) and Android (Kotlin, `gradlew test` /
  `connectedAndroidTest`), with three checkpoints: pre-release (CI
  sim/emulator), internal-track (Firebase Test Lab real-device matrix),
  and prod (telemetry: Firebase Analytics + Crashlytics crash-free % +
  Performance). Recognizes that native ships via **store staged
  rollout** (no feature flag): a `rollback` verdict means *halt the
  staged rollout*, not flip a flag. Implementer already supported native
  via STACK-PROFILES; this closes the verification half.
- **Native mobile CI guidance** — GUIDE §3.4b plus headers in
  `pr-verify.yml` / `verify-deploy.yml`: iOS jobs need
  `runs-on: macos-latest` + Xcode setup; Android needs the SDK +
  `setup-java`; per-repo signing / Firebase Test Lab secrets. Covers the
  two-separate-features / two-repos / two-teams case (single-platform
  contracts in each repo, no shared specs repo or parity ceremony).

## [0.10.0] — proportional scope (stop over-engineering small bugs)

Driven by a real run where a one-line bug fix grew into a 5-revision
epic (a new analytics event, a 7-day shadow baseline, a flag with
mount-time caching, 21 ACs). The critics were calibrated for net-new
features and only ever ADD; nothing argued for cutting. Three fixes:

### Added
- **`changeType: feature | bug-fix` frontmatter** (default `feature`).
  A `bug-fix` contract verifies LEAN: `contract-verify` runs only
  `minimality` + scoped `edge-cases` + `regression` + `security`
  (if relevant); **turns the instrumentation critic OFF** and drops the
  success-metric / shadow-baseline requirement (a bug's metric is the
  regression test). `contract-new` sets `bug-fix` for bug intake and
  scaffolds without a success-metrics section or new events. The
  validator reports `changeType` in its output.
- **`critic-minimality` (new, always-runs)** — the counterweight that
  pushes back on disproportionate scope: feature-grade telemetry /
  shadow phases / flags / exhaustive speculative edge cases on a small
  change. Emits `MIN-` findings at `warning` (advisory). Added to the
  protocol's canonical names + ID prefixes.

### Changed
- **CRITIC-PROTOCOL framing: "handle OR explicitly defer."** Every
  critic's `suggestion` must let the author *descope* (move to Out of
  scope) rather than only "add handling for X" — so scope can't grow one
  finding at a time, and readiness no longer requires building
  everything a critic noticed. Critics calibrate to `changeType` /
  `complexity` and bias toward deferral on bug fixes.

### Why
A bug fix should verify against ~2-3 scoped critics, not a feature's
full suite. The UWS-257 contract under the old rules would now: skip
instrumentation entirely, drop the shadow baseline + success metric, and
get a `minimality` warning on the flag/analytics scope — i.e. ~80% smaller.

## [0.9.0] — blockers are the only hard gate (no more endless verify)

Verify could feel endless because reaching `verified` required **0
warnings**, and warnings are the LLM-variable findings that reshuffle
run-to-run. Now a dev clears a finite, stable set and ships.

### Changed
- **`promotable` = zero open blockers** is the real gate
  (`computeReadiness` now returns it). Warnings and info are advisory —
  they refine the `readiness` signal but **never block promotion**.
  `contract-promote` now gates on `promotable`, not `status: verified`;
  it surfaces open warnings and proceeds (you can fix or acknowledge
  them, but you don't have to).
- **New `acknowledged` finding status** — a human reviews a warning and
  accepts it; it leaves the open set and never re-litigates. Added to
  the finding-status enum (`open | resolved | dismissed | acknowledged`)
  in both `validateFindings` and `validateReviewFindings`.
- `contract-verify` and `/status` now lead with `promotable` and list
  blockers (must-fix) separately from warnings (advisory); verify
  carries `acknowledged`/`dismissed` statuses forward across re-verifies.

### Why it converges
Blockers (deterministic facts + serious judgment issues) are stable and
finite → drive to zero. Warnings → fix or acknowledge → don't resurface.
Unchanged content → caching + incremental re-verify reuse prior findings.
So the loop terminates instead of chasing run-to-run variance. 4 new
tests (82 total).

## [0.8.0] — faster verify & re-verify

The deterministic validator was already <1s; the wall-clock is the LLM
critics. This release makes verify do the *smallest correct* amount of
work, especially on the edit→re-verify loop.

### Added
- **Incremental re-verify.** `validate.mjs` now hashes each behavior
  (+ its ACs) and a global context bucket (`fragmentHashes`), plus an
  `apiSurfaceHash`. The new `--changed` mode emits a re-run plan: which
  localized critics to re-run over which changed behaviors, whether the
  cross-cutting critics need re-running, and whether regression should
  `rescan` / `reason-only` / `reuse`. Verify follows the plan and reuses
  prior findings for unchanged fragments — so fixing one finding
  re-runs one critic over one behavior, not the whole suite. 9 new tests
  (78 total).
- **`--fast` verify** — `/contract verify <ID> --fast` runs only
  edge-cases + security and skips the regression scan, for a quick
  draft-loop verdict. Stamped `verifyMode: fast`; **not promotable** —
  contract-promote refuses a fast-only verify.
- **Regression scan caching.** The slowest critic now reuses its repo
  scan when the API surface + scanned repo head SHAs are unchanged
  (recorded in the findings' `regressionScan` block); it only re-fetches
  on a real surface change. Prefers the cheap `declared` scan depth
  while iterating, full depth on the final verify.
- **Model tiering** — heavy critics (edge-cases/security/regression/
  scalability) use a strong model, light ones a fast model; override via
  `conventions.criticModels`.

### Notes
- All wins are "run fewer critics over less input and reuse prior
  results" — individual LLM-critic latency is unchanged. Correctness is
  preserved: any structural change still re-runs the cross-cutting
  critics; only localized critics (comms/perf/platform/instrumentation)
  are scoped to changed behaviors.

## [0.7.0] — contextual perfBudget / commsStates gating

Process proportional to the behavior, not blanket boilerplate.

### Changed
- **`commsStates` is now required only for user-facing behaviors.**
  Server-only behaviors (platforms all `server`/`backend`) are exempt —
  no more demanding four UI states for a backend job.
- **`perfBudget` gating is configurable** via `conventions.perfBudget`
  in `repos.yml` (or `perfBudgetPolicy` per contract): `required`
  (blocker), `warn` (warning — **the new default**, so a missing budget
  no longer blocks the pipeline), or `off`. When checked, **one relevant
  numeric field is enough** (ttiMs for UI, p95LatencyMs for a network
  call) — a behavior with no network call needn't invent a p95. A `TBD`/
  non-numeric value is flagged at the policy severity.
- Renamed/rebranded the whole plugin **Shipline → Manifest** (name,
  slugs, `.manifest/` convention, `/manifest` command, repo reference).

### Notes
- The two critic skills (`perf-budget`, `comms-completeness`) now defer
  field-presence to the validator and focus on judgment (are budgets
  realistic; is error copy actionable). 6 new validator tests (69 total).
- Rationale: the blanket "all three fields on every behavior" rule
  created friction for backend behaviors and teams without perf
  telemetry, contradicting "works with whatever infrastructure you
  have." The value is kept where it's cheap (user-facing UI states) and
  made opt-in where it isn't.

## [0.6.0] — bug→fix loop closure (+ trigger fix)

### Fixed
- **Monitoring trigger never fired.** `launch-monitor.yml` matched
  contracts on `prodRolloutAt:`, but the contract format stores the
  rollout timestamp as `prodRollout100At:` — so the daily launch-report
  and bug-triage sweep silently found zero contracts. Corrected the
  field name (and the day-index computation that used it).

### Added
- **bug-triage now closes its loop.** After filing/deduping a cluster it
  routes the bug back into the pipeline: trivial/high-confidence (or any
  S0/S1) can auto-enter the `/fix` express lane; bigger ones draft a
  `/contract` stub. Guardrails: propose-by-default, auto-start only for
  high-confidence-trivial or S0/S1, ≤2 auto-starts per run, never
  auto-merge (the fix still goes through verify-pr + code-review +
  human approval). The route is seeded from the triage evidence
  (symptom, repro, suspect file + git-blame owner, contract context).
- New `bugFollowups` contract frontmatter — links the routed ticket ↔
  fix PR / new contract ↔ originating contract; an open follow-up
  tempers the `landed` verdict. The cluster is marked `routed` in the
  bug-log so the next nightly run doesn't re-route it.

### Notes
- No new credentials required: routing reuses the scopes the Implementer
  already declares (`github:contents:write` / `pull_requests:write`) and
  the tracker MCP bug-triage already uses. Without write access it
  degrades to *proposing* the route in Slack / a PR comment.

## [0.5.0] — recall harness, canary orchestrator, rollback ending

Fills the gaps a self-audit surfaced: the missing half of the
reliability story, the described-but-unbuilt canary orchestrator, and
the one place the end-to-end loop had no ending.

### Added
- **Critic recall harness** — `eval/contracts/judgment-gaps.md` is a
  structurally-complete contract (zero deterministic findings) with
  planted *judgment* defects; `eval/golden/judgment-gaps.expected.json`
  declares which critic must catch each. `scripts/recall.mjs` is a
  deterministic scorer (recall + schema check) with 7 unit tests; the
  `critic-recall` job in `eval.yml` runs the verify skill against the
  fixture and scores it (skips cleanly without LLM creds). This is the
  drift defense RELIABILITY.md #2 asked for — a recall drop fails CI.
  `contract-verify` now also emits a machine-readable `.findings.json`.
- **Canary orchestrator (recommend-and-approve)** — `rolloutPlan`
  (stages + bake `holdHours`) in `repos.yml` / contract frontmatter;
  `rollback-guard` now recommends the next ramp step on a healthy check;
  `/canary <ID>` shows the current stage + next step. The system never
  advances the flag — a human does. Fixed the GUIDE wording that
  implied an automated orchestrator existed.
- **Post-rollback / postmortem loop** — `rollback-postmortem` skill +
  `/postmortem <ID>`: records `landed: rolled-back` + `rolledBackAt`,
  writes a blameless postmortem from the contract timeline + guard
  reports + Sentry, and reopens the work as a follow-up (never closes it
  as done). The rollback ending the loop was missing.

### Changed
- **Workflow robustness.** `launch-monitor.yml` and `rollback-guard.yml`
  share a `concurrency: manifest-state-writer` group and rebase before
  push, so concurrent crons no longer race on the specs repo.
  Launch-monitor gained **missed-cron catch-up**: it produces any
  reached-but-unwritten milestone report instead of requiring an exact
  day match (a delayed/skipped scheduled run no longer drops a report).
- **code-review** gained a dependency / supply-chain check (avoidable
  new deps, unpinned ranges, typosquats, license flags, lockfile drift)
  when the diff touches a manifest/lockfile.
- New frontmatter: `currentRolloutPercent`, `rolledBackAt`, optional
  per-contract `rolloutPlan`.

## [0.4.0] — code review, the fix loop, and a rollout guard

Closes the two gaps between "the spec is good" and "the running feature
is safe": code-level review of the diff, and a watcher on the rollout.

### Added
- **`code-review` skill (PR stage)** — reviews the diff for security,
  correctness, performance, and maintainability defects, distinct from
  `verify-pr`'s AC/contract conformance. Emits `CR-` findings on the
  shared `blocker/warning/info` enum, schema-checked by
  `validate.mjs --check-review`; open blockers gate the merge. Runs in
  `pr-verify.yml` alongside verify-pr; `/code-review <PR>` to run it
  manually. GUIDE ②.
- **Review→fix loop** — `@claude /fix-pr <ID>` runs the Implementer in
  fix-mode: it reads the open `code-review` / `verify-pr` findings,
  fixes them narrowly, re-pushes, and CI re-verifies. Bounded by
  `maxFixIterations` (default 3) then escalates to a human — no churn.
- **`rollback-guard` skill + `rollback-guard.yml`** — during the rollout
  window, samples Sentry errors, crash-free rate, and release adoption
  against the contract's budgets + optional `rollbackTriggers`, and
  RECOMMENDS `proceed | hold | recommend-rollback`. It never executes a
  rollback — a `recommend-rollback` posts a top-level Slack alert to the
  owner with the breached signal and the exact action. `/rollback-check
  <ID>` to run on demand. GUIDE ③.
- New contract frontmatter: `fixIterations` / `maxFixIterations` (loop
  cap), `guardVerdict` / `guardCheckedAt`, and a `rollbackTriggers`
  block. CONTRACT-FORMAT updated.
- `validate.mjs` gains `validateReviewFindings` + `validateGuardVerdict`
  with `--check-review` / `--check-guard` CLI modes (exit codes gate CI:
  2 = open review blockers, 3 = recommend-rollback). 11 new tests (56
  total).

### Notes
- The guard deliberately recommends rather than acts — pausing a canary,
  flipping a flag, or reverting is a production change a human owns.
  This matches `verify-deployment`'s long-standing "don't auto-rollback"
  stance.

## [0.3.3] — lifecycle & retention

### Added
- **Archival/retention** — landed contracts (day-28) auto-archive to
  `.manifest/archive/<year>/<ID>/`; keeps contract + final report,
  prunes process exhaust (git history retains it). `retention: keep-all`
  to archive everything. Manual `/contract archive <ID>`. Keeps the
  active contracts folder lean as the team ships more features. GUIDE 1e.

## [0.3.2] — central state (specs-repo model)

### Added
- **Dedicated specs-repo model** for central state — one repo on one
  `main` branch is a consistent source of truth (no per-branch
  divergence); also the home for cross-repo contracts. GUIDE 1d.
- **Advisory locks** — `owner` / `lockedBy` / `lockedAt`; verify and
  implement warn if someone else holds a recent lock (advisory, git
  is the arbiter).

### Notes
- A real-time central *service* (locking + query API) remains a
  deferred v2+; the plugin is built so it would wrap the same contract
  format, not replace it.

## [0.3.1] — content-hash caching

### Added
- **Content-hash caching** — `/contract verify` skips the LLM critics
  when the contract content + plugin version are unchanged since the
  last verify (reuses prior findings). No-op re-runs (CI, habit,
  iterating on other files) now cost zero tokens. `--force` overrides.
  `validate.mjs --cache-check` powers it; 5 tests.

## [0.3.0] — right-sized process + leaner critics

Process proportional to risk, end to end.

### Added
- **Express lane** (`/fix` + `quick-fix` skill) for trivial bugs and
  tiny changes — skips the contract ceremony (no critics/SLA/launch
  report), triages first and escalates to `/contract` if the change is
  bigger than trivial. Plus a deterministic stack detector
  (`scripts/detect.mjs`, 16 tests) and the `setup-init` wizard that
  auto-generates `repos.yml` (no external code-index MCP needed).
- **Smart Large support** — `/contract decompose` turns a Large
  contract into an epic with dependency-ordered Small/Medium children;
  migrations/auth flagged `human-led`. Large is made tractable, not
  refused.
- Stack-agnostic Implementer + STACK-PROFILES toolchain reference
  (web/mobile/backend; no assumed npm/Playwright).
- **SLA countdown in every update** — `validate.mjs --sla` prints time-
  left / overdue; implement, verify-pr, verify-deploy, and promote all
  lead their updates with it (4 tests).
- **All times shown in IST + UTC** (e.g. `13:30 IST / 08:00 UTC`).
- **`/status [<ID>]`** — phase + SLA + readiness + next action for one
  contract, or a dashboard of everything in flight (overdue first).
  Deterministic via `validate.mjs --status` + `derivePhase` (6 tests).
- **Slack per-contract threading** — one top-level message per contract
  (the promote anchor); every later update threads under it via
  `slackThreadTs`. One channel, no spam. Urgent items (overdue,
  rollback, auto-pause) also post a brief top-level alert.

### Changed
- **Critic set optimized.** `critic-sizing` removed (the validator
  computes sizing deterministically — superseded record in
  `docs/superseded-critic-sizing.md`). `platform-parity`,
  `scalability`, and `perf-budget` judgment now run **conditionally**
  (only when relevant), cutting tokens and noise. Always-run core:
  edge-cases, regression, security.
- Repo docs reorganized: root has 3 files; specs in `reference/`,
  planning docs in `docs/`.

### Fixed
- Validator skips behavior checks on `type: epic` contracts.

## [0.2.0] — reliability hardening

The "make it real for teams" release. Addresses the production-grade
gaps in the v0.1 prototype.

### Added
- **Deterministic validator** (`scripts/validate.mjs`) — real code for
  all mechanical checks (field presence, AC coverage, sizing, readiness,
  output-schema validation). Reproducible, free, unit-tested.
- **Shared critic protocol** (`CRITIC-PROTOCOL.md`) — single source for
  the closed severity enum (blocker/warning/info), output schema, ID
  prefixes, and anti-patterns. All 9 critics reference it.
- **Eval harness** (`eval/`) — golden contracts + unit tests for the
  validator. 13 tests, all passing. This is the regression gate that
  makes future changes safe.
- **Scope declarations** — write-path skills declare `requiredScopes`;
  `/setup` verifies actual granted scopes; `contract-promote` refuses
  up front if `github:issues:write` is missing (no more silent
  tracking-issue failures).
- **Input preconditions** — `verify-deployment` refuses on null/empty
  target instead of emitting a misleading `hold` verdict.
- **Provenance stamping** — findings files record pluginVersion, model,
  protocolVersion, and contractHash for reproducibility.
- **CI workflow** (`workflows/eval.yml`) — runs the eval suite on every
  change; fails the build on test failure or schema violation.

### Changed
- `contract-verify` is now a two-layer orchestrator: deterministic
  validator first, then ONLY judgment critics (not all 9 as LLM calls).
  Lower cost, deterministic verdict.
- Contract format requires explicit `AC1 (B1):` behavior references so
  AC coverage is deterministically checkable.
- `verify-deployment` is platform-aware (web / Flutter / backend).
- Regression critic does cross-repo API dependency tracing.

### Fixed
- Parser used `\Z` (invalid in JS regex) as an end anchor, silently
  breaking AC→behavior parsing. Caught by the new eval harness.
- Out-of-schema severities ("high", "medium") are now rejected by the
  validator instead of leaking through.

### Known limitations (see RELIABILITY.md)
- Judgment-critic output still varies run-to-run (bounded by schema +
  protocol, but not bit-identical — inherent to LLMs).
- Content-hash caching designed, not yet implemented.
- True central state across branches not built (divergence is
  detectable via contractHash, not prevented).
- Model pinning depends on runtime support; the eval suite is the
  drift-detection mechanism.

## [0.1.0] — prototype

- Initial plugin: 9 critic skills, contract lifecycle (new/verify/
  promote), implement/verify/launch agents, GitHub Actions workflows,
  tutorial, setup-check, multi-repo config.
- All critics were LLM prompts (non-deterministic). Superseded by the
  two-layer architecture in 0.2.0.
