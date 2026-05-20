---
name: tutorial
description: Interactive 3-minute walkthrough of Shipline for first-time users. Use when a user types `/shipline`, `/shipline tutorial`, `/contract` (with no args), `/contract help`, asks "how do I use this", or otherwise signals they're new and want orientation. Adapts depth based on what the user wants to learn.
---

# Shipline tutorial

You are giving a first-time user a quick orientation. Keep it
conversational — they don't want a manual, they want to feel
oriented enough to take a first action. Aim for under 3 minutes of
their reading time.

## Detect what kind of welcome to give

Read the user's input phrasing:

- **"What is this?" / "/shipline" / "/contract" with no args** →
  Give the 30-second overview, then offer three paths.
- **"How do I use this?" / "tutorial" / "walk me through"** →
  Give the guided walkthrough.
- **"What are the options?" / "commands?" / "help"** → Give the
  reference card.

Default to overview + paths if intent is unclear.

## Always check setup first

Before doing anything else, invoke the **setup-check** skill briefly
to see what's connected. Use the result to tailor the tutorial:

- If everything is connected: proceed normally.
- If something required is missing: tell the user upfront — "I see
  your Slack MCP isn't connected; that's required for the team
  workflow. Want me to walk through what to connect, then come back
  to the tutorial?"
- If recommended MCPs are missing: continue the tutorial but call
  out what features won't work yet — "JIRA-based intake won't work
  without the Atlassian MCP; we'll use free-text intake for the
  demo."

This way the user never gets surprised mid-flow by a missing MCP.

## The 30-second overview

Start with this exact framing (rephrase naturally; don't read it
verbatim):

> Shipline takes a feature idea — a PRD, a JIRA ticket, or a one-line
> description — through a quality-gated pipeline from spec to
> production. Critics check the spec for completeness. An agent
> implements it. The system tracks whether the feature actually
> landed.
>
> The contract — a structured markdown file — is the source of truth
> at every stage. Critics won't let a contract progress until
> required fields are filled. That's what prevents bugs at PRD time
> instead of production time.

Then ask:

> Three ways to learn this:
>
> 1. **🚀 Just try it** — paste a JIRA ticket or describe a feature.
>    I'll walk you through the rest.
> 2. **📋 Show me a demo** — I'll run through an example contract so
>    you can see what the critics catch.
> 3. **📖 Just the reference** — show me the commands and options.

Wait for the user's pick.

## Path 1: Just try it

Ask one question:

> What feature do you want to spec? Either paste a JIRA / Linear /
> Notion link, or describe it in a sentence.

Then route to the **contract-new** skill with their input. Don't ask
the five questions yet — let contract-new handle the intake. As
contract-new runs, narrate in plain language what's happening:

> "Reading your JIRA ticket via the Atlassian MCP..."
> "Extracted the title, description, and 3 platforms from labels..."
> "I need to ask 2 things the ticket didn't cover..."

After contract-new finishes:

> Want me to run the critics now? They'll find what's missing in the
> spec — about 90 seconds.

If yes → invoke contract-verify. After it returns, summarize the
findings in plain language and explain what each severity means:

> The critics found 2 blockers and 4 warnings. Blockers are gaps
> that prevent the contract from progressing — usually missing
> instrumentation or undefined error states. Warnings are things to
> address but not deal-breakers.
>
> Open `.shipline/contracts/<ID>.findings.md` to see them all. The
> typical workflow is: read findings → edit the contract to address
> them → re-run /contract verify until readiness goes green.

End with:

> Once readiness is green, `/contract promote <ID>` freezes the
> revision and starts the SLA timer. That's where implementation
> begins.

## Path 2: Show me a demo

Use the example contract at `examples/EX-001-saved-cards.md`. Walk
through:

1. **The contract format** — open the file and explain the sections:
   frontmatter (typed metadata), Goal, Success Metrics, Behaviors,
   Acceptance Criteria, Diagrams, Out of Scope, Open Questions.
   Spend 20 seconds on why each matters.

2. **The critics** — explain what each of the 9 critics looks for
   in this example contract. Don't list all 9; pick 3-4 high-value
   examples:
   - **edge-cases** would flag "what happens if the user has no
     internet during the card-save"
   - **instrumentation** ensures every behavior has an analytics
     event tied to it
   - **regression** would scan other repos for code that touches
     payment methods
   - **sizing** would classify this Medium (2 platforms, schema
     addition)

3. **The gates** — readiness is computed mechanically:
   - 0 open blockers
   - Every behavior has instrumentation
   - Every behavior has at least one AC
   - Confidence ≥ 80%
   No contract progresses without these.

4. **What happens next** — promote freezes a revision and starts
   the SLA timer (24h Small, 72h Medium). The implementer agent
   runs in CI on a PR. Verifier runs Playwright against deployed
   environments. Launch reports run for 28 days.

5. **End with:** "Want to try it on a real feature now? Paste a
   JIRA link or describe what you want to build."

## Path 3: Reference card

Show this compact reference:

```
/contract new <URL or "description">    Author a contract (intake)
/contract verify <ID>                    Run all critics
/contract promote <ID>                   Freeze + start SLA timer

/implement <ID>                          Run implementer agent
/verify-pr <PR>                          Verify PR against contract
/launch <ID> [--day N]                   Manual launch report

/shipline                                This tutorial
/shipline help                           Same as above
```

Then add:

> Input forms `/contract new` accepts:
>
> - `/contract new "Add CSV export"`              ← free text
> - `/contract new https://...atlassian.net/...`  ← JIRA ticket
> - `/contract new https://linear.app/...`        ← Linear issue
> - `/contract new https://notion.so/...`         ← Notion page
> - `/contract new https://github.com/.../issues/N` ← GH issue
> - `/contract new https://figma.com/file/...`    ← Figma file
>
> For deep walkthroughs:
> - `GUIDE.md` — the full how-it-works manual
> - `MVP-PLAN.md` — demo and rollout strategy
> - `reference/CONTRACT-FORMAT.md` — contract schema reference

End with:

> Ready? Run `/contract new <your-thing>` to start.

## Edge cases

- **User asks about a specific skill or critic by name** → Read
  that skill's SKILL.md and explain in plain language what it does
  and when it fires.
- **User asks "what about <X tool we don't have>?"** → Be honest.
  If they don't have Amplitude/Firebase Analytics, point at the
  fallback measurement sources in launch-report.
- **User seems confused mid-tutorial** → Stop, ask "what's the part
  that's unclear?" Don't barrel forward.
- **User has already run a command before** (check for
  `.shipline/contracts/` existence) → Skip the welcome framing; go
  straight to whatever they're asking about.

## Anti-patterns

- Don't dump the entire GUIDE.md content. Link to it for depth.
- Don't list all 16 skills with descriptions. Pick the 3-4 the user
  will actually use first.
- Don't pretend the system is magic. It's a structured spec format +
  critics + an agent. Be honest about what it doesn't do (write
  designs, replace product judgment, ship Large features).
- Don't be cheery beyond what's natural. Just be clear and useful.
