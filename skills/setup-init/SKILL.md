---
name: setup-init
description: Interactive first-run setup. Auto-detects the user's repos, frameworks, event SDKs, and test patterns, asks ONLY the questions detection can't answer, then writes a complete .shipline/repos.yml with zero placeholders. Use on first run, when `/setup` finds no repos.yml, or when the user says "set up shipline", "configure shipline", "init".
---

# Setup wizard

Your job is to produce a COMPLETE, ready-to-use `.shipline/repos.yml`
with no `⚠️ FILL IN` placeholders left. Detect everything you can,
ask only what you can't, confirm, and write. The user should never
have to hand-edit YAML after this.

Detect → ask the minimum → auto-fill → confirm → write.

## Step 1 — Discover the repos

Try these in order until you have the repo list:

1. **Ask the user** — "Which repos are part of this product? Paste
   GitHub identifiers (`org/repo`) or local paths, one per line."
   Accept either form. This is the primary, universal method.
2. **Scan a workspace dir** — if the user points at a parent folder
   (e.g., `~/Documents/dev/<product>`), list its subdirectories that
   are git repos (`.git` present) and propose them.
3. **GitHub org listing** — if the GitHub MCP is connected and the
   user names their org, list its repos and ask which are in scope.

Do NOT assume any particular code-index or navigator MCP exists.
Discovery must work with nothing but the GitHub MCP and the user's
input.

## Step 2 — Auto-detect each repo's stack (deterministic)

For LOCAL repos, run the bundled deterministic detector — don't
eyeball it:

```bash
node <plugin-root>/scripts/detect.mjs <repo-path-1> <repo-path-2> ...
```

It returns JSON per repo: `framework`, `languages`, `eventSdk`,
`testFramework`, `testPattern`, and a `confidence`. This is code, not
a guess — reproducible and fast.

For REMOTE repos (GitHub MCP only, no local clone), fetch the marker
files (`package.json`, `pubspec.yaml`, `go.mod`, `build.gradle`,
`requirements.txt`, `pyproject.toml`, `Package.swift`, `Gemfile`) via
`get_file_contents` and apply the same logic (the detector's
`detectFromFiles` core, or the STACK-PROFILES table by hand).

The detector reports the same fields described below. Treat anything
it marks `confidence: low` (framework "unknown") as a question for
Step 4, not a guess. The reference for what each value means:

### framework (from marker files)

| Marker found | framework |
|---|---|
| package.json deps include `next` | nextjs |
| package.json deps include `react` + `vite` | react |
| package.json deps include `react-scripts` | react |
| package.json deps include `vue` | vue |
| package.json deps include `@angular/core` | angular |
| package.json deps include `svelte` | svelte |
| package.json deps include `react-native` | react-native |
| package.json deps include `@nestjs/core` | nestjs |
| package.json deps include `express` / `fastify` | express / fastify |
| pubspec.yaml present | flutter |
| *.xcodeproj / Package.swift, no pubspec | ios-native |
| build.gradle(.kts) + kotlin, no pubspec | android-native |
| pyproject/requirements + `fastapi` import | fastapi |
| pyproject/requirements + `django` | django |
| pyproject/requirements + `flask` | flask |
| go.mod + `gin-gonic` | gin |
| go.mod (no web framework) | go |
| Gemfile + `rails` | rails |
| build.gradle + `spring-boot` | spring |

### languages — from framework + file extensions present

### eventSdk (grep imports / deps)

| Found | eventSdk |
|---|---|
| `amplitude` in a frontend | amplitude |
| `amplitude` / `@amplitude/node` in a backend | amplitude-node |
| `firebase_analytics` (Dart) / `FirebaseAnalytics` (Swift/Kotlin/JS) | firebase |
| `mixpanel` | mixpanel |
| `@segment/analytics` | segment |
| none found | leave unset, ask in Step 4 |

### testPattern + testFramework (look at devDeps / test dirs)

