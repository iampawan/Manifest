---
name: quick-fix
description: Express lane for trivial bugs and tiny changes — skips the full contract ceremony. Use for one-line fixes, copy/CSS tweaks, config changes, dependency bumps, or any change localized to one root cause with no new behavior, instrumentation, schema, or platform. Triggered by `/fix <description-or-bug-link>`. Triages size first and escalates to /contract if the change is bigger than trivial.
requiredScopes:
  - github:contents:write
  - github:pull_requests:write
---

# Quick-fix (express lane)

Process proportional to risk. Trivial changes get almost no process —
fix it, add a regression test if it's testable, open a PR. No
behaviors, no instrumentation fields, no perf budgets, no critics, no
SLA timer, no launch report. Those exist to de-risk *features*; a
one-line fix doesn't need them.

Target: minutes, not hours.

## Step 1 — Triage. Is this actually trivial?

This is the most important step. The express lane is ONLY valid for
changes that are:

- Localized to a single root cause / small diff
- In a single repo
- No NEW analytics event needed (a fix reuses existing events; a
  feature adds them)
- No schema change / migration
- No new platform brought into scope
- Not touching auth, billing, or payment primitives
- Not a refactor spanning many files

If ALL of those hold → proceed on the express lane.

If ANY fail → STOP and escalate:
> "This is bigger than a quick fix — it [adds a new event / touches
> two platforms / changes the schema]. Run `/contract new` instead so
> the critics catch the edge cases. Want me to start that?"

Don't force a real feature through the express lane. The triage gate
is what keeps the fast path safe.

### Edge: is it SO trivial that even this is overkill?

For a literal typo, a single CSS value, or a config flag flip, the
fastest path is to just make the edit and commit — you don't even
need `/fix`. Say so: "This is a one-character change; I can just make
the edit and you commit it, or I can open a tracked PR via /fix.
Which do you want?" Respect that sometimes the right amount of process
is none.

## Step 2 — Understand the change

If given a bug (description or JIRA/Linear link), fetch it and
understand: the repro steps, the expected vs actual behavior, and the
likely location. If given a change description, just understand the
intent.

Locate the relevant code (Grep/Glob/Read, or GitHub MCP). Confirm the
root cause before fixing — a fix for the wrong cause is worse than no
fix.

## Step 3 — Resolve the stack (same as the Implementer)

Read `.manifest/repos.yml` + `reference/STACK-PROFILES.md` to resolve
the repo's test/lint/build commands and test idiom. Don't assume a
stack. If unresolvable, ask.

## Step 4 — Write a one-line fix record (lightweight, not a contract)

`.manifest/fixes/<ID>.md` — minimal audit trail:

```markdown
---
id: FIX-042
title: OTP timer doesn't reset when app backgrounded
source: https://your-org.atlassian.net/browse/PROD-1234
type: bug          # bug | tweak | config | dep-bump
repo: flutter
createdAt: 2026-05-20T09:00:00Z
---

## Root cause
Countdown used app-lifetime elapsed instead of wall-clock; backgrounding paused the timer.

## Fix
Switch to wall-clock (DateTime.now() delta) in OtpCountdown.

## Regression test
integration_test/otp_countdown_test.dart — backgrounds the app mid-countdown, asserts the button re-enables based on real elapsed time.
```

No behaviors / instrumentation / perf / comms / ACs. Just enough to
know what changed and why.

## Step 5 — Implement + regression test

- Make the fix in the repo's idiom.
- Add a regression test that FAILS before the fix and PASSES after —
  in the stack's test framework (Playwright/Cypress for web, flutter
  integration_test, XCTest, pytest, go test, etc.). For a bug, the
  test should reproduce the bug; for a tweak with no testable
  behavior (pure CSS), note "no automated test — visual change" in
  the fix record.
- Run the resolved test/lint/build. Green before opening the PR.

## Step 6 — Open the PR

Push, open the PR titled `[FIX-042] <title>`, body links the fix
record and the bug. Include a short before/after and the regression
test reference. No AC-coverage table (there are no ACs) — just "fixes
<bug>, regression test added."

## Step 7 — Stop

Tell the user it's ready for review. No SLA timer, no canary ceremony
unless the change is risky enough that the user asks for it. For a
trivial fix, normal merge + deploy is fine.

## What the express lane deliberately SKIPS

- The critics (nothing to verify — no new behavior/instrumentation)
- The SLA timer (no promote step)
- The launch report (nothing new to measure)
- Cycle-time stamping (overkill for a fix)

If you find yourself wanting any of those, the change isn't trivial —
escalate to `/contract new`.

## Anti-patterns

- Don't run the full contract ceremony for a one-liner.
- Don't skip the triage gate — a "quick fix" that's actually a feature
  is how bugs ship.
- Don't skip the regression test for a bug fix (the test is the proof
  the bug is actually fixed and stays fixed). Pure-visual tweaks are
  the only exception.
- Don't guess the stack's test command — resolve it like the
  Implementer does.
