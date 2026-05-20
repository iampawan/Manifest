# Changelog

All notable changes to Shipline. Versions follow semver. Install a
specific version by tag rather than tracking `main`, so your team gets
reproducible behavior:

```
/plugin install shipline@shipline   # pulls the tagged release in the marketplace
```

Every findings file records the `pluginVersion` that produced it (see
`CRITIC-PROTOCOL.md`), so you can always tell which version verified a
given contract.

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
