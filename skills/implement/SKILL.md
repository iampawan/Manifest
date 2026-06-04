---
name: implement
description: Implement a promoted contract — write code in the target repo's stack, generate tests in that stack's idiom, iterate until they pass, open the PR. Also runs in fix-mode (review→fix loop) to address open PR-review/verify-pr findings on an existing PR. Stack-agnostic: works for web (React/Next/Vue/...), mobile (Flutter/Swift/Kotlin/RN), and backend (Node/Python/Go/...). Use when the user says "implement contract", or in CI when a PR comment matches `@claude /implement <ID>` or `@claude /fix-pr <ID>`.
requiredScopes:
  - github:contents:write
  - github:pull_requests:write
---

# Implementer agent

You take a promoted contract revision and turn it into a PR with code,
tests, and a self-review comment. **You assume NOTHING about the
stack.** You read the target repo's toolchain from `repos.yml` +
`reference/STACK-PROFILES.md` and use the right commands and test idioms for
that repo — npm for Node, flutter for Flutter, gradlew for Android,
pytest for Python, go test for Go, and so on.

## Two modes

- **Build mode (default)** — turn a freshly-promoted contract into a new
  PR. This is the main flow below (steps 1–9).
- **Fix mode** (`mode: "fix"`, triggered by `@claude /fix-pr <ID>`) —
  the **review→fix loop**: address the open findings that `code-review`
  and `verify-pr` left on an existing PR, re-push, and let CI re-verify.
  See "Fix mode: the review→fix loop" near the end. Skip straight there
  when invoked with `mode: "fix"`.

## Inputs

- Contract revision file: `.manifest/contracts/<ID>.r<N>.md` (immutable
  snapshot, not the live contract)
- Target repository: cwd (or specified)
- An existing PR or branch to push to, or instructions to create one
- `mode`: `"build"` (default) or `"fix"`

## Process

### 1. Read and parse the contract

Read the revision file. Identify platforms in scope, every behavior
(with instrumentation + perfBudget + commsStates), every acceptance
criterion, diagrams, and out-of-scope items (do NOT implement those).

### 2. Resolve the stack — DO THIS BEFORE WRITING ANY CODE

Read `.manifest/repos.yml` for the target repo. Resolve its toolchain
using `reference/STACK-PROFILES.md` resolution order:

1. Explicit `toolchain.<command>` in repos.yml wins.
2. Else infer from the repo's `framework` (nextjs / flutter /
   ios-native / android-native / fastapi / gin / ...).
3. Else infer coarsely from `languages`.
4. **If you still can't determine the test/build command with
   confidence, STOP and ask the user** — never guess a build command.
   Suggest they add a `toolchain` block to repos.yml so it's not asked
   again.

Record the resolved commands you'll use:
- install, test, testE2E, lint, typecheck (if applicable), build
- the test framework + file location + tag convention for this stack
- the instrumentation SDK call pattern for this stack

If the contract spans multiple platforms (e.g., web + iOS + android),
you'll produce a separate PR per repo, each using that repo's stack.

### 3. Reconnaissance (mandatory — write nothing until this is done)

Before you create a file or write a function, you must establish what
already exists in this repo and how it's organized. **This step is
non-optional.** PRs that skipped recon are the single biggest source
of Cursor-flagged issues we ship — duplicate utilities, mismatched
naming, mismatched error handling, mismatched component patterns.

Do all of this:

**3a. Grep for what you're about to add.** For each new symbol,
component, or hook the plan says you'll create:

- `grep -rn "<name>" --include='*.<ext>'` in the target repo.
- If a near-match exists (same name, same name with different casing,
  same purpose), STOP and re-plan to reuse it. Don't create
  `formatDate2` next to `formatDate`. Don't create `useDictation`
  next to `useSpeechToText`.

**3b. Read 1–3 sibling files in the target folder.** The folder
where you're adding a new file already contains examples of how this
team writes that *kind* of file. Read them:

- Imports order + style
- Export style (default vs named, file naming)
- Component structure (forwardRef? memo? hooks order?)
- Error handling shape (try/catch + report? Result type? Promise.allSettled?)
- Naming conventions (handlers, state vars, refs, props)
- Test file location + naming

Copy the structure of the nearest sibling. The plan says *what* to
build; the sibling says *how this team builds it*.

**3c.0 — Read the bug-pattern catalog before you write anything.**
`reference/BUG-PATTERNS.md` is the catalog of shapes Cursor /
human reviewers / postmortems have caught in past Manifest-shipped
PRs. Every entry is a thing you must not write. Scan it once at the
start of every implementation — the catalog is small enough to read
in 60 seconds, and reading it stops you from writing the same bug
twice.

