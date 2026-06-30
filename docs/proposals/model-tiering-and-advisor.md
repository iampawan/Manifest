# Design proposal: model tiering + advisor escalation

**Status:** Draft / proposal (not adopted)
**Date:** 2026-06-29
**Scope:** How Manifest picks the right model for each unit of work, optimizes
tokens, and uses Claude Code's `/advisor` tool for hard calls.

---

## 1. Problem

Manifest fans out ~10 LLM critics per contract verify, plus the Implementer and
code-review in CI. Today every critic runs at the same model tier (it inherits
the session model). Two costs follow:

- **Token waste.** Mechanical, format-heavy critics (e.g. comms-completeness,
  minimality) don't need a frontier model, but pay frontier rates anyway.
- **No escalation path.** A critic that hits genuine ambiguity has no way to
  "ask a stronger model" — it either guesses or over-flags. The only lever is
  to run *everything* heavy, which is the expensive default.

GUIDE.md §②/verify already *states* the intent — "heavy critics use a strong
model, light ones a fast model" — but it's documentation, not wiring. The only
real `model:` pin in the repo is the example in `CRITIC-PROTOCOL.md`.

This proposal makes that intent real and adds a second, complementary lever:
Claude Code's built-in `/advisor`.

## 2. What's already solved — don't rebuild

Manifest already does the highest-leverage token work, and this proposal
deliberately leaves it untouched:

- `scripts/validate.mjs` does all mechanical checks in **code, zero tokens**,
  before any critic fires. Critics only add the judgment layer.
- Verify is incremental: **no-op** reuses findings, **incremental** re-runs only
  critics over changed behaviors, **`--fast`** skips the regression scan.
- Findings are cached and reused unless the contract's API surface actually
  moved.

The wins below are *on top of* this, not a replacement for it.

## 3. Lever A — the system routes itself (no human picks a model)

The design goal: a dev running `/contract verify` should **never think about
models**. So model choice must be made *by the system*, automatically. There are
two ways to do that, and the right answer combines them.

### 3.1 The routing principle: route on signals already computed, in code

The naive way to be "smart" is an LLM classifier that reads the task and picks a
model. **Don't.** That costs a token call and — fatally for Manifest — it
reintroduces non-determinism into the verdict path, fighting the whole
reproducible-by-reference design. The verdict mechanism must stay deterministic.

The better way: the router is **code reading signals Manifest already produces
for free.** `computeSizing()` in `validate.mjs` already classifies every
contract into `complexity: small | medium | large` from behavior count, platform
count, and risk flags (`touchesAuth`, `touchesBilling`, `schemaMigration`,
`riskOverride`), with `reasons`. `changeType: bug-fix` already selects a lean
critic set. These are the exact inputs a model router needs — already computed,
already deterministic, already the thing that decides "is this big enough to need
`/contract decompose`." Reuse it as the model router and the choice is both smart
*and* reproducible.

### 3.2 The wiring: a baseline tier per critic, escalated by complexity

> **Status: implemented (phase 1).** The router lives in
> `scripts/validate.mjs` as `computeModelPlan()` and is emitted as
> `modelPlan` in the validator output; the verify orchestrator reads it and
> spawns each critic at its assigned model. Chosen over per-frontmatter
> `model:` pins because verify dispatches critics from the orchestrator (not
> as standalone agents), and a code-router is unit-testable and reproducible —
> see `eval/validate.test.mjs`.

Two layers, both automatic:

**Baseline** — each critic has a default tier in `CRITIC_BASELINE`
(model aliases `haiku` | `sonnet` | `opus`):

| Baseline tier | Model | Critics | Rationale |
|---|---|---|---|
| Light | `haiku` | minimality, comms-completeness | Presence/shape of states + copy; near-mechanical. |
| Default | `sonnet` | edge-cases, instrumentation, perf-budget, platform-parity | Reasoning over one contract's behaviors. |
| Heavy | `sonnet`→`opus` | regression, security, scalability | Cross-repo / adversarial; escalates by complexity (below). |

**Escalation by complexity** — the orchestrator overrides the heavy critics'
model from the sizing bucket, so the *same* security critic runs cheaper on a
trivial change and stronger on a risky one:

| `complexity` (from sizing) | Heavy critics run at | Reason |
|---|---|---|
| `small` | `sonnet` | 1–3 behaviors, single platform — Opus is overkill. |
| `medium` | `sonnet` | multi-behavior / multi-platform — Sonnet holds. |
| `large` | `opus` | 8+ behaviors, 3+ platforms, or a risk flag (auth/billing/migration). |

Plus the existing lean path: `changeType: bug-fix` already runs fewer critics,
so a one-line fix is cheap *and* light without any new logic.

So nobody picks a model. A tiny CSS fix runs almost entirely on Haiku/Sonnet; an
auth-flow change across three platforms automatically pulls Opus onto the
security and regression critics — because `computeSizing` already flagged
`touchesAuth` and `large`. The router is a lookup over a number the validator
already returns.

`critic-code-context` (dev-side repo auto-fill) is I/O-bound, not
reasoning-bound — baseline it at `sonnet`, revisit with data.

The baseline tier and the complexity→tier table are **static, version-pinned
mappings**. The *input* (sizing) varies per contract; the *mapping* does not —
so the model choice is a deterministic function of the contract, which is what
keeps findings reproducible (see §5).

## 4. Lever B — `/advisor` for the hard calls

`/advisor` is a real, built-in Claude Code tool (v2.1.98+, Anthropic API only;
not on Bedrock/Vertex/Foundry; experimental). It lets the main model consult a
stronger secondary model **at decision points** — before committing to an
approach, when stuck on a recurring error, before declaring done. The advisor
sees full context and returns guidance folded back into the session. Billing is
per advisor call at the advisor model's rate, so a fast main model + strong
advisor typically costs less than running the strong model throughout.

