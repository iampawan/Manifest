# Shipline reliability hardening

A v0.1 prompt-only prototype has predictable weaknesses: non-deterministic
output, no eval coverage, cost, version drift. This doc tracks the plan to
make Shipline production-grade, organized around one keystone idea.

## The keystone: deterministic core + judgment layer

Every critic used to be an LLM prompt. LLM prompts are non-deterministic
by nature — you can reduce variance but never eliminate it. So we split:

- **Deterministic layer** (`scripts/validate.mjs`) — real code for
  everything mechanically checkable. Field presence, AC coverage, sizing
  arithmetic, readiness computation, output-schema validation. 100%
  reproducible, free, unit-testable.
- **Judgment layer** (LLM critics) — only genuine reasoning: missing edge
  cases, security analysis, regression conflicts, copy quality. Hardened
  with a shared protocol, schema validation, and model pinning.

This split is already implemented. The rest of this doc tracks the
remaining hardening, mapped to the issues that motivated it.

---

## Issue → fix status

### 1. Non-deterministic output / out-of-schema severities
**Status: addressed.**
- Mechanical checks moved to `scripts/validate.mjs` — deterministic.
- `reference/CRITIC-PROTOCOL.md` defines severity as a closed enum (blocker/
  warning/info). Forbidden values (high/medium/low/...) are named
  explicitly.
- `validate.mjs --check-findings` rejects any out-of-schema severity
  and exits non-zero. Verified: it catches "high" and "medium".
- **Remaining**: lower temperature on judgment critics where the
  runtime allows it; document the temp setting per critic.

### 2. No eval harness
**Status: BUILT (v0.2.0).** `eval/` has golden contracts (clean +
seeded-gaps) and 13 unit tests for the validator — all passing. The
eval CI workflow (`workflows/eval.yml`) runs them on every change and
fails the build on regression or schema violation. The harness already
caught a real parser bug (`\Z` end-anchor) during development.
Remaining: golden-contract recall tests for the LLM judgment critics
(needs real critic runs in CI).
**(original plan below for reference)**
- Build `eval/` with golden contracts and expected findings.
- For the deterministic layer: standard unit tests (`node --test`).
  These are exact-match assertions — the validator output is
  deterministic, so tests are trivially reliable.
- For the judgment layer: golden-contract eval. Run each judgment
  critic against a fixed contract, assert that expected blockers are
  found (recall) and that no forbidden severities appear (schema).
  Tolerate variance in non-critical findings; assert on the
  load-bearing ones.
- Run evals in CI on every plugin change. A drop in recall on the
  golden set fails the build.

### 3. No shared rule layer
**Status: done.**
- `reference/CRITIC-PROTOCOL.md` is the single source for severity defs, output
  schema, ID prefixes, anti-patterns, and the deterministic-vs-judgment
  boundary. Every critic references it instead of duplicating.
- **Remaining**: update each critic SKILL.md to open with the protocol
  reference and delete its duplicated severity/anti-pattern blocks.

### 4. LLM-cost-heavy (9 subagents per verify)
**Status: partially addressed.**
- Mechanical checks now run in code (zero tokens). The LLM critics do
  strictly less work.
- **Remaining**:
  - Batch related judgment critics into fewer sub-agent calls.
  - Use a cheaper model for the lighter judgment critics (naming
    quality, copy quality) and reserve the strong model for
    edge-cases / security / regression.
  - Content-hash cache: if `contractHash` is unchanged since the last
    verify, skip re-running and reuse the prior findings.

### 5. Loose versioning / no reproducibility
**Status: planned.**
- Adopt semver. Tag releases (`v0.2.0`).
- Install by tag, not main: `/plugin install shipline@shipline` pinned
  to a tag in the marketplace entry.
- Every findings file records `verifiedWith: { pluginVersion, model,
  protocolVersion, contractHash }` (already in the contract-verify
  spec). This makes any findings file reproducible-by-reference.
- **Remaining**: add a `CHANGELOG.md`; wire release tagging.

