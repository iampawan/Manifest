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

## [0.20.0] — Ready Check: a PM-side readiness gate before dev grooming

"Airport security for PRDs." A first, cheap gate the PM clears *before*
engineering estimates — so dev stops chasing PMs for basics and stops
eating the delay when a half-baked PRD moves mid-sprint.

- **New `/ready-check <source>` (alias `/ready`).** Give any source — a JIRA
  / Notion / Doc / Slack / Figma URL, pasted text, an image, or a plain
  description — and Ready Check scores it against the Definition of Ready
  (11 required items), surfaces the blockers a PM can fix themselves in plain
  language, and (when ready) mints a gate code + a clean hand-off for dev.
  Runs identically in Claude Code and Cowork.
- **Deterministic engine `scripts/ready-check.mjs`.** Presence + specificity
  scoring, a tamper-evident gate code (djb2 over the normalized answers), and
  hand-off render/parse. Mirrors `validate.mjs`: deterministic layer, with the
  skill's judgement layer on top.
- **"No code, no grooming" enforcement.** The gate code is content-bound, so
  `ready-check.mjs --verify <handoff>` returns `VALID | STALE | INVALID`.
  `contract-promote` records `readyCheck:` and refuses a contract without a
  valid one.
- **Offline web page (`gate/prd-readiness-gate.html`)** for PMs with no Claude
  open — same rubric, same gate-code algorithm, so a web-minted code verifies
  dev-side. Cross-port parity is pinned by `eval/ready-check.test.mjs`.
- **Code-aware, no repo access.** When `.manifest/.cache/code-context.json`
  exists, Ready Check adds non-blocking notes (event-naming drift, extra
  surfaces a flow touches) from the published digest — no source credentials.
- Rubric: `reference/READY-CHECK-RUBRIC.md`. Level 2 (deep, code-grounded) is
  still `/contract pickup`, dev-side, after the gate is green.

## [0.19.0] — self-tuning models: smart routing, advisor escalation, cost observability, and a learning loop

The system now chooses the right model for each task itself, escalates the
hard calls to a stronger model, measures its own token cost, guards its own
determinism, and learns from each incident — without anyone having to pick a
model. The consistent rule: everything non-deterministic (model-choice
variance, the advisor, token cost) is kept strictly out of the verdict path,
so the "verdict is computed, not judged" property is unchanged.

### Added

- **Smart per-critic model routing (`computeModelPlan`).** The validator now
  emits a `modelPlan` that assigns each critic a model deterministically from
  the contract's `sizing` — light critics on a fast model, heavy critics
  (regression/security/scalability) on a strong model **only** when the
  contract is large/risky (8+ behaviors, 3+ platforms, or an auth/billing/
  migration flag). A trivial fix verifies cheap; an auth-flow change across
  three platforms automatically pulls the strong model onto the heavy critics.
  Nobody picks a model. Override per-critic with `conventions.criticModels` in
  `repos.yml`. Routing is pure code over an already-deterministic input, so it's
  reproducible — not an LLM classifier.

- **`/advisor` escalation.** The Implementer (the token-heaviest step) can pair
  a mid-tier main model with a strong advisor it consults at decision points —
  before committing to a plan, before declaring done, when a fix loop is stuck.
  Opt-in via the `MANIFEST_ADVISOR_MODEL` / `MANIFEST_IMPLEMENTER_MODEL` repo
  variables in `pr-verify.yml` (Anthropic-API only; unset = unchanged). Critics
  may also consult the advisor on borderline **`warning`/`info`** calls only,
  opt-in via `conventions.criticAdvisor` — never blockers (enforced; see below).

- **Cost / token observability (`/manifest cost`).** A deterministic rollup
  (`validate.mjs --cost`) prices recorded token `usage` from
  `reference/model-pricing.json` and reports spend by complexity, model tier,
  and critic, across both verify critics (`findings.json`) and the Implementer
  (`<ID>.implement.json`). This closes the loop on routing — you can measure
  whether tiering and the advisor actually saved money. Usage is observability
  only: never a gate or provenance input.