For each behavior you're about to implement, ask: which of the
catalog's patterns could plausibly apply to this code? Pre-empt those
patterns in the design — pick the safe shape *before* writing the
risky one. This is the cheapest place to catch them.

**3c.1 — Consult the code-context cache.** Read
`.manifest/.cache/code-context.json` (built by
`scripts/build-code-context.mjs`):

- `events.catalog` — does the event name you're about to create
  already exist? Use the existing one. Match the
  `naming_patterns.convention`.
- `i18n` — does a string you'd hardcode already have a key? Use the
  key. Don't add a near-duplicate key in a different file.
- `dependencies.flags` — is there a flag for this surface area
  already? Use it; don't add a parallel one.
- `dependencies.shared_modules` — is there a shared module you should
  import from? Don't re-implement.
- `history` — any rolled-back / partial past contract on this
  surface? Read its postmortem to learn what went wrong; avoid
  repeating.
- `similar_contracts` — any landed contract on the same surface?
  Look at how its acceptance criteria were tested; mirror.

If the cache is missing or stale, run
`node scripts/build-code-context.mjs --verbose` once; ~30s. Don't skip
this — every implementation produces fewer Cursor-flagged issues when
the cache has been consulted.

**3d. Existing patterns checklist.** Confirm and note in the plan
(step 4):

- How are components / screens / views / handlers organized here?
- What's the existing test setup (the resolved test framework)?
- How are feature flags implemented in THIS repo?
- How is instrumentation actually called here (match the existing
  call sites, per the SDK pattern in STACK-PROFILES)?
- How is i18n / localization handled here?
- What's the existing error-handling pattern (does the repo use
  Result types? toast helpers? a logger?) — match it. **Do not
  introduce an empty catch.**
- How are race-critical guards typically written here — `useRef`,
  `useState`, button `disabled`, debounce, throttle? Match the
  established convention rather than inventing.

Match existing conventions exactly. A React repo gets hooks-style
code; a Flutter repo gets the repo's state-management idiom (Bloc/
Riverpod/Provider — whatever's already there); a Go repo gets
idiomatic Go. Never introduce a new pattern unless the contract
requires it.

**Write the recon findings into the PR body** (see step 8) so the
reviewer can see what you read before writing — this is the
transparency that makes the rest of the PR easier to trust.

### 4. Plan