### 6. State conflict across branches
**Status: mitigated.**
- Findings are now a deterministic function of (contract content +
  plugin version + model) for the deterministic layer, and the
  `contractHash` stamps which contract content was verified.
- Two devs on different branches: compare `contractHash` — different
  hash means they verified different contract content (expected). Same
  hash + same pluginVersion + same model → identical deterministic
  findings.
- **Remaining (true central state)**: would need a shared store keyed
  on contractHash. Out of scope for the plugin; a Phase 3 service
  concern if it ever matters. The hash-stamping makes divergence
  *detectable*, which is enough for now.

### 7. Silent integration failures (missing scopes)
**Status: BUILT (v0.2.0).** Write-path skills declare `requiredScopes`
in frontmatter. `/setup` (setup-check) verifies granted scopes and maps
each gap to the command it would break. `contract-promote` refuses up
front if `github:issues:write` is missing, and reports (never silently
skips) optional steps like the JIRA epic.
Remaining: automated scope introspection where the runtime exposes it;
otherwise setup-check lists scopes for the user to verify manually.
**(original plan below for reference)**
- Skills will declare required scopes in frontmatter, e.g.
  `requiredScopes: [github:issues:write, github:contents:write]`.
- `/setup` (setup-check skill) will verify actual granted scopes, not
  just connection presence, and fail loud on a gap.
- `contract-promote` will check `github:issues:write` BEFORE the
  tracking-issue step and refuse with a clear message if missing —
  no more silent failure.
- **Remaining**: implement scope introspection in setup-check;
  add precondition checks to promote and other write-path skills.

### 8. Force-runs too permissive
**Status: BUILT (v0.2.0).** `scripts/validate.mjs` exits non-zero on parse/input
error. `verify-deployment` now has an explicit precondition step that
REFUSES on null/empty target with a distinct `{ "result": "refused" }`
— it never substitutes a misleading `hold` verdict for missing input.
**(original status below for reference)**
- `scripts/validate.mjs` exits 2 on parse/input error — callers must stop.
- **Remaining**: add explicit precondition validation to
  verify-deployment (refuse on null/empty env URL with a distinct
  "invalid input" result, never a misleading "hold" verdict). The
  protocol's anti-patterns already forbid "degrade silently on bad
  input"; enforce it with a code precondition.

### 9. Behavior changes with the model
**Status: mitigated.**
- Pin the model in judgment-critic invocations where the runtime
  allows specifying it.
- Record the model in every findings file (`verifiedWith.model`).
- The eval suite (issue #2) is the real defense: it catches drift
  when a model update changes outputs, before that reaches users.
- **Remaining**: can't control model behavior; the eval gate is the
  mitigation. Document the supported/tested model per release.

---

## Build order (recommended)

1. **Done**: deterministic validator + shared protocol + schema
   validation + wire into contract-verify.
2. **Next**: eval harness (unit tests for validator + golden-contract
   eval for judgment critics) — this is the highest-leverage remaining
   piece because it makes every future change safe.
3. **Then**: scope declarations + setup-check scope verification +
   promote precondition (kills the silent-failure class).
4. **Then**: versioning discipline (semver tags, install-by-tag,
   CHANGELOG).
5. **Then**: cost work (batching, cheaper model for light critics,
   content-hash cache).
6. **Later / maybe**: central state store, if branch divergence ever
   becomes a real pain rather than a detectable one.

## What's genuinely unsolvable (be honest)

- LLMs will never be bit-for-bit deterministic on judgment tasks. The
  fix is "move everything that CAN be deterministic into code, validate
  the rest's output, and catch drift with evals" — not "make the LLM
  deterministic."
- Model updates can shift judgment-critic behavior. We can detect it
  (evals) and pin where possible, but not prevent it entirely.
- True multi-writer state consistency needs infrastructure the plugin
  doesn't have. Hash-stamping makes divergence visible; eliminating it
  is a service-layer problem.

The honest framing for the team: the deterministic layer is as reliable
as any code you write. The judgment layer is as reliable as a careful
senior reviewer who occasionally phrases things differently — bounded by
a schema, checked by evals, and never the sole authority on whether a
contract passes (that verdict is code).
