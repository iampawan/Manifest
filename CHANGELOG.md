# Changelog

All notable changes to Manifest. Versions follow semver. Install a
specific version by tag rather than tracking `main`, so your team gets
reproducible behavior:

```
/plugin install manifest@manifest   # pulls the tagged release in the marketplace
```

Every findings file records the `pluginVersion` that produced it (see
`CRITIC-PROTOCOL.md`), so you can always tell which version verified a
given contract.

## [0.8.0] — faster verify & re-verify

The deterministic validator was already <1s; the wall-clock is the LLM
critics. This release makes verify do the *smallest correct* amount of
work, especially on the edit→re-verify loop.

### Added
- **Incremental re-verify.** `validate.mjs` now hashes each behavior
  (+ its ACs) and a global context bucket (`fragmentHashes`), plus an
  `apiSurfaceHash`. The new `--changed` mode emits a re-run plan: which
  localized critics to re-run over which changed behaviors, whether the
  cross-cutting critics need re-running, and whether regression should
  `rescan` / `reason-only` / `reuse`. Verify follows the plan and reuses
  prior findings for unchanged fragments — so fixing one finding
  re-runs one critic over one behavior, not the whole suite. 9 new tests
  (78 total).
- **`--fast` verify** — `/contract verify <ID> --fast` runs only
  edge-cases + security and skips the regression scan, for a quick
  draft-loop verdict. Stamped `verifyMode: fast`; **not promotable** —
  contract-promote refuses a fast-only verify.