- **Finding-stability / variance tracker (`recall.mjs --stability`).** Scores N
  repeated runs of a fixture — per-gap hit rate, run-to-run stdev of required
  recall, and a flaky-gap list — failing if a required gap drops below
  `stabilityThreshold`. Guards the judgment layer against drift introduced by
  per-tier model routing. Opt-in `eval.yml` sweep gated on
  `MANIFEST_STABILITY_RUNS` (off by default — it multiplies LLM cost by N).

- **Postmortem → bug-pattern learning loop.** When `/postmortem` finds a
  diff-detectable bug class, it proposes a candidate in
  `reference/bug-patterns.candidates.md` (staging — unenforced). A maintainer
  promotes accepted patterns into `BUG-PATTERNS.md`, where `code-review`
  enforces them on every future diff, so the same class of bug can't ship
  twice. Safety: human-accept gate + `warning`-until-proven default. A
  deterministic catalog validator (`--check-patterns`, `--next-pattern-id`)
  guards structure (well-formed entries, unique + monotonic ids) and runs in CI.

- **Context-compaction resilience for long Implementer runs.** Multi-hour runs
  overflow the context window and the runtime auto-summarizes lossily. The
  Implementer now externalizes its working state to
  `<ID>.implement-state.json` (AC status, files touched, decisions),
  checkpoints after every behavior, and re-reads spec/plan/state files as
  ground truth instead of trusting summarized memory.
  `validate.mjs --implement-status <ID>` recovers what's done and what's left in
  ~100 tokens after a summarization and makes runs resumable. Schema + status
  unit-tested.

- **Compact critic rule digest (`CRITIC-RULES.md`) — cuts input tokens ×N.**
  The ~9 critics fanned out per verify each re-read the full `CRITIC-PROTOCOL.md`
  (≈290 lines) every run. They now load a compact digest (~70 lines) with only
  what's needed to emit valid output — schema, severity enum, ID prefixes,
  determinism caps, anti-patterns, framing, the advisor constraint. The full
  protocol stays the source of truth for orchestrator/maintainer concerns
  (provenance, cost, model pinning); a test enforces the digest can't drift from
  the validator's enum/prefixes/caps. The orchestrator also passes critics the
  spec content, not the machine provenance/sidecars.

### Changed

- **Findings provenance schema → v2 (`protocolVersion` 1 → 2).** `verifiedWith`
  now records a per-tier `models` map + `complexity` instead of a single
  `model` scalar, because critics run on different models. Documented in
  `CRITIC-PROTOCOL.md`. **Compatibility:** this bump invalidates v1 verify
  caches by design — a findings file written under the old schema can't say
  which model produced each finding, so the next verify re-runs. No action
  needed; it self-corrects on first re-verify.

- **The promotability gate stays deterministic even with the advisor.**
  `validateFindings` now **rejects** any advisor-influenced finding
  (`metadata.advisorConsulted: true`) that is a `blocker`. Advisor escalation is
  structurally confined to the advisory layer, so the gate (zero open blockers)
  is never influenced by a non-deterministic call. Enforced in code and gated by
  `--check-findings` in CI, not just documented.

### Notes

- Token `usage` blocks populate only when the runtime exposes per-subagent token
  counts; when unavailable the block is omitted and everything else is
  unaffected.
- Design rationale for the whole release is in
  `docs/proposals/model-tiering-and-advisor.md` and
  `docs/proposals/next-features-roadmap.md`.

## [0.18.2] — code quality hardening + dashboard-style PRs + plain-English comments

Driven by Cursor BugBot findings on the first Manifest-shipped PRs.
Three categories of bug were slipping past `code-review` and getting
caught in PR review instead. This patch closes them at three layers
(spec, implementer, critic) and reshapes the PR body so reviewers
read a single dashboard, not scattered comments.

### Changed