This is the *escalate-on-uncertainty* half of the strategy, and it slots into
exactly the places tiering can't reach:

- **The Implementer in CI.** Run the Implementer on a mid-tier model with
  `--advisor opus`. It escalates before committing to a plan and before
  declaring ACs covered — the two moments where a wrong call is costly — instead
  of paying frontier rates for every token of boilerplate codegen.
- **Light/default critics that hit ambiguity.** Rather than promoting a whole
  critic to `opus`, let a `haiku`/`sonnet` critic consult the advisor only when
  a specific finding is genuinely borderline. Cheap common case; strong judgment
  exactly where it's load-bearing.

How to enable: `--advisor <model>` on the CI invocation, `/advisor`
interactively, or "consult the advisor" in a prompt. `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`
turns it off. Because it's experimental + API-only, treat it as **opt-in per
repo** (mirror the `pickup.enabled` pattern in `.manifest/repos.yml`) so
Bedrock/Vertex users degrade gracefully to plain tiering.

## 5. The reproducibility wrinkle (must handle)

`CRITIC-PROTOCOL.md` §"Model + version pinning" records **one** `model:` in each
findings file's `verifiedWith` frontmatter, and the eval suite pins model +
plugin version + protocol version so behavioral drift is caught in CI. Per-critic
tiering breaks the "one model" assumption.

Resolution:

- Change `verifiedWith.model` from a scalar to a **per-tier or per-critic map**,
  e.g.
  ```yaml
  verifiedWith:
    pluginVersion: 0.19.0
    models: { light: haiku-4-5, default: sonnet-4-6, heavy: opus-4-8 }
    protocolVersion: 2
    contractHash: sha256:…
  ```
- Bump `protocolVersion` (this is a provenance schema change).
- Update `scripts/validate.mjs` to accept the map and the eval fixtures to pin
  per-tier models, so drift detection still works — just per tier.
- Advisor calls are non-deterministic by nature, so when the advisor fires,
  record `advisorConsulted: true` (and the advisor model) in provenance. Keep
  advisor **out of the deterministic eval gates** — it's an aid to the run, not
  part of the reproducible verdict. The hard gate stays "zero open blockers,"
  computed by code.

## 6. Expected token/cost impact

Rough, directional — confirm with an eval run before committing:

- ~2 of ~10 critics drop from Sonnet→Haiku and ~3 sit at Sonnet rather than a
  blanket-Opus default → meaningful per-verify reduction, with the heavy three
  unchanged so detection quality on the expensive misses is preserved.
- Implementer flips from "Opus throughout" to "mid-tier + Opus advisor at 2
  decision points" → the biggest single saving, since codegen is the
  token-heaviest step.
- Net: cheaper common case, **equal-or-better** judgment where it matters,
  because spend is concentrated at decision points instead of smeared across
  every token.

## 7. Rollout

1. **Baseline tiering + complexity override — DONE (phase 1).**
   `computeModelPlan()` in `validate.mjs` computes a per-critic model map from
   the baseline tiers and `sizing.complexity`; the verify orchestrator obeys
   `modelPlan`. Honors `conventions.criticModels` from `.manifest/repos.yml`.
   Covered by 5 unit tests. No protocol bump, caches unaffected — `modelPlan`
   is additive output, not part of the contract hash or the verdict.
2. **Provenance v2 — DONE.** `verifiedWith` now records a per-tier `models`
   map + `complexity` instead of a single `model` scalar; `PROTOCOL_VERSION`
   bumped 1→2 (documented in `CRITIC-PROTOCOL.md`), which invalidates v1 caches
   by design. The orchestrator copies `models`/`complexity` from the validator's
   `modelPlan`. Locked by tests (v1-stale-under-v2, version-is-2).
3. **Measure** — run the eval suite to confirm findings parity per tier and
   capture real token deltas. Adjust the rubric from data (e.g. if Haiku
   under-flags comms-completeness, promote it back to Sonnet).
4. **Advisor for the Implementer — DONE (phase 1).** `pr-verify.yml` passes
   `--advisor`/`--model` to both Implementer invocations (build + fix mode),
   gated on the `MANIFEST_ADVISOR_MODEL` / `MANIFEST_IMPLEMENTER_MODEL` repo
   variables (opt-in; unset = unchanged). The `implement` skill consults the
   advisor at three decision points only — before committing to the plan,
   before declaring done, and when a fix loop is stuck — and degrades to normal
   operation when no advisor is configured (Bedrock/Vertex, or unset). Still
   open: optionally let borderline *critic* findings consult the advisor too.

## 8. Open questions

- Does `haiku` hold finding quality on comms-completeness/minimality, or does the
  validator already cover so much that those critics are thin enough to drop to
  Haiku safely? **Eval decides.**
- Per-**critic** vs per-**tier** model map in provenance — per-tier is simpler
  and probably enough; per-critic is more precise but noisier. Lean per-tier.
- Advisor is experimental + API-only. Acceptable as opt-in, but it shouldn't
  become a hard dependency of any gate.

## 9. Recommendation

Do §3 now — baseline tiers plus the complexity override driven by
`computeSizing`. This is the answer to "people don't know which model to use":
they never choose, and the system adapts per contract using a signal it already
computes for free, deterministically. Adopt `/advisor` for the **Implementer in
CI** as the first escalation use, since that's the token-heaviest step and where
escalate-on-uncertainty pays off most. Keep the deterministic validator +
zero-open-blockers gate as the source of truth throughout — model routing changes
*cost and judgment quality*, never the *verdict mechanism*.