- **Regression scan caching.** The slowest critic now reuses its repo
  scan when the API surface + scanned repo head SHAs are unchanged
  (recorded in the findings' `regressionScan` block); it only re-fetches
  on a real surface change. Prefers the cheap `declared` scan depth
  while iterating, full depth on the final verify.
- **Model tiering** — heavy critics (edge-cases/security/regression/
  scalability) use a strong model, light ones a fast model; override via
  `conventions.criticModels`.

### Notes
- All wins are "run fewer critics over less input and reuse prior
  results" — individual LLM-critic latency is unchanged. Correctness is
  preserved: any structural change still re-runs the cross-cutting
  critics; only localized critics (comms/perf/platform/instrumentation)
  are scoped to changed behaviors.

## [0.7.0] — contextual perfBudget / commsStates gating

Process proportional to the behavior, not blanket boilerplate.

### Changed
- **`commsStates` is now required only for user-facing behaviors.**
  Server-only behaviors (platforms all `server`/`backend`) are exempt —
  no more demanding four UI states for a backend job.
- **`perfBudget` gating is configurable** via `conventions.perfBudget`
  in `repos.yml` (or `perfBudgetPolicy` per contract): `required`
  (blocker), `warn` (warning — **the new default**, so a missing budget
  no longer blocks the pipeline), or `off`. When checked, **one relevant
  numeric field is enough** (ttiMs for UI, p95LatencyMs for a network
  call) — a behavior with no network call needn't invent a p95. A `TBD`/
  non-numeric value is flagged at the policy severity.
- Renamed/rebranded the whole plugin **Shipline → Manifest** (name,
  slugs, `.manifest/` convention, `/manifest` command, repo reference).

### Notes
- The two critic skills (`perf-budget`, `comms-completeness`) now defer
  field-presence to the validator and focus on judgment (are budgets
  realistic; is error copy actionable). 6 new validator tests (69 total).
- Rationale: the blanket "all three fields on every behavior" rule
  created friction for backend behaviors and teams without perf
  telemetry, contradicting "works with whatever infrastructure you
  have." The value is kept where it's cheap (user-facing UI states) and
  made opt-in where it isn't.

## [0.6.0] — bug→fix loop closure (+ trigger fix)

### Fixed
- **Monitoring trigger never fired.** `launch-monitor.yml` matched
  contracts on `prodRolloutAt:`, but the contract format stores the
  rollout timestamp as `prodRollout100At:` — so the daily launch-report
  and bug-triage sweep silently found zero contracts. Corrected the
  field name (and the day-index computation that used it).

### Added
- **bug-triage now closes its loop.** After filing/deduping a cluster it
  routes the bug back into the pipeline: trivial/high-confidence (or any
  S0/S1) can auto-enter the `/fix` express lane; bigger ones draft a
  `/contract` stub. Guardrails: propose-by-default, auto-start only for
  high-confidence-trivial or S0/S1, ≤2 auto-starts per run, never
  auto-merge (the fix still goes through verify-pr + code-review +
  human approval). The route is seeded from the triage evidence
  (symptom, repro, suspect file + git-blame owner, contract context).
- New `bugFollowups` contract frontmatter — links the routed ticket ↔
  fix PR / new contract ↔ originating contract; an open follow-up
  tempers the `landed` verdict. The cluster is marked `routed` in the
  bug-log so the next nightly run doesn't re-route it.

### Notes
- No new credentials required: routing reuses the scopes the Implementer
  already declares (`github:contents:write` / `pull_requests:write`) and
  the tracker MCP bug-triage already uses. Without write access it
  degrades to *proposing* the route in Slack / a PR comment.

## [0.5.0] — recall harness, canary orchestrator, rollback ending

Fills the gaps a self-audit surfaced: the missing half of the
reliability story, the described-but-unbuilt canary orchestrator, and
the one place the end-to-end loop had no ending.

### Added
- **Critic recall harness** — `eval/contracts/judgment-gaps.md` is a
  structurally-complete contract (zero deterministic findings) with
  planted *judgment* defects; `eval/golden/judgment-gaps.expected.json`
  declares which critic must catch each. `scripts/recall.mjs` is a
  deterministic scorer (recall + schema check) with 7 unit tests; the
  `critic-recall` job in `eval.yml` runs the verify skill against the
  fixture and scores it (skips cleanly without LLM creds). This is the
  drift defense RELIABILITY.md #2 asked for — a recall drop fails CI.
  `contract-verify` now also emits a machine-readable `.findings.json`.
- **Canary orchestrator (recommend-and-approve)** — `rolloutPlan`
  (stages + bake `holdHours`) in `repos.yml` / contract frontmatter;
  `rollback-guard` now recommends the next ramp step on a healthy check;
  `/canary <ID>` shows the current stage + next step. The system never
  advances the flag — a human does. Fixed the GUIDE wording that
  implied an automated orchestrator existed.
- **Post-rollback / postmortem loop** — `rollback-postmortem` skill +
  `/postmortem <ID>`: records `landed: rolled-back` + `rolledBackAt`,
  writes a blameless postmortem from the contract timeline + guard
  reports + Sentry, and reopens the work as a follow-up (never closes it
  as done). The rollback ending the loop was missing.

### Changed
- **Workflow robustness.** `launch-monitor.yml` and `rollback-guard.yml`
  share a `concurrency: manifest-state-writer` group and rebase before
  push, so concurrent crons no longer race on the specs repo.
  Launch-monitor gained **missed-cron catch-up**: it produces any
  reached-but-unwritten milestone report instead of requiring an exact
  day match (a delayed/skipped scheduled run no longer drops a report).
- **code-review** gained a dependency / supply-chain check (avoidable
  new deps, unpinned ranges, typosquats, license flags, lockfile drift)
  when the diff touches a manifest/lockfile.
- New frontmatter: `currentRolloutPercent`, `rolledBackAt`, optional
  per-contract `rolloutPlan`.

## [0.4.0] — code review, the fix loop, and a rollout guard

Closes the two gaps between "the spec is good" and "the running feature
is safe": code-level review of the diff, and a watcher on the rollout.

### Added
- **`code-review` skill (PR stage)** — reviews the diff for security,
  correctness, performance, and maintainability defects, distinct from
  `verify-pr`'s AC/contract conformance. Emits `CR-` findings on the
  shared `blocker/warning/info` enum, schema-checked by
  `validate.mjs --check-review`; open blockers gate the merge. Runs in
  `pr-verify.yml` alongside verify-pr; `/code-review <PR>` to run it
  manually. GUIDE ②.
- **Review→fix loop** — `@claude /fix-pr <ID>` runs the Implementer in
  fix-mode: it reads the open `code-review` / `verify-pr` findings,
  fixes them narrowly, re-pushes, and CI re-verifies. Bounded by
  `maxFixIterations` (default 3) then escalates to a human — no churn.
- **`rollback-guard` skill + `rollback-guard.yml`** — during the rollout
  window, samples Sentry errors, crash-free rate, and release adoption
  against the contract's budgets + optional `rollbackTriggers`, and
  RECOMMENDS `proceed | hold | recommend-rollback`. It never executes a
  rollback — a `recommend-rollback` posts a top-level Slack alert to the
  owner with the breached signal and the exact action. `/rollback-check
  <ID>` to run on demand. GUIDE ③.
- New contract frontmatter: `fixIterations` / `maxFixIterations` (loop
  cap), `guardVerdict` / `guardCheckedAt`, and a `rollbackTriggers`
  block. CONTRACT-FORMAT updated.
- `validate.mjs` gains `validateReviewFindings` + `validateGuardVerdict`
  with `--check-review` / `--check-guard` CLI modes (exit codes gate CI:
  2 = open review blockers, 3 = recommend-rollback). 11 new tests (56
  total).

### Notes
- The guard deliberately recommends rather than acts — pausing a canary,
  flipping a flag, or reverting is a production change a human owns.
  This matches `verify-deployment`'s long-standing "don't auto-rollback"
  stance.

## [0.3.3] — lifecycle & retention

### Added
- **Archival/retention** — landed contracts (day-28) auto-archive to
  `.manifest/archive/<year>/<ID>/`; keeps contract + final report,
  prunes process exhaust (git history retains it). `retention: keep-all`
  to archive everything. Manual `/contract archive <ID>`. Keeps the
  active contracts folder lean as the team ships more features. GUIDE 1e.

## [0.3.2] — central state (specs-repo model)

### Added
- **Dedicated specs-repo model** for central state — one repo on one
  `main` branch is a consistent source of truth (no per-branch
  divergence); also the home for cross-repo contracts. GUIDE 1d.
- **Advisory locks** — `owner` / `lockedBy` / `lockedAt`; verify and
  implement warn if someone else holds a recent lock (advisory, git
  is the arbiter).

### Notes
- A real-time central *service* (locking + query API) remains a
  deferred v2+; the plugin is built so it would wrap the same contract
  format, not replace it.

## [0.3.1] — content-hash caching

### Added
- **Content-hash caching** — `/contract verify` skips the LLM critics
  when the contract content + plugin version are unchanged since the
  last verify (reuses prior findings). No-op re-runs (CI, habit,
  iterating on other files) now cost zero tokens. `--force` overrides.
  `validate.mjs --cache-check` powers it; 5 tests.

## [0.3.0] — right-sized process + leaner critics

Process proportional to risk, end to end.

### Added
- **Express lane** (`/fix` + `quick-fix` skill) for trivial bugs and
  tiny changes — skips the contract ceremony (no critics/SLA/launch
  report), triages first and escalates to `/contract` if the change is
  bigger than trivial. Plus a deterministic stack detector
  (`scripts/detect.mjs`, 16 tests) and the `setup-init` wizard that
  auto-generates `repos.yml` (no external code-index MCP needed).
- **Smart Large support** — `/contract decompose` turns a Large
  contract into an epic with dependency-ordered Small/Medium children;
  migrations/auth flagged `human-led`. Large is made tractable, not
  refused.
- Stack-agnostic Implementer + STACK-PROFILES toolchain reference
  (web/mobile/backend; no assumed npm/Playwright).
- **SLA countdown in every update** — `validate.mjs --sla` prints time-
  left / overdue; implement, verify-pr, verify-deploy, and promote all
  lead their updates with it (4 tests).
- **All times shown in IST + UTC** (e.g. `13:30 IST / 08:00 UTC`).
- **`/status [<ID>]`** — phase + SLA + readiness + next action for one
  contract, or a dashboard of everything in flight (overdue first).
  Deterministic via `validate.mjs --status` + `derivePhase` (6 tests).
- **Slack per-contract threading** — one top-level message per contract
  (the promote anchor); every later update threads under it via
  `slackThreadTs`. One channel, no spam. Urgent items (overdue,
  rollback, auto-pause) also post a brief top-level alert.

### Changed
- **Critic set optimized.** `critic-sizing` removed (the validator
  computes sizing deterministically — superseded record in
  `docs/superseded-critic-sizing.md`). `platform-parity`,
  `scalability`, and `perf-budget` judgment now run **conditionally**
  (only when relevant), cutting tokens and noise. Always-run core:
  edge-cases, regression, security.
- Repo docs reorganized: root has 3 files; specs in `reference/`,
  planning docs in `docs/`.

### Fixed
- Validator skips behavior checks on `type: epic` contracts.

## [0.2.0] — reliability hardening

The "make it real for teams" release. Addresses the production-grade
gaps in the v0.1 prototype.

### Added
- **Deterministic validator** (`scripts/validate.mjs`) — real code for
  all mechanical checks (field presence, AC coverage, sizing, readiness,
  output-schema validation). Reproducible, free, unit-tested.
- **Shared critic protocol** (`CRITIC-PROTOCOL.md`) — single source for
  the closed severity enum (blocker/warning/info), output schema, ID
  prefixes, and anti-patterns. All 9 critics reference it.
- **Eval harness** (`eval/`) — golden contracts + unit tests for the
  validator. 13 tests, all passing. This is the regression gate that
  makes future changes safe.
- **Scope declarations** — write-path skills declare `requiredScopes`;
  `/setup` verifies actual granted scopes; `contract-promote` refuses
  up front if `github:issues:write` is missing (no more silent
  tracking-issue failures).
- **Input preconditions** — `verify-deployment` refuses on null/empty
  target instead of emitting a misleading `hold` verdict.
- **Provenance stamping** — findings files record pluginVersion, model,
  protocolVersion, and contractHash for reproducibility.
- **CI workflow** (`workflows/eval.yml`) — runs the eval suite on every
  change; fails the build on test failure or schema violation.

### Changed
- `contract-verify` is now a two-layer orchestrator: deterministic
  validator first, then ONLY judgment critics (not all 9 as LLM calls).
  Lower cost, deterministic verdict.
- Contract format requires explicit `AC1 (B1):` behavior references so
  AC coverage is deterministically checkable.
- `verify-deployment` is platform-aware (web / Flutter / backend).
- Regression critic does cross-repo API dependency tracing.

### Fixed
- Parser used `\Z` (invalid in JS regex) as an end anchor, silently
  breaking AC→behavior parsing. Caught by the new eval harness.
- Out-of-schema severities ("high", "medium") are now rejected by the
  validator instead of leaking through.

### Known limitations (see RELIABILITY.md)
- Judgment-critic output still varies run-to-run (bounded by schema +
  protocol, but not bit-identical — inherent to LLMs).
- Content-hash caching designed, not yet implemented.
- True central state across branches not built (divergence is
  detectable via contractHash, not prevented).
- Model pinning depends on runtime support; the eval suite is the
  drift-detection mechanism.

## [0.1.0] — prototype

- Initial plugin: 9 critic skills, contract lifecycle (new/verify/
  promote), implement/verify/launch agents, GitHub Actions workflows,
  tutorial, setup-check, multi-repo config.
- All critics were LLM prompts (non-deterministic). Superseded by the
  two-layer architecture in 0.2.0.
