# Stack profiles (toolchain reference)

Manifest assumes NOTHING about your stack. Skills that build or test
code (`implement`, `verify-deployment`) read the toolchain from
`repos.yml`. If a repo declares an explicit `toolchain`, that wins. If
it only declares a `framework`, skills infer sensible defaults from the
table below. If your stack isn't listed, declare `toolchain` explicitly
and it works anyway.

This file is the single source of default commands. Change a default
here and every skill inherits it.

## How resolution works

For any repo, a skill resolves each command in this order:

1. **Explicit `toolchain.<command>` in `repos.yml`** — always wins.
2. **Inferred from `framework`** — using the defaults table below.
3. **Inferred from `languages`** — coarser fallback if no framework.
4. **If still unknown** — the skill STOPS and asks the user for the
   command rather than guessing. Never run a guessed build/test command.

## repos.yml shape

```yaml
- name: web
  framework: nextjs          # drives default toolchain
  languages: [typescript, tsx]
  eventSdk: amplitude
  # Optional explicit overrides — only specify what differs from defaults:
  toolchain:
    test: "npm run test:ci"        # override just this one
    # install / lint / build / testE2E inherited from the nextjs profile
```

## Default toolchains by framework

### Web

| framework | install | test | testE2E | lint | typecheck | build | eventSdk default |
|---|---|---|---|---|---|---|---|
| `nextjs` | `npm ci` | `npm test` | `npx playwright test` | `npm run lint` | `tsc --noEmit` | `npm run build` | amplitude |
| `react` (Vite) | `npm ci` | `npm test` | `npx playwright test` | `npm run lint` | `tsc --noEmit` | `npm run build` | amplitude |
| `react` (CRA) | `npm ci` | `npm test -- --watchAll=false` | `npx cypress run` | `npm run lint` | `tsc --noEmit` | `npm run build` | amplitude |
| `vue` | `npm ci` | `npm run test:unit` | `npx playwright test` | `npm run lint` | `vue-tsc --noEmit` | `npm run build` | amplitude |
| `angular` | `npm ci` | `ng test --watch=false` | `npx playwright test` | `ng lint` | `tsc --noEmit` | `ng build` | amplitude |
| `svelte` | `npm ci` | `npm test` | `npx playwright test` | `npm run lint` | `svelte-check` | `npm run build` | amplitude |

### Mobile

| framework | install | test | testE2E | lint | build | eventSdk default |
|---|---|---|---|---|---|---|
| `flutter` | `flutter pub get` | `flutter test` | `flutter test integration_test/` | `flutter analyze` | `flutter build apk --release` / `flutter build ios --release` | firebase |
| `ios-native` (Swift) | `xcodebuild -resolvePackageDependencies` | `xcodebuild test -scheme <S>` | `xcodebuild test -scheme <S>UITests` | `swiftlint` | `xcodebuild -scheme <S> build` | firebase |
| `android-native` (Kotlin) | `./gradlew dependencies` | `./gradlew test` | `./gradlew connectedAndroidTest` | `./gradlew lint` (or ktlint/detekt) | `./gradlew assembleRelease` | firebase |
| `react-native` | `npm ci && npx pod-install` | `npm test` | `npx detox test` | `npm run lint` | `npx react-native run-android/ios` | amplitude |

For native iOS/Android, the scheme/module name comes from the repo's
`srcDir` or an explicit `toolchain.scheme` / `toolchain.module`.

### Backend

| framework / language | install | test | lint | build | eventSdk default |
|---|---|---|---|---|---|
| `express` / `nestjs` / `fastify` (Node) | `npm ci` | `npm test` | `npm run lint` | `npm run build` | amplitude-node |
| `fastapi` / `flask` / `django` (Python) | `pip install -r requirements.txt` | `pytest` | `ruff check` | `—` | server-side firebase / custom |
| `gin` / `echo` / stdlib (Go) | `go mod download` | `go test ./...` | `golangci-lint run` | `go build ./...` | custom |
| `rails` (Ruby) | `bundle install` | `bundle exec rspec` | `rubocop` | `—` | custom |
| `spring` (Java/Kotlin) | `./gradlew dependencies` | `./gradlew test` | `./gradlew checkstyleMain` | `./gradlew build` | custom |

## Test framework + file conventions per stack

The Implementer writes tests in the idiom of the target repo. The
test it generates per acceptance criterion depends on the stack:

| Stack | Test framework | Test file location | Tag convention |
|---|---|---|---|
| Next/React | Playwright or Cypress | `e2e/` or `cypress/e2e/` | `@contract:<ID> @ac:<ACn>` in test name |
| Vue/Angular/Svelte | Playwright | `e2e/` | same |
| Flutter | `integration_test` / Patrol | `integration_test/` | contract id in test name |
| iOS native | XCTest / XCUITest | `<App>UITests/` | contract id in test method name |
| Android native | Espresso / JUnit | `androidTest/` | contract id in test method name |
| Node backend | Jest / Vitest | `tests/` or `__tests__/` | `@contract:<ID>` in describe block |
| Python backend | pytest | `tests/` | `test_contract_<ID>_<ACn>` |
| Go backend | `testing` | `*_test.go` | `TestContract<ID>_<ACn>` |

## Instrumentation SDK call patterns per stack

The instrumentation critic and the Implementer use these to find/emit
analytics events:

| eventSdk | emit call | grep pattern (for collision check) |
|---|---|---|
| amplitude (web) | `track('<event>', {...})` | `track\(['"]<event>` |
| amplitude-node | `amplitude.logEvent({event_type:'<event>'})` | `logEvent.*<event>` |
| firebase (Flutter) | `FirebaseAnalytics.instance.logEvent(name:'<event>')` | `logEvent.*name:.*<event>` |
| firebase (iOS) | `Analytics.logEvent("<event>", parameters:)` | `logEvent\(["']<event>` |
| firebase (Android) | `firebaseAnalytics.logEvent("<event>", bundle)` | `logEvent\(["']<event>` |
| mixpanel (web) | `mixpanel.track('<event>')` | `mixpanel.track\(['"]<event>` |
| segment | `analytics.track('<event>')` | `analytics.track\(['"]<event>` |
| custom / server-log | per the repo's logging convention | declared in repos.yml |

## The hard rule

A skill must NEVER run a build or test command it inferred with low
confidence. If `framework` is unset and `languages` doesn't map to a
known profile, the skill stops and asks: "What's the test command for
this repo?" — and suggests adding it to `repos.yml` so it's not asked
again. Guessing a wrong command wastes a CI run and erodes trust.
