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

## Runs in both surfaces

This skill is plain markdown + one deterministic script, so it behaves
identically in **Claude Code** and **Cowork**. The offline web page
(`gate/prd-readiness-gate.html`) is the same rubric for PMs with no Claude
open; it mints the same gate-code format, so a code from any surface verifies
in all of them.

## Opening the live panel in Cowork (the artifact)

The chat flow below is the primary experience and needs nothing extra. In
**Cowork**, you can also give the user a persistent sidebar panel — the live
artifact `gate/ready-check-cowork.html`, where the deterministic gate runs
in-page and the edge-case review is done by Claude via
`window.cowork.askClaude` (no backend). The plugin can't ship the artifact
itself (plugins bundle skills/commands, not artifacts), so create it on demand:

When the user invokes `/ready-check panel`, says "open the Ready Check panel",
or on their first Cowork use of this skill (offer it once):

1. **Check for an existing one.** Call `mcp__cowork__list_artifacts`; look for
   an artifact with id `ready-check`.
2. **If absent — create it.** Call `mcp__cowork__create_artifact` with:
   - `id`: `ready-check`
   - `html_path`: the absolute path to `gate/ready-check-cowork.html` inside
     this plugin's installed directory
   - `description`: "Ready Check (live) — PM-side PRD readiness gate; smart
     edge-case review via Claude, no backend."
3. **If present — refresh it only when the plugin ships a newer build.** Both
   the installed artifact and the plugin's `gate/ready-check-cowork.html` carry
   `<meta name="ready-check-build" content="<N>">`. Read the build number from
   the existing artifact's `path` (from `list_artifacts`) and from the plugin's
   bundled file. If the bundled `N` is **greater**, call
   `mcp__cowork__update_artifact` (id `ready-check`, `html_path` = the bundled
   file, a one-line `update_summary`) so the user gets the latest. If the
   numbers match, do nothing — just tell them it's already in their sidebar and
   current. Never create a duplicate.
4. **Tell the user** the panel is in their Cowork sidebar (created / refreshed /
   already current) and persists across sessions.

Bump the `ready-check-build` number in `gate/ready-check-cowork.html` whenever
you change that file, so this auto-refresh can tell "newer" from "same."

Only works in Cowork (the artifact bridge is Cowork-only). In Claude Code there
is no sidebar panel — the `/ready-check` chat flow is the way. If the bundled
HTML can't be found, fall back to telling the user to open
`gate/ready-check-cowork.html` from the plugin folder directly.

**Optional — JIRA-link fetching in the panel.** The panel can fetch a pasted
JIRA link through the user's Atlassian connector. It's off by default and
workspace-specific: set `ATLASSIAN_MCP` (the CONFIG line at the top of
`gate/ready-check-cowork.html`) to that install's Atlassian tool-id prefix
(`mcp__<connector-id>__`), and pass the two Atlassian tool names
(`…getJiraIssue`, `…getAccessibleAtlassianResources`) in `mcp_tools` when you
create/update the artifact. Leave `ATLASSIAN_MCP` empty to disable — JIRA links
then just prompt the PM to paste the ticket text or use `/ready-check <link>` in
chat (which fetches via the connector regardless).

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

Only `skippable` items (design, oldbeh, states, writer) may take `{ "na": true }`,
and only with a real reason the PM confirms — never to dodge a question. For
everything you can't find, ask the PM in plain words, one short batch. Do not
invent answers.

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

### Phase 4 — Score + mint (deterministic)

Write the `answers` to a temp JSON and run the engine:

```
node scripts/ready-check.mjs --check   answers.json    # verdict JSON, exit 1 if not ready
node scripts/ready-check.mjs --handoff answers.json    # the hand-off block (includes the code)
```

- **Not ready** — present the missing items as a short, friendly to-do ("2
  things to add before dev"), each with the plain question and a one-line
  example. Offer to fill them with the PM now. Never mint a code.
- **Ready** — show the hand-off block from `--handoff`. The gate code is in it.

### Phase 5 — Hand off to dev

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

## Scenarios to handle

- **Backend-only feature** — mark `design` and `states` N/A (no UI). Everything
  else still required.
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
- **Not a PM** — a dev pre-checking their own pickup can run it too; same gate.

## Anti-patterns

- Don't eyeball the verdict or hand-write a gate code — always run the engine.
- Don't let a PM N/A a non-skippable item to slip through.
- Don't demand implementation detail from the PM (that's Level 2's job) — keep
  blockers to product decisions judgeable from text.
- Don't fetch source through non-approved means if an MCP fails — say so and ask
  the PM to paste the text.
