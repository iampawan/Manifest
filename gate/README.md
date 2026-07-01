# Ready Check — the PM front door to Manifest

A 2-minute check a PM runs before handing a feature to dev. Plain questions, no jargon.
When it's **Ready**, one click produces a clean hand-off — with the design link attached —
that dev can pick up without chasing anyone.

## Two ways to run it (same rubric, same gate code)

- **In Claude Code or Cowork:** `/ready-check <a JIRA / Notion / Doc / Slack / Figma URL,
  or "a description">` (alias `/ready`). Reads the source, asks only what's missing, mints
  the gate code + hand-off. Skill: `skills/ready-check/`.
- **Offline web page:** `prd-readiness-gate.html` in this folder — for PMs with no Claude
  open. Same 11-item rubric, same deterministic gate-code algorithm, so a code minted in the
  browser verifies dev-side.

Under both sits one deterministic engine, `scripts/ready-check.mjs` (verdict, gate code,
hand-off). Dev enforces with `node scripts/ready-check.mjs --verify <handoff>` →
`VALID | STALE | INVALID`; `/contract promote` refuses a PRD without a valid code.
Canonical rubric: `reference/READY-CHECK-RUBRIC.md`.

This is the fix for the `#fast-track-contract` pain: dev repeatedly chasing PMs for basic
details, then getting blamed for the delay. The basics now get checked on the PM side,
before an estimate is ever given.

## The philosophy shift

Manifest used to keep PMs out entirely ("dev does the archaeology, PM stays in JIRA").
We're changing that: **PMs do use Manifest — through a dead-simple front door.** They never
see the word "contract", "critic", or "instrumentation". They answer questions a PM already
knows the answer to. The heavy technical work still happens on the dev side, automatically.

## The flawless flow

```
PM writes PRD  →  Ready Check (this)  →  hand-off (JIRA/Slack)  →  Dev pickup (auto)
   as usual        plain questions        design link travels        code archaeology
                    green = ready         + gate code                only asks on real
                                                                     product decisions
```

1. **PM** answers the plain questions (or pastes the PRD and hits *Auto-fill*). Green = ready.
2. **One click** copies a hand-off: feature, platforms, **design link**, gate code, and the
   basics answered — ready to paste into the ticket or dev Slack thread.
3. **Dev** only grooms PRDs carrying a gate code. That single rule is the enforcement.
4. **Manifest** then does the deep technical pass and only pings the PM if a genuine product
   decision is needed — not for basics.

**Design sync:** the design link is a first-class field. A UI feature can't go Ready without
one (unless the PM explicitly marks it backend-only). It rides along in every hand-off, so
"the design wasn't even there" can't happen again.

## The questions (plain language)

Needed: the problem · how we'll know it worked · where the design is · platforms + what's out
of scope · what happens today · which screens it touches · what could go wrong · what the user
sees (nothing/loading/done/error) · wording final & translated · writer/creator impact · what
to track. Optional: dependencies · rollout.

Under the hood these map 1:1 to Manifest's validator + critics — the PM just never sees that.

## Why it's accurate enough (and where the depth is)

The check is a **floor**, not a judge: it guarantees the basics are *present and specific*.
It won't deeply grade quality on its own — that's the dev-side Manifest pass (real LLM critics)
right after. Two cheap layers on the PM side (auto-fill + the PM confirming each answer next to
its example) plus one deep layer on the dev side. Together they end the chasing without making
the PM do dev's job.

## Demo (3 min, for the Mohak meeting)

1. Open `prd-readiness-gate.html`. "This is the 2-minute check before a feature reaches dev."
2. **Try a rough example → Auto-fill.** Lands 1/11, NOT READY, with the exact gaps. "This is
   what reaches dev today. Caught in seconds."
3. **Try a complete example → Auto-fill.** Lands 11/11, READY, hand-off card appears with the
   Figma link and gate code. "Same feature, done right. Now it's groomable."
4. **Copy hand-off.** "This goes in the ticket. No code, no code review — dev picks it up clean."
5. Close: "PMs own the basics. Manifest owns the technical depth. Nobody chases anyone."

## Rollout (Pocket-FM dev first)

- Week 1: dev requires a gate code before grooming. Run the first few with Nishant.
- Week 2–3: measure follow-ups per PRD, re-estimation rate, first-try pass rate.
- Then generalize (writer-impact → configurable "stakeholder impact") for other teams.

## Next build

Wire the gate code into `/contract pickup` so Manifest itself refuses to promote a PRD without
a valid Ready Check code — turning the team rule into an enforced pipeline gate.
