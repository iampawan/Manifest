---
name: implement
description: Implement a promoted contract — write code in the target repo's stack, generate tests in that stack's idiom, iterate until they pass, open the PR. Stack-agnostic: works for web (React/Next/Vue/...), mobile (Flutter/Swift/Kotlin/RN), and backend (Node/Python/Go/...). Use when the user says "implement contract", or in CI when a PR comment matches `@claude /implement <ID>`.
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

## Inputs

- Contract revision file: `.shipline/contracts/<ID>.r<N>.md` (immutable
  snapshot, not the live contract)
- Target repository: cwd (or specified)
- An existing PR or branch to push to, or instructions to create one

## Process

### 1. Read and parse the contract

Read the revision file. Identify platforms in scope, every behavior
(with instrumentation + perfBudget + commsStates), every acceptance
criterion, diagrams, and out-of-scope items (do NOT implement those).

### 2. Resolve the stack — DO THIS BEFORE WRITING ANY CODE

Read `.shipline/repos.yml` for the target repo. Resolve its toolchain
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

### 3. Reconnaissance (in the target repo's idiom)

Use Read / Grep / Glob to learn the EXISTING patterns in this specific
repo — don't impose patterns from another stack:
- How are components / screens / views / handlers organized here?
- What's the existing test setup (the resolved test framework)?
- How are feature flags implemented in THIS repo?
- How is instrumentation actually called here (match the existing
  call sites, per the SDK pattern in STACK-PROFILES)?
- How is i18n / localization handled here?

Match existing conventions exactly. A React repo gets hooks-style
code; a Flutter repo gets the repo's state-management idiom (Bloc/
Riverpod/Provider — whatever's already there); a Go repo gets
idiomatic Go. Never introduce a new pattern unless the contract
requires it.

### 4. Plan

Write `.shipline/contracts/<ID>.implementation-plan.md`:
- The resolved stack + toolchain commands you'll use
- File-by-file changes (in this repo's structure)
- Test files to add — one test per AC, in this stack's test framework
  and location (see STACK-PROFILES test-conventions table)
- Feature flag name + where it's gated in this repo
- This plan is your committed scope — don't drift.

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

### 7. Self-review

Re-read your diff before pushing:
- No debug prints (`console.log`, `print`, `fmt.Println` left in, etc.
  — stack-appropriate), no commented-out code, no TODOs.
- All new code paths feature-flagged.
- All new user-facing strings translated or marked for translation
  per this repo's i18n.
- No PII in analytics event properties.
- The diff matches the plan (no drift).

### 8. Open / update the PR

Via the GitHub MCP: push commits, create/update the PR with title from
`contract.title` and body referencing the revision file. Post an AC
coverage comment mapping each AC to its test file in this stack:

```markdown
## AC Coverage (<repo-name> · <framework>)

| AC | Test | Status |
|----|------|--------|
| AC1 | integration_test/auth_test.dart:12 | ✅ |
| AC2 | integration_test/auth_test.dart:34 | ✅ |
```

Plus "Files changed" and "Tests added (using <test framework>)".

### 9. Stop

Tell the user (or post in the PR) that the implementation is ready for
human review, noting the stack and toolchain used.

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
