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

### Phase 3 — Judge (make it smart)

Before scoring, read each answer critically and surface *text-judgeable*
blockers the PM should fix themselves. Keep it plain and specific:

- **goal/metric** — is the metric an actual number with a window? "Improve
  engagement" is not ready; "+6% D1 retention in 4 weeks" is.
- **edge** — name the obvious cases the PRD skipped (empty, offline, expired,
  concurrent, permission-denied). One line each.
- **states** — for a user-facing change, is there copy for nothing-yet /
  loading / done / error?
- **scope** — is there an explicit *out of scope*? Vague scope is a blocker.

Do NOT push code-level decisions onto the PM (schema, security design, perf
strategy). If a concern needs the repo to answer, note it as "dev will confirm"
— it belongs to Level 2, not here.

**Code-aware notes (if a cache exists).** If `.manifest/.cache/code-context.json`
is present, call `ready-check.mjs --cache-check <answers.json>
.manifest/.cache/code-context.json` and fold the notes in — e.g. an event name
that breaks the app's convention, or a flow that touches more surfaces than the
PRD lists. These are non-blocking nudges the PM can act on without touching
code. No cache? Skip silently; the check still works on text alone.

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

## Enforcement — "no code, no grooming"

The gate code is content-bound (a djb2 hash of the answers), so it's checkable,
not decorative. Dev-side, before grooming:

```
node scripts/ready-check.mjs --verify <pasted-handoff.txt>   # → VALID | STALE | INVALID
```

- `VALID` — the PRD matches the code; groom it.
- `STALE` — the PRD was edited after clearing; re-run Ready Check.
- `INVALID` — no/garbled code; it never passed the gate.

`contract-pickup` should refuse to promote a contract whose source lacks a
`VALID` Ready Check code (record it as `readyCheck: RC-…` in the contract
frontmatter). That turns the team rule into a pipeline gate.

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
- **Not a PM** — a dev pre-checking their own pickup can run it too; same gate.

## Anti-patterns

- Don't eyeball the verdict or hand-write a gate code — always run the engine.
- Don't let a PM N/A a non-skippable item to slip through.
- Don't demand implementation detail from the PM (that's Level 2's job) — keep
  blockers to product decisions judgeable from text.
- Don't fetch source through non-approved means if an MCP fails — say so and ask
  the PM to paste the text.