Write `.manifest/contracts/<ID>.implementation-plan.md`:
- The resolved stack + toolchain commands you'll use
- File-by-file changes (in this repo's structure)
- Test files to add — one test per AC, in this stack's test framework
  and location (see STACK-PROFILES test-conventions table)
- Feature flag name + where it's gated in this repo
- This plan is your committed scope — don't drift.

**Solo / zero-footprint mode (GUIDE §1f):** the `.manifest/` artifacts
(this plan, findings, etc.) belong to the user's *contracts location*,
NOT the target repo's working tree. Write the implementation-plan there.
The ONLY things you write into the target repo's branch are the **feature
code and its tests** — never a `.manifest/` file. So the PR the team
reviews contains code + tests only; no contract, plan, or findings leak
into their diff.

### 5. Implement

Work through the plan. For each behavior:
1. Add the feature-flag gate (this repo's flag mechanism).
2. Implement the happy path matching the AC, in this repo's idiom.
3. Implement empty / loading / error states from `commsStates`.
4. Fire `instrumentation.eventName` using THIS stack's SDK call
   pattern (e.g., `FirebaseAnalytics.instance.logEvent(...)` for
   Flutter, `track(...)` for web Amplitude, `Analytics.logEvent(...)`
   for iOS — see STACK-PROFILES).
5. Generate one test per AC in this stack's test framework, in the
   right location, with the stack's tag convention so verify can map
   results back to ACs.

### 6. Run locally — using the RESOLVED commands

Run the commands you resolved in step 2 — NOT hardcoded ones:
- the resolved `test` command (unit) — must pass
- the resolved `testE2E`/integration command — new tests must pass
- the resolved `lint` command
- the resolved `typecheck` (if the stack has one)
- the resolved `build` command (if the stack has one)

Examples of what "resolved" means per stack:
- Next.js: `npm test`, `npx playwright test`, `npm run lint`, `tsc --noEmit`, `npm run build`
- Flutter: `flutter test`, `flutter test integration_test/`, `flutter analyze`, `flutter build apk --release`
- iOS native: `xcodebuild test -scheme <S>`, `swiftlint`, `xcodebuild build`
- Android native: `./gradlew test`, `./gradlew connectedAndroidTest`, `./gradlew lint`, `./gradlew assembleRelease`
- Python: `pytest`, `ruff check`
- Go: `go test ./...`, `golangci-lint run`, `go build ./...`

If anything fails, iterate. Don't open the PR until everything is green.

### 7. Self-review — TWO passes, both mandatory

**7a. Eyeball checklist (you do it yourself).**

Re-read your diff before pushing:
- No debug prints (`console.log`, `print`, `fmt.Println` left in, etc.
  — stack-appropriate), no commented-out code, no TODOs.
- No empty catch blocks. Every `catch` either re-throws, logs to the
  repo's error tracking, surfaces to the user, or contains genuinely
  side-effect-free logic. **No `catch {}` followed by state mutation
  or analytics — Cursor will flag it and you'll re-do the loop.**
- No `useState` flag used as a concurrency guard for race-critical
  paths (rapid double-click, double-fire, double-submit). Use
  `useRef` or `disabled` instead.
- No analytics events firing before the underlying action succeeded.
- All new code paths feature-flagged.
- All new user-facing strings translated or marked for translation
  per this repo's i18n.
- No PII in analytics event properties.
- The diff matches the plan (no drift).

**7b. Run the `code-review` critic on your own diff — with the FULL
catalog every time.** This is the same critic that CI runs after
you push. Run it BEFORE the first push, and **on every fix
iteration, re-run with the full `reference/BUG-PATTERNS.md` library,
not just the previous round's class.**

```bash
# Invoke the code-review skill as a sub-agent against your diff.
# Output: findings JSON validated by --check-review.
#
# The critic loads BUG-PATTERNS.md at start and checks every active
# pattern (BP-001 ... BP-NNN) against the diff in one pass.
```

**Check `repos.yml` for self-review config first.** Three modes:

- `selfReview: on` (default) — always run before first push.
- `selfReview: off` — skip entirely. CI / Cursor become the first
  line of defense. Use when implementer time-per-run is the
  bottleneck and you accept more iterations per PR.
- `selfReview: auto` — run only when the diff is substantial
  (changed lines ≥ `selfReviewMinChangedLines`, default 0). Use to
  skip self-review on tiny patches where the overhead doesn't pay
  off.

Default `selfReviewMaxIterations: 2`. Per-contract override via
contract frontmatter `selfReviewMaxIterations`.

The loop (when self-review is enabled):

1. Run `code-review` with the full catalog. Get findings.
2. If 0 blockers + 0 warnings: push.
3. If findings: fix them in-place. **Cap: `selfReviewMaxIterations`
   (default 2).**
4. **Each iteration must re-scan the full catalog** — don't
   narrowly fix only what the previous round flagged. The point of
   the catalog is that fixing pattern X often introduces pattern Y;
   only a full re-scan catches Y before push. This is the
   structural fix to the "Cursor catches new things every round"
   problem.
5. If the iteration cap is hit with blockers remaining: stop and
   push with a self-review comment that names the open issues and
   why you couldn't resolve them. Don't churn.

The point is to catch every pattern in the catalog *before* CI does.
External reviewers (Cursor / human / Sentry-driven) should find
nothing new — because if they catch something new, it becomes a
permanent entry in `reference/BUG-PATTERNS.md` and the next
implementer run pre-empts it.

**The catalog grows one direction only.** Every new external finding
that isn't already in `BUG-PATTERNS.md` is a permanent addition.
This is the structural mechanism that converges Manifest's
self-review with what Cursor catches — over time, *fewer* iterations
per PR, not more.

### 8. Open / update the PR — write it like a dashboard

The PR body is the single artifact every reviewer reads. Make it
**at-a-glance complete**: a reviewer with 30 seconds should know what
this PR is, why, what changed, what's been checked, and what to look
at. A reviewer with 5 minutes should be able to merge confidently
without opening any other tab.

**The PR body MUST follow this template.** Sections in order:

````markdown
## What this PR does

<2–3 sentences in plain English. What problem does this solve, for whom.
NO jargon as the lead. A PM reading should understand it. A new
engineer reading should understand it.>

## Contract

**SC-001 · Voice dictation in the script editor**  ·  Medium · 72h SLA · web

⏳ SLA: 14h 30m left (due 2026-06-07 11:50 IST)
📄 [`.manifest/contracts/SC-001.r1.md`](link to the revision)
🎯 4 behaviors · 12 acceptance criteria

## Shape of the change

```mermaid
<paste or generate a flow diagram of the new behavior. If the
contract already has a diagram in its Diagrams section, reuse it.
Otherwise generate one showing the user-flow this PR enables.>
```

## Files changed

| File | Why |
|---|---|
| `src/.../voice-dictation-toolbar-button.tsx` (new) | Mic button + active state + volume pulse |
| `src/.../use-web-speech-dictation.ts` (new) | Web Speech API hook |
| `src/.../punctuation-commands.ts` (moved from `use-speech-to-text.ts`) | Shared punctuation map (REG-001) |
| `src/.../events.ts` | New EDITOR_VOICE_DICTATION_* action constants |
| `tests/...` | AC1–AC12 coverage |

(One-liner each. Reviewers should not have to open files to know
what each does.)

## AC coverage

| AC | What it checks | Test | Status |
|----|----------------|------|--------|
| AC1 | Mic toggle starts session, fires start event | tests/voice-dictation-toolbar-button.test.tsx:18 | ✅ |
| AC2 | Spoken text + punctuation inserts at caret | tests/use-web-speech-dictation.test.ts:42 | ✅ |
| ... | ... | ... | ... |

## What I read before writing code

This is the recon I did (step 3 of the implementer skill):

- `src/.../TtsToolbarButton.tsx` — followed the toolbar registration pattern
- `src/.../use-speech-to-text.ts:41` — extracted `applyPunctuationCommands`
  to a shared util rather than duplicating
- `events/catalog.ts` — used existing `EVENT_TYPE.BUTTON_CLICK` + new
  `ACTION.EDITOR_VOICE_DICTATION_*` constants, matching the `SHERPA_VOICE_INPUT_*` shape
- `i18n/en.json` — added 8 new strings; no near-duplicates of existing keys
- `.manifest/.cache/code-context.json` — confirmed no existing dictation hook on the editor surface

## Self-review summary

Ran `code-review` critic on my own diff before pushing.

**Caught and fixed (2):**
- 🐛 Empty catch in `useWebSpeechDictation` start handler → now logs to Sentry + surfaces toast
- 🐢 Unnecessary re-render of toolbar on every interim transcript → memoized the volume-pulse component

**Open (0).** All blockers resolved.

(If anything is left open, list it here with one line + why it's
acceptable. Reviewer can challenge.)

## How to test locally

```bash
<the exact commands a reviewer needs — install, run, navigate to the screen>
```

Manual test path:
1. Open a chapter in the script editor (Chrome, mic permission allowed)
2. Tap the new mic button in the toolbar — should show "Listening…" state
3. Say "hello world period" — should insert "hello world." at the caret
4. Tap again to stop — should fire `editor_voice_dictation_stop` with `inserted_char_count > 0`

## Risk callouts — look here first if something breaks

- **AnalyserNode lifecycle.** New `getUserMedia` stream needs to be torn
  down on editor blur / unmount or the OS mic indicator lingers. Tested
  in `use-web-speech-dictation.test.ts:88`; risk is real-world browser
  edge cases (Safari behaves differently on tab-hide).
- **Rapid double-click on mic button.** Guarded with `useRef` (not
  `useState`) to avoid the race that landed in PR #1234. Tested with
  `userEvent.dblClick` in `voice-dictation-toolbar-button.test.tsx:54`.
- **Hindi recognition accuracy.** Web Speech API on Chrome routes audio
  to Google; out-of-our-hands quality. Monitored via the
  `dictation_session_completion_rate` metric.
````

**Rules for the body:**

- **Plain English everywhere.** No jargon as a lead in any section.
  Pretend a PM and a new engineer are reading; both should follow.
- **The Mermaid diagram is required.** If the contract has a diagram,
  reuse it. If not, generate the user-flow diagram for this PR. A
  picture beats five paragraphs.
- **Risk callouts are required.** Even if it's just "no risky areas —
  changes are additive and feature-flagged." Don't skip the section;
  skip the *content* if there genuinely isn't risk.

**Lead the FIRST comment on the PR with the SLA line:**

```bash
node <plugin-root>/scripts/validate.mjs --sla .manifest/contracts/<ID>.md
```

Prepend its output (e.g., `⏳ SLA: 14h 30m left (due ...)`) to the
first review comment and any Slack ping, so the reviewer sees the
countdown without opening the PR body.

**Subsequent comments (code-review findings, fix-pr updates, AC
coverage refreshes)** must follow `reference/PR-COMMENT-STYLE.md` —
plain-English title, what / why-it-matters / the-fix, code snippet,
file:line. No exceptions.

### 9. Stop

Tell the user (or post in the PR) that the implementation is ready for
human review, noting the stack and toolchain used.

## Fix mode: the review→fix loop

When invoked with `mode: "fix"` (via `@claude /fix-pr <ID>`), you are
closing the loop on an existing PR instead of building a new one. The
goal: turn a PR with open review findings into a green one without a
human having to relay each comment back to you.

### F1. Read the open findings

- `.manifest/contracts/<ID>.pr-review.json` — the `code-review` skill's
  validated findings. Address every **open `blocker`** and, if the team
  has `conventions.autoFixWarnings: true` in `repos.yml`, open
  `warning`s too. Leave `info` alone unless trivial.
- The latest `verify-pr` PR comment — any unmet AC, missing
  instrumentation call, or absent flag gate it flagged.

If both are clean, post "nothing to fix — PR is green" and stop.

### F2. Check the iteration budget — STOP if exhausted

The loop is bounded so it can never churn forever. Read
`fixIterations` from the live contract frontmatter (default 0) and
`maxFixIterations` (default **3**; override in `repos.yml`
`conventions.maxFixIterations`).

- If `fixIterations >= maxFixIterations`: **do not fix.** Post a PR
  comment + a top-level Slack alert summarizing the still-open findings
  and asking a human to take over, and stop. Looping past the cap
  usually means the finding needs a judgment call you shouldn't make
  silently.
- Otherwise increment `fixIterations` by 1 and record it in the
  contract frontmatter before you push.

### F3. Fix — narrowly

Resolve the source repo's stack (same as build mode step 2). For each
open finding:
- Make the smallest correct change that resolves it, in the repo's
  existing idiom. Don't refactor beyond the finding.
- If a finding reflects a missing test (unmet AC), add the test in this
  stack's framework, tagged so verify can map it.
- **Do not expand scope.** A review finding is not license to redesign.
  If fixing it properly requires out-of-scope changes or contradicts an
  AC, stop and escalate to a human instead of guessing.

Mark each addressed finding `resolved` in `<ID>.pr-review.json`.

### F4. Re-run locally, then push

Run the resolved test/lint/typecheck/build commands (build mode step
6). Green or nothing — never push a fix that breaks the suite. Push to
the same PR branch. The push fires `pr-verify.yml` (synchronize), which
re-runs `verify-pr` + `code-review` and regenerates the findings. If
blockers remain and the budget isn't spent, the loop runs again on the
next `@claude /fix-pr`.

### F5. Report

Lead with the SLA line. Post a PR comment listing what you fixed
(finding ID → change) and what (if anything) you escalated, e.g.:

```markdown
⏳ SLA: 9h 05m left (due 2026-05-21 13:30 IST / 08:00 UTC)

## Fix pass 2 of 3

Resolved:
- CR-001 (security) — parameterized the cards query (api/cards.ts:88)
- CR-002 (correctness) — guarded `card?.last4` (SavedCardRow.tsx:142)

Re-running verify-pr + code-review on this push.
```

## When to ask the user instead of proceeding

- The stack can't be resolved (no framework, unknown languages) — ask
  for the toolchain.
- The contract has contradictory ACs you can't satisfy together.
- Implementing a behavior requires touching out-of-scope code.
- A required SDK/service is missing with no obvious fallback.

For everything else — make the call, document it, proceed.

## Anti-patterns

- **Don't assume a stack.** No defaulting to npm/Playwright. Resolve
  from repos.yml + STACK-PROFILES first.
- **Don't guess a build/test command.** If unresolved, ask.
- Don't read the live contract; read the revision snapshot.
- Don't add features the contract doesn't specify.
- Don't introduce new dependencies or patterns if existing ones suffice.
- Don't skip tests because it "obviously works."
- Don't push partial work — green or nothing.
- Don't write a Playwright test for a Flutter repo, or a pytest for a
  Go repo. Match the stack.

## Slack threading

Post Slack updates as a REPLY in the contract's thread, not a new
top-level message: use `thread_ts: <contract.slackThreadTs>` in the
channel `<contract.slackChannel>` (both set by contract-promote). This
keeps `#manifest` to one line per contract. Exception: an overdue SLA,
a `rollback`, or a canary auto-pause also posts a brief top-level alert
linking back to the thread. (See reference/CONTRACT-FORMAT.md.)
