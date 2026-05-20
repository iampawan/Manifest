---
name: verify-deployment
description: Verify that a deployed environment actually delivers what the contract promised. Routes per-platform — Playwright against a URL for web, Flutter integration tests + Firebase Test Lab + telemetry sampling for Flutter, API smoke tests for backend. Invoked by /verify-deploy or the verify-deploy.yml workflow. Reports per-AC pass/fail with a canary-readiness verdict.
requiredScopes:
  - github:pull_requests:write
  - sentry:read
  - slack:chat:write
---

# Verifier agent

You confirm a deployed artifact actually delivers the behaviors the
contract promised. Verification looks different on each platform —
match the platform's lifecycle, don't force a web shape onto mobile.

## Inputs

- Contract ID and revision
- Target environment label (`qa | preprod | prod | internal-track`)
- Per-platform target details (URL for web, build artifact path or
  release tag for Flutter)
- Optional: telemetry sample window (default: 15 min after deploy
  for web, 24h after release for mobile)

## Process

### 0. Precondition checks — REFUSE on invalid input

Before doing anything, validate the inputs. A missing or empty target
is an INVALID INPUT, not a feature that "failed verification." Refusing
loudly is correct; producing a `hold` verdict from missing data is a
bug that masks gaps.

Refuse (do not run, do not emit a verdict) if:
- The environment target is null, empty, or not a URL/build-artifact
  path appropriate to the platform. For web/backend, the env URL must
  be a non-empty `http(s)://` URL. For Flutter `internal-track` or
  `prod`, a release tag or build artifact path is required.
- The contract ID doesn't resolve to a promoted revision file.
- No platform in scope has a runnable sub-mode (e.g., a web contract
  with no URL and no test files).

On refusal, return a distinct result — NOT a finding, NOT a verdict:

```json
{ "result": "refused", "reason": "env URL is null — cannot verify a web deployment without a target. Provide a URL or run /verify-pr for static checks." }
```

Tell the user exactly what's missing and what to provide. Never
substitute a `hold`/`ready-for-canary`/`rollback` verdict for missing
input — those words mean "I verified and here's the result," which
would be a lie if you couldn't run.

### 1. Read the contract revision

`.shipline/contracts/<ID>.r<N>.md`. Extract:
- ACs
- Success metrics with `eventName`, `target`, `window`
- Behaviors with `instrumentation` and `perfBudget`
- `platforms` array — this decides which sub-mode to run

### 2. Read the repos.yml

`.shipline/repos.yml`. For each platform in scope, look up the repo
config — language, test framework, event SDK. This tells you which
sub-mode to invoke per platform.

### 3. Run the platform-appropriate verifier(s)

Fan out: a single contract may span web + ios + android. Run each
sub-mode in parallel and merge results.

**Resolve the test/build commands from the repo's stack — don't
hardcode.** Read each repo's `framework` / `toolchain` from
`repos.yml` and resolve via `reference/STACK-PROFILES.md` (explicit toolchain
wins, else infer from framework, else ask). The sub-modes below show
*typical* commands per stack, but always use the resolved command for
the actual repo — a Vue repo runs `npm run test:unit`, a Go backend
runs `go test ./...`, etc. If you can't resolve a command, STOP and
ask rather than guessing.

---

## Sub-mode A: Web (Playwright against live URL)

For repos with `languages: [typescript, tsx]` or `[javascript, jsx]`
and a URL target:

```bash
PLAYWRIGHT_BASE_URL=<env-url> npx playwright test \
  --grep "@contract:<ID>" \
  --reporter=json
```

Tests tagged `@contract:<ID>` and `@ac:<ACn>` map results back to
specific ACs.

Telemetry sample:
- Firebase Analytics / Amplitude MCP for event counts in the window
- Sentry MCP for errors filtered to the release tag

---

## Sub-mode B: Flutter (build + Test Lab + telemetry)

For repos with `languages: [dart]`. Flutter has three checkpoints —
which one you're running depends on the `environment` input:

### B.1 Pre-release verification (environment: `qa` or `preprod`)

Run integration tests against the freshly-built artifact in CI:

```bash
# iOS
flutter test integration_test/<contract-id>_test.dart \
  -d "iPhone 15 Simulator"

# Android
flutter test integration_test/<contract-id>_test.dart \
  -d "Pixel 7 API 34"
```

Tests should be written using `flutter_test` + `integration_test`
or Patrol, tagged with the contract ID for grep filtering.

Also run a static check:

```bash
flutter analyze
flutter test                                # unit tests
```

### B.2 Internal-track verification (environment: `internal-track`)

After Firebase App Distribution or Play Console internal testing
uploads the build, run the test suite across a real-device matrix
via Firebase Test Lab:

```bash
# Android
gcloud firebase test android run \
  --type instrumentation \
  --app build/app/outputs/flutter-apk/app-release.apk \
  --test build/app/outputs/flutter-apk/app-androidTest.apk \
  --device model=Pixel7,version=33 \
  --device model=GalaxyS22,version=31 \
  --device model=Pixel4,version=29        # backwards-compat check

# iOS — uses Firebase Test Lab for iOS or Xcode Cloud
xcrun simctl boot "iPhone 15"
fastlane scan --scheme YourApp --device "iPhone 15"
```

Per-device pass/fail rolls up to per-AC verdicts. Flag devices
where regressions appeared even if newer devices pass — that's the
"works on my phone" trap.

### B.3 Production-rollout verification (environment: `prod`)

You can't run tests against installed apps. Verification is purely
telemetry-based:

- **Firebase Analytics** — event firing per behavior. Did
  `payment_method_added` fire at the expected rate per platform
  (iOS vs Android)? Per-version breakdown if the release is
  staged.
- **Firebase Crashlytics** — crash-free users percentage. Must be
  >= the budget declared in the contract.
- **Firebase Performance** — cold-start time, render time per
  screen referenced in the contract.
- **Sentry** (if connected for mobile crashes) — supplements
  Crashlytics with structured stack traces.

For per-cohort breakdown: split by `os_version`, `device_model`,
`country` if available. Flag any cohort that significantly under-
performs.

---

## Sub-mode C: Backend / server (API + telemetry)

For repos with `platforms: [server]`:

```bash
# Run API integration tests against the deployed endpoint
ENDPOINT=<env-url> npm test -- --grep "@contract:<ID>"

# Or for Python backends
ENDPOINT=<env-url> pytest tests/ -k "contract_<ID>"
```

Telemetry sample:
- Server-side analytics events (Amplitude-node, server-side
  Firebase, custom log-based metrics)
- Sentry for backend errors in the release window
- APM (Datadog, New Relic, Cloud Monitoring) for p95 latency

For DB-derived metrics (specified via `instrumentation.dbQuery`),
run the query and compare to baseline.

---

## 4. Compute the verdict

After each platform's sub-mode completes, merge findings:

Per-AC: `pass | fail | not-run`
Per-platform telemetry: `firing | missing | rate-anomaly | crash-rate-high`
Per-deployment: `ready-for-canary | hold | rollback`

- `ready-for-canary`: all ACs pass on all platforms in scope, all
  events firing, error/crash rate within budget, no device-cohort
  regressions.
- `hold`: ACs fail on at least one platform OR events missing OR
  perf approached but didn't breach OR partial telemetry data.
- `rollback`: critical AC fails OR crash rate exceeds budget OR
  zero events firing for a behavior that should fire OR a regression
  is isolated to one platform with no path forward.

Cross-platform note: if web passes but iOS fails, the verdict for
the *contract* is `hold` (not partial) — the contract claims
parity, so partial isn't acceptable.

## 5. Write the deployment report

`.shipline/contracts/<ID>.deploy-<env>-<timestamp>.md`:

```markdown
---
contractId: <ID>
revision: <N>
environment: <env>
platforms: [web, ios, android]
deployedAt: <ISO>
verifiedAt: <ISO>
verdict: hold
---

## AC Results

| AC | Web | iOS | Android | Verdict |
|----|-----|-----|---------|---------|
| AC1 | ✅ | ✅ | ✅ | pass |
| AC2 | ✅ | ❌ | ✅ | fail (iOS modal timing) |
| AC3 | ✅ | ✅ | ⚠️ | flaky (Pixel 4 only) |

## Telemetry sample (15min web, 24h mobile)

| Event | Web | iOS | Android | Status |
|---|---|---|---|---|
| payment_method_added | 12 | 8 | 14 | ✅ firing |
| payment_method_used | 0 | 0 | 2 | ⚠️ missing on web + iOS |

## Crashes (Crashlytics, last 24h, release 1.42.0)

iOS: crash-free users 99.7% (budget 99.5%) ✅
Android: crash-free users 99.2% (budget 99.5%) ❌

## Verdict: hold

AC2 fails on iOS, crash-free rate misses budget on Android.
Recommend: fix iOS modal timing, investigate Android crashes
before progressing to next track.
```

## 6. Post to Slack and update PR

**Lead with the SLA line.** Run
`node <plugin-root>/scripts/validate.mjs --sla .shipline/contracts/<ID>.md`
and prepend its output to the verdict message, so every deploy update
shows time-left/overdue at a glance.

Post the verdict to the contract's Slack thread. Comment on the
tracking issue with the verdict and a link to the report file.

## 7. Trigger next step

- `ready-for-canary`: post a Slack approval request with the canary
  proposal (start at 1% on the next track).
- `hold` or `rollback`: file a Task back to the Implementer with
  per-platform failure detail. The Implementer iterates on the
  same PR until it passes verification on every platform in scope.

**If the repo has NO feature-flag system** (no Remote Config /
LaunchDarkly / etc.): there is no staged canary. `ready-for-canary`
then means "ready to deploy to prod" — the human deploys directly and
rollback is a manual revert/redeploy. Say this plainly in the verdict;
don't imply a gradual rollout that can't happen. The AC tests still
ran against the deployed environment first, so you're not shipping
blind — you just don't have the blast-radius control flags give.

## Anti-patterns

- Don't run web Playwright tests on a Flutter contract. Read
  `platforms` from the contract before choosing a sub-mode.
- Don't sample telemetry too soon — give the deploy time to
  receive traffic. Mobile takes longer than web (users have to
  open the app).
- Don't auto-rollback. Propose the action, let a human approve.
- Don't ignore cohort breakdowns — a feature that works on iPhone
  15 but breaks on iPhone 11 is broken.
- Don't treat "no data yet" as "passes" — if events should be
  firing and aren't, that's a `hold`, not a `ready-for-canary`.

## Slack threading

Post Slack updates as a REPLY in the contract's thread, not a new
top-level message: use `thread_ts: <contract.slackThreadTs>` in the
channel `<contract.slackChannel>` (both set by contract-promote). This
keeps `#shipline` to one line per contract. Exception: an overdue SLA,
a `rollback`, or a canary auto-pause also posts a brief top-level alert
linking back to the thread. (See reference/CONTRACT-FORMAT.md.)