playwright / cypress / jest / vitest (web), `integration_test/`
(flutter), `*UITests` (ios), `androidTest/` (android), pytest
(python), `*_test.go` (go).

### apiClientPattern (where HTTP calls live) — grep for fetch/axios/
dio/http/requests/URLSession and record the directory.

### For backends: serves (route prefixes)
Grep the route definitions (`routePattern`), extract the common path
prefixes, and propose them as `serves: [...]`. E.g., if routes include
`/auth/login`, `/auth/otp`, `/feed/list` → propose
`serves: ["/auth/*", "/feed/*"]`.

Record a CONFIDENCE for each detection (high/medium/low). High-
confidence detections are auto-filled silently. Low-confidence ones go
into the Step 4 confirmation.

## Step 3 — Infer cross-repo links

- **apiDependencies**: match each frontend's `apiBaseUrl` (from its
  HTTP client config) to the backend whose `serves` covers it. Propose
  the mapping.
- **Platform overlap**: if you detect both native (ios-native/
  android-native) and a flutter repo, FLAG the native-vs-Flutter
  ambiguity for Step 4 — you can't auto-resolve it.

## Step 4 — Ask ONLY what detection couldn't resolve

Use the AskUserQuestion tool. Batch all open questions into as few
rounds as possible. Typical questions (only ask the ones still open):

1. **Low-confidence detections** — "I detected the web repo as Next.js
   and the event SDK as Mixpanel. Correct?" (multi-select confirm)
2. **Native vs Flutter convention** (only if both detected) — "You have
   native iOS/Android AND Flutter. Are you (A) migrating to Flutter
   [contracts target ios/android/web, Flutter implements mobile], or
   (B) running them side by side [explicit native-ios/native-android/
   flutter tags]?"
3. **Missing backend** — "I didn't find a backend repo. Do you have
   one? Paste its GitHub id or path, or say 'none'." (Without it,
   cross-repo API tracing to handlers won't work — say so.)
4. **Missing event SDK** — only if a repo had none detected: "What
   analytics does <repo> use? (firebase / amplitude / mixpanel /
   segment / server-logs / none)"
5. **Slack channel** — "Which Slack channel should Shipline post to?
   (default: #shipline)"
6. **SLA targets** — "Use the default SLAs (Small 24h, Medium 72h)?"
   (default yes; only ask if you want confirmation)

Do NOT ask things you detected with high confidence. Do NOT ask more
than ~6 questions total. If you're unsure whether to ask, prefer a
sensible default and tell the user they can edit later.

## Step 5 — Write the complete config

Write `.shipline/repos.yml` using the resolved values — every field
filled, NO `⚠️` placeholders. Use the structure from
`examples/repos.yml.example`, including `framework`, `languages`,
`eventSdk`, `testPattern`, `apiClientPattern`, `apiDependencies`, and
for backends `routePattern` + `serves`. Apply the native-vs-Flutter
convention the user chose. Set `conventions` (scanDepth, SLA, Slack
channel).

Also create `.shipline/contracts/` if it doesn't exist.

## Step 6 — Verify MCPs and scopes

Run the **setup-check** logic: which required MCPs are connected,
which scopes are granted, what's missing and what it would block.

## Step 7 — Confirm and summarize

Show the user:
- The repos detected, with framework + SDK + test framework per repo
- The cross-repo API links inferred
- The native/Flutter convention applied
- What MCPs are connected and any gaps
- "Config written to `.shipline/repos.yml`. Commit it so teammates
  inherit it. Next: `/contract new <a small feature>`."

## Anti-patterns

- Don't write a config with placeholders. If you couldn't resolve a
  field, ask — that's the whole point of the wizard.
- Don't ask about things you detected confidently. Respect the user's
  time; detection is the default, questions are the exception.
- Don't guess frameworks from filenames alone when you can read the
  marker file to be sure.
- Don't skip the MCP/scope check — a complete repos.yml with no
  connected GitHub MCP still can't do much.
- Don't proceed to write if the user hasn't confirmed low-confidence
  detections.