- **`critic-edge-cases`: new state-machine consistency check.** Catches
  contracts that contradict themselves about the same state transition
  (e.g. "only tap/Esc/blur ends the session" alongside "errors stop the
  session"). For every named transition the contract mentions, the
  critic now enumerates every statement about it and flags
  disagreements as blockers when the spec is genuinely undecidable.
  The "rapid double-action" finding also escalates from warning to
  blocker when no concrete guard (AC / outOfScope) is named — race
  conditions on rapid clicks were the second Cursor-flagged pattern.

- **`code-review`: three new high-recurrence patterns added to the
  checklist.** Each catches a real Cursor-flagged class:
  - Empty catch followed by state mutation / analytics / side effects
    that assume the try block succeeded → blocker.
  - `useState` flag used as a race guard (handler reads stale state
    across rapid double-clicks) → warning with `useRef` / `disabled`
    fix suggestion.
  - No-op error handling (caught and not re-thrown, logged, or
    surfaced) → warning, blocker when hiding user-visible failure.

- **`code-review`: findings now require plain-English fields.** Output
  schema gains `plainTitle`, `whatHappens`, `whyItMatters`, `theFix`,
  `codeSnippet` alongside the legacy `message`/`suggestion`. Findings
  render in the four-part style from `reference/PR-COMMENT-STYLE.md`
  — a busy reviewer (or a PM, or a junior dev) can act on a finding
  in 10 seconds. No more "useState flag used as concurrency guard"
  as the lead.

- **`implement`: pre-write reconnaissance is mandatory.** Before
  creating any file or symbol, the implementer must (a) grep for
  existing matches in the target repo, (b) read 1–3 sibling files in
  the target folder to learn conventions, (c) consult
  `.manifest/.cache/code-context.json` for existing events / i18n /
  flags / shared modules / similar past contracts. The recon findings
  go into the PR body so the reviewer can see what was checked. This
  is the single change that prevents duplicate-utility and
  convention-mismatch bugs.

- **`implement`: mandatory pre-push self-review pass.** The
  implementer now runs the `code-review` critic on its own diff
  *before* the first push. Max 2 fix iterations to clear blockers
  in-place; if anything remains, push with a self-review comment
  naming the open issues. Catches the empty-catch / race / no-op-error
  class before CI does. The implementer's own self-review summary
  becomes a section in the PR body so the reviewer can see what was
  caught and fixed.

- **`implement`: PR body becomes a dashboard.** New required template
  with sections: "What this PR does" (plain English), Contract +
  SLA + acceptance criteria count, **Mermaid diagram of the
  change**, Files changed (one-liner per file), AC coverage map,
  "What I read before writing code" (recon report), Self-review
  summary, How to test locally, Risk callouts. A reviewer with 30
  seconds knows what / why / what to look at; a reviewer with 5
  minutes can merge confidently without opening other tabs.

- **`reference/BUG-PATTERNS.md` — new living catalog of bug shapes.**
  Every external reviewer finding (Cursor BugBot, human reviewer,
  postmortem) that wasn't already caught is permanently added as a
  `BP-NNN` entry. The implementer reads the catalog before writing
  (pre-empts every pattern); the `code-review` critic checks the
  catalog on every diff. The catalog is one-way ratchet — patterns
  never get caught twice. Seeded with three entries from recent
  Cursor findings (empty-catch + side-effects, useState-as-race-
  guard, no-op error handling) plus two adjacent (analytics-before-
  success, state-after-unmount) and one common React (missing
  effect deps).

- **`reference/RECOMMENDED-LINT-RULES.md` — copy-paste lint configs
  per stack.** Most of BUG-PATTERNS is mechanically catchable by the
  right linter rules at the right severity. Document gives the
  exact ESLint / Dart analyzer / golangci-lint / ruff blocks plus
  TypeScript / mypy strictness flags. Repos that adopt all four
  sections typically see Cursor findings drop by ~70% within a few
  PRs — the catalog patterns get rejected at editor save time.

- **Self-review must re-scan the FULL catalog on every iteration.**
  This is the structural fix to the "Cursor finds new things each
  round" problem. Fixing one finding often introduces (or reveals)
  another. The implementer's pre-push loop now runs `code-review`
  with the entire BUG-PATTERNS catalog on each iteration — not just
  the previous round's class. Convergence: by iteration 2, every
  pattern has been scanned; round 3 catches only genuinely-new
  issues, not the next-shape-in-line.

- **Self-review is tunable, default on.** New `repos.yml` keys:
  - `selfReview: on | off | auto` — `auto` runs only when the diff
    has ≥ `selfReviewMinChangedLines` changed lines (default 0;
    set higher to skip on small diffs).
  - `selfReviewMaxIterations: 2` — cap on fix rounds before pushing
    with a self-review comment that names the unresolved issues.
  Cost note (in the example config + this release's docs): self-
  review adds ~30s – 3min per implementation run and ~1.5–2× the
  agent compute (`code-review` runs once pre-push and once in CI).
  Net wall-clock is a win when external reviewers would otherwise
  catch ≥1 thing per PR; a small overhead on PRs that would have
  been clean anyway. Tunable so teams can dial up the threshold or
  turn off if the overhead doesn't pay off for their diff sizes.

- **`reference/PR-COMMENT-STYLE.md` — new shared style guide.** Every
  PR comment (critic finding, verify-pr coverage, implementer
  self-review, fix-pr explanation, bug-triage update) follows the
  same four-part structure: plain-English title with emoji · what
  happens · why it matters · the fix with code snippet · file:line.
  Length budgets enforce concision (blocker ≤ 150 words; warning
  ≤ 80; info ≤ 1 line).

- **`workflows/pr-verify.yml`: optional stack-native static checks.**
  Added a commented-out block with the canonical lint / typecheck /
  test commands per stack (Node / Flutter / Go). Repos whose own CI
  already runs these can leave it off; repos relying on Manifest can
  uncomment the block for their stack and get strict pre-AI checks
  on every PR push.

### Why these are 0.18.2, not 0.18.1
0.18.1 fixed the *pickup* skill (the Spec entry). 0.18.2 fixes the
*implementer + reviewer* skills (the Build phase). Different code
paths, different bugs, different commit. The motivating Cursor
findings on UWS-502 voice-dictation PRs all landed in the implementer's
output and should never have reached the reviewer's queue in their
original form.

### Migration
None. All changes are additive (new critic patterns, new schema
fields, new SKILL.md sections, a new reference doc). Existing
contracts and PRs keep working. Repos relying on the pre-0.18.2
PR-body template will see a richer body on the next implementer
run — no config flip needed.

## [0.18.1] — pickup skill hardening from first real-run feedback

First end-to-end test of `/contract pickup` surfaced three real
gaps. All closed in this patch — no API changes, no new dependencies,
no migration. Existing 0.18.0 contracts and config keep working.

### Changed
- **Phase 2 now runs the full critic set inline, unambiguously.** The
  0.18.0 skill prose left room for the agent to draft the contract,
  run only `critic-code-context`, and then suggest `/contract verify`
  as a follow-up — which happened in the first real run. The skill is
  now explicit: pickup IS the verify. In Phase 2 the agent runs the
  validator + all the standard judgment critics selected per content
  (edge-cases / regression / security / instrumentation /
  comms-completeness / platform-parity / scalability / perf-budget)
  + `critic-code-context` in one parallel batch, and writes
  `.findings.{md,json}` exactly as `contract-verify` would. New
  anti-patterns explicitly forbid suggesting `/contract verify` as a
  next step and producing a card with only Bucket A.

- **Phase 1.0 preflight — no more silent degradation without
  `repos.yml`.** 0.18.0 ran pickup happily without
  `.manifest/repos.yml` and reassured the dev "fine here — automation
  is inert." That hid a real loss: cross-repo regression scan, cached
  auto-fill, PM-channel routing, and the answer-watcher all need
  `repos.yml`. The skill now gates Phase 1 on the file. If missing,
  the agent stops, lists the four affected features explicitly, and
  offers to run `/manifest setup` (~30 seconds) or proceed with
  `pickup.degradedMode: true` recorded in the contract frontmatter so
  the rest of the pipeline knows. Same gate when a critical MCP isn't
  connected for the pasted source. Anti-pattern added: don't say
  "fine here" — surface the loss, let the dev decide.

- **Card output reframed for someone reading their first pickup.**
  0.18.0 led with the contract ID (`SC-001`), bucket letters, and
  file paths as table columns — fine for someone who already knew the
  codebase, opaque otherwise. New rules: feature title in plain
  English leads (contract ID drops to a small metadata row); bucket
  headlines in plain English ("Agent filled in 4 from your code"
  instead of "Bucket A — auto-filled from code"); every technical
  reference gets a plain-English line above it; file paths drop to
  `↳ refs:` footnotes; jargon gets a parenthesized gloss the first
  time it appears; question IDs (`Q-N`) stay in frontmatter and never
  surface in the human card.

### Why these are 0.18.1, not 0.18.0
0.18.0 shipped the design + scaffolding. 0.18.1 closes the gaps the
first real run exposed. The skill prose was the difference between
"works on paper" and "behaves the way the docs claim" — that's a
behavioral change worth a version bump even though no `.json` schema
or workflow file changed.

## [0.18.0] — dev-centric pickup flow (opt-in)

A new mental model for the most common real-world case: the PM
writes a PRD elsewhere (JIRA / Google Doc / Slack / Notion / paste /
screenshot) and walks away, and the dev has to make it build-ready
on their own — using code, history, and dependency context the PM
doesn't have. Manifest does the code archaeology *for* the dev and
surfaces only the decisions that need a human.

The PM stays in their normal tool. They never have to touch
Manifest — questions go out as one batched JIRA comment / Slack DM
in the dev's voice; answers materialize as AC edits with provenance
comments.

This release ships the design + scaffolding for the flow. It's
opt-in per repo via `pickup.enabled: true` in `repos.yml`; without
the flag, `/contract pickup` falls back to `/contract new` with a
notice. Existing flows (`/contract new`, verify, promote, implement,
canary, launch) are unchanged.

### Added
- **`/contract pickup <source>`** — new subcommand for the
  dev-centric flow. Source can be any URL (JIRA, Google Doc,
  Linear, Notion, Confluence, Slack message link, GitHub issue,
  Figma), pasted text, or a dropped image. Fetches via the right
  MCP, follows linked docs one level deep, pulls related history
  (past contracts, postmortems, recent Sentry, active concurrent
  work). See [skills/contract-pickup/SKILL.md](skills/contract-pickup/SKILL.md).
- **Three-bucket gap sorter.** Every gap in the PRD lands in
  exactly one of: **A. agent fills from code/history** (one-tap
  accept), **B. dev decides** (engineering judgment), **C. only PM
  can answer** (drafted as a PM-facing question). Dev burns through
  A in seconds, walks B with judgment, sends batched C questions
  to the PM.
- **`critic-code-context`** — new dev-side critic that produces the
  Bucket A auto-fill proposals (perfBudget from stack defaults,
  event names from the existing catalog, copy from i18n keys, AC
  patterns from similar landed contracts) and Bucket B dev-decides
  items (rolled-back history, dependency budgets, shared modules,
  locale/device branches the codebase already handles). See
  [skills/critic-code-context/SKILL.md](skills/critic-code-context/SKILL.md).
- **PM-channel question posting.** Drafted questions go to the PM
  via the channel the source came from (JIRA comment, Slack
  reply-in-thread, Notion comment, Google Doc suggestion) in the
  dev's voice. Optional `— <dev> (via Manifest)` footer for audit
  (`pickup.identifyAgent` in `repos.yml`).
- **Answer watcher.** Polls the PM channel for replies; on
  detection, parses the answer, applies it as an AC edit with a
  provenance comment (`<!-- From: Q-N · <PM> · <date> -->`), moves
  the question to the sidecar `<ID>.qa.md` log, and re-verifies
  incrementally. Implementation on non-blocking behaviors can run
  in parallel.
- **`ROADMAP.md`** at the repo root — captures the broader vision
  (development / customer support / operations agents) and the
  impact-ordered immediate priority list this release is one piece
  of.

### Configuration
New `pickup` block in `repos.yml`:

```yaml
pickup:
  enabled: true            # opt in
  identifyAgent: true      # "(via Manifest)" footer on PM-facing posts
  defaultChannel: jira     # or: slack | notion | gdoc
  blockingByDefault: false # questions are non-blocking unless dev flags
  cacheTTL: 24h            # codebase analysis cache lifetime
```

### Cache builder + answer watcher (closed mid-cycle)
What started as deferred made it into this release:
- **`scripts/build-code-context.mjs`** — idempotent, atomically-writing
  cache builder. Scans target repos for event catalog, i18n keys, flags,
  shared modules; indexes past contracts by surface area; flags
  rolled-back / partial history. Output goes to
  `.manifest/.cache/code-context.json`. Sub-second lookups after the
  first build. Runnable locally (`node scripts/build-code-context.mjs`)
  or on cron via `workflows/code-context-build.yml`.
- **`scripts/answer-watcher.mjs`** — polls PM channels for replies to
  open pickup-flow questions. Stateless detector that emits a JSON
  report; the contract-pickup skill consumes the report and applies AC
  edits + provenance comments + qa.md updates. Runnable locally or on
  the 15-minute cron in `workflows/answer-watch.yml`.

### Known gaps (still deferred)
- **Answer-watcher channel adapters are stubs** — they log what they
  would call but return `mcp-unavailable` by default. Production
  detection needs either (a) running from inside Claude Code / Cowork
  with the relevant MCP, or (b) a thin REST proxy on the MCP host. v0.18
  ships the detection harness + report schema; production wiring lands
  in a follow-up.
- **Cross-repo scanning in the cache builder** uses the `path:` field
  from `repos.yml`. GitHub-only entries (no local `path:`) are skipped
  for now — pulling source via the GitHub MCP is a follow-up.
- **Slack message-link parsing** covers the common URL shape; exotic
  workspace URLs may need a follow-up patch.

### Mental model — when to use which entry point
- **PM authors in Manifest** (rare today, but the ideal) →
  `/contract new`. Same as before. Conversational; PM owns the
  contract.
- **PM authored elsewhere; dev picks it up** (the common case) →
  `/contract pickup <source>`. Dev owns the contract; PM stays in
  their tool.

## [0.17.0] — see your diagrams + findings tell you HOW to fix

### Added
- **`/contract diagram <ID>`** (`scripts/render-diagram.mjs`) — renders a
  contract's Mermaid blocks into a standalone `<ID>.diagram.html` you
  open in any browser, so you can SEE the diagram even when the `.md`
  isn't on GitHub and you're deciding from your IDE. Dependency-free
  (Mermaid via CDN at view time). Docs also point to IDE markdown
  preview, which renders Mermaid natively/with an extension. 5 new tests.
- **Diagrams are now optional** — add one only when a branching/state
  flow makes the contract clearer; skipped by default for simple/bug-fix
  changes (no more forced flowchart).

### Changed
- **Findings now tell you HOW, not just what.** The deterministic
  validator's `suggestion` strings are concrete paste-in templates —
  e.g. a missing AC suggests `- AC<n> (B2): Given …, when …, then …`; a
  missing commsStates gives the four-state skeleton with guidance.
  CRITIC-PROTOCOL now requires every critic `suggestion` to show the
  shape of the fix and where to make it, not just name the gap.

## [0.16.0] — migrate existing contracts to the new layout

### Added
- **`scripts/migrate-contract.mjs`** + `/contract migrate <ID>` — a
  deterministic reformat that brings an existing contract to the v0.15
  grouped frontmatter (YOU-AUTHOR / MANIFEST-MANAGES), adds `changeType`
  if absent, and leaves the body untouched. **Preserves every value** —
  managed state (timestamps, status, `landed`, `bugFollowups`) and any
  unknown fields — and is idempotent. Refuses frozen `<ID>.r<N>.md`
  snapshots. 6 new tests (88 total).
- Loads frontmatter with `JSON_SCHEMA` so ISO timestamps stay verbatim
  strings — the default schema parses them to `Date` and re-emits
  `...000Z`, which would silently rewrite every timestamp. (Caught by a
  preservation test.)

## [0.15.0] — author-friendly contracts (what to edit, where, what to remove)

The findings got readable in 0.14.0; this does the same for the contract
the author actually edits.

### Changed
- **Frontmatter split into two labelled groups** in CONTRACT-FORMAT and
  in what `contract-new` scaffolds: `# ── YOU AUTHOR (edit these) ──`
  (just `id`, `title`, `changeType`, `platforms`, `createdBy`) and
  `# ── MANIFEST MANAGES — don't edit ──` (status, complexity,
  timestamps, fix counters, guard/rollout fields, bugFollowups). No more
  guessing which fields are yours.
- **New "Editing a contract" section** — maps each findings location
  (`B2`, `AC3`, `frontmatter`, a section name) to exactly where in the
  file, says which sections you own, and clarifies *what to remove*:
  `Out of scope` is where you defer work, drop a behavior by removing the
  **whole** block (a half-specified behavior is a blocker), and the
  optional `rollbackTriggers`/`rolloutPlan` blocks are deletable.
- Optional frontmatter blocks are now clearly marked optional/deletable
  rather than shown as if required.

## [0.14.0] — readable findings (human-first `.md`)

Findings felt hard to read and people weren't sure how to edit them. Two
fixes — one a clarification, one a format change:

### Changed
- **You never hand-edit `findings.md`.** It's the read-only *output* of
  verify; you edit the **contract** and re-verify (or `/contract fix`),
  which regenerates it. Stated up front in the file's own banner and the
  docs.
- **`findings.md` is now human-first; machine metadata moved to the
  `.json`.** The `.md` frontmatter is tiny (readiness, promotable,
  counts) — the wall of `sha256:` hashes, `regressionScan`,
  `criticsRun`, and normalization notes that used to greet the reader
  now live in `findings.json` only (where the `--changed` planner and
  tooling read them). The body lists blockers in full with plain-English
  fixes, **summarizes** the advisory warnings/info (one line each, full
  text in the `.json`) instead of dumping dozens of paragraphs, demotes
  critic IDs to small trailing tags, and ends with "What to do next."
- **Critics now write in plain English.** CRITIC-PROTOCOL requires
  `message`/`suggestion` to read like a reviewer's note — jargon spelled
  out, location in human terms, ID not leading the sentence.

## [0.13.0] — bounded contract verify→fix loop

The slow part of authoring was the manual round-trip: verify → "Claude,
fix it" → re-verify → a *new* blocker appears → repeat, each pass paying
full verify cost. New `/contract fix <ID>` collapses it.

### Added
- **`/contract fix <ID>`** (contract-verify fix mode) — runs verify,
  applies the fixes for **all open blockers in one batch**, re-verifies
  **incrementally**, and loops until 0 blockers or a 3-pass cap
  (`maxFixIterations`), then reports a promotable contract. Targets
  blockers only (warnings stay advisory); on the cap it stops and hands
  back the remaining blockers instead of churning. One command instead
  of N hand-driven passes.
- Key rule that kills the "re-verify finds new blockers" whack-a-mole:
  when a fix adds a behavior/AC, it's added **complete** (all required
  fields at once) so the next pass doesn't block on the fragment just
  added — the #1 source of cascading blockers.
- New `verifyFixIterations` frontmatter counter (distinct from the PR
  loop's `fixIterations`; both capped by `maxFixIterations`).

## [0.12.0] — solo / zero-footprint mode

### Added
- **Solo / zero-footprint mode** (GUIDE §1f + a setup-init choice) — use
  Manifest as an individual contributor without adding a single file,
  workflow, or Action to a team's repo. Contracts + `repos.yml` live in
  a separate repo you own (or a local-only folder) and point at the team
  repo by its `github:` slug via your existing read access; you run the
  skills (`/contract`, `/code-review`, `/implement`) locally and open a
  normal PR. The team sees nothing Manifest-related. `setup-init` now
  asks team-vs-solo and, in solo mode, writes config elsewhere and skips
  workflow installation entirely. No format changes — adopt the full CI
  loop later if the team wants it.

## [0.11.0] — native iOS / Android deploy verification

`verify-deployment` could verify web, Flutter, and backend, but native
Swift/Kotlin apps fell through (the Flutter sub-mode is keyed on
`languages: [dart]`), so a native contract had no runnable sub-mode.

### Added
- **Sub-mode D: native mobile** in `verify-deployment` — iOS (Swift,
  `xcodebuild test`) and Android (Kotlin, `gradlew test` /
  `connectedAndroidTest`), with three checkpoints: pre-release (CI
  sim/emulator), internal-track (Firebase Test Lab real-device matrix),
  and prod (telemetry: Firebase Analytics + Crashlytics crash-free % +
  Performance). Recognizes that native ships via **store staged
  rollout** (no feature flag): a `rollback` verdict means *halt the
  staged rollout*, not flip a flag. Implementer already supported native
  via STACK-PROFILES; this closes the verification half.
- **Native mobile CI guidance** — GUIDE §3.4b plus headers in
  `pr-verify.yml` / `verify-deploy.yml`: iOS jobs need
  `runs-on: macos-latest` + Xcode setup; Android needs the SDK +
  `setup-java`; per-repo signing / Firebase Test Lab secrets. Covers the
  two-separate-features / two-repos / two-teams case (single-platform
  contracts in each repo, no shared specs repo or parity ceremony).

## [0.10.0] — proportional scope (stop over-engineering small bugs)

Driven by a real run where a one-line bug fix grew into a 5-revision
epic (a new analytics event, a 7-day shadow baseline, a flag with
mount-time caching, 21 ACs). The critics were calibrated for net-new
features and only ever ADD; nothing argued for cutting. Three fixes:

### Added
- **`changeType: feature | bug-fix` frontmatter** (default `feature`).
  A `bug-fix` contract verifies LEAN: `contract-verify` runs only
  `minimality` + scoped `edge-cases` + `regression` + `security`
  (if relevant); **turns the instrumentation critic OFF** and drops the
  success-metric / shadow-baseline requirement (a bug's metric is the
  regression test). `contract-new` sets `bug-fix` for bug intake and
  scaffolds without a success-metrics section or new events. The
  validator reports `changeType` in its output.
- **`critic-minimality` (new, always-runs)** — the counterweight that
  pushes back on disproportionate scope: feature-grade telemetry /
  shadow phases / flags / exhaustive speculative edge cases on a small
  change. Emits `MIN-` findings at `warning` (advisory). Added to the
  protocol's canonical names + ID prefixes.

### Changed
- **CRITIC-PROTOCOL framing: "handle OR explicitly defer."** Every
  critic's `suggestion` must let the author *descope* (move to Out of
  scope) rather than only "add handling for X" — so scope can't grow one
  finding at a time, and readiness no longer requires building
  everything a critic noticed. Critics calibrate to `changeType` /
  `complexity` and bias toward deferral on bug fixes.

### Why
A bug fix should verify against ~2-3 scoped critics, not a feature's
full suite. The UWS-257 contract under the old rules would now: skip
instrumentation entirely, drop the shadow baseline + success metric, and
get a `minimality` warning on the flag/analytics scope — i.e. ~80% smaller.

## [0.9.0] — blockers are the only hard gate (no more endless verify)

Verify could feel endless because reaching `verified` required **0
warnings**, and warnings are the LLM-variable findings that reshuffle
run-to-run. Now a dev clears a finite, stable set and ships.

### Changed
- **`promotable` = zero open blockers** is the real gate
  (`computeReadiness` now returns it). Warnings and info are advisory —
  they refine the `readiness` signal but **never block promotion**.
  `contract-promote` now gates on `promotable`, not `status: verified`;
  it surfaces open warnings and proceeds (you can fix or acknowledge
  them, but you don't have to).
- **New `acknowledged` finding status** — a human reviews a warning and
  accepts it; it leaves the open set and never re-litigates. Added to
  the finding-status enum (`open | resolved | dismissed | acknowledged`)
  in both `validateFindings` and `validateReviewFindings`.
- `contract-verify` and `/status` now lead with `promotable` and list
  blockers (must-fix) separately from warnings (advisory); verify
  carries `acknowledged`/`dismissed` statuses forward across re-verifies.

### Why it converges
Blockers (deterministic facts + serious judgment issues) are stable and
finite → drive to zero. Warnings → fix or acknowledge → don't resurface.
Unchanged content → caching + incremental re-verify reuse prior findings.
So the loop terminates instead of chasing run-to-run variance. 4 new
tests (82 total).

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
