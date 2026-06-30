# Next features — impact assessment

**Status:** Draft / for decision
**Date:** 2026-06-29
**Context:** Follow-on to `model-tiering-and-advisor.md`. Four candidate
features, each scored on impact, effort, and risk, with a recommended
sequence. The theme is *closing loops* the current pipeline leaves open —
measurement, learning, and stability — so the system improves itself rather
than staying static.

## Summary

| # | Feature | Impact | Effort | Risk | Reuses |
|---|---|---|---|---|---|
| 1 | Cost/token observability ✅ DONE | High | S–M | Low | findings.json provenance, modelPlan |
| 2 | Postmortem → bug-pattern loop ✅ DONE | High | M | Low–Med | BUG-PATTERNS.md, code-review critic, postmortem skill |
| 3 | Finding-stability / variance tracker ✅ DONE | Med | S | Low | recall.mjs + eval/golden (already exist) |
| 4 | Critic-level advisor escalation ✅ DONE | Med | S | Med | advisor (wired), CRITIC-PROTOCOL |

Effort: S ≈ a focused change + tests; M ≈ multi-file with a new flow. Risk is
about the verdict/determinism property, not general bugs.

---

## 1. Cost/token observability — ✅ SHIPPED

> Implemented: `computeCost`/`normalizeModel` + a `--cost` rollup in
> `validate.mjs`, priced from `reference/model-pricing.json`; `usage` block
> recorded in `findings.json` (critics) and `<ID>.implement.json` (Implementer +
> advisor); schema in `CRITIC-PROTOCOL.md`; surfaced as `/manifest cost` with a
> by-complexity / by-model-tier / by-critic breakdown. Kept strictly as
> observability — never a gate or provenance input. 5 unit tests; suite green.

**What.** Record actual tokens + cost per critic and per Implementer run in
`findings.json` provenance (next to the `models`/`complexity` we already
store), and a small rollup (`/manifest cost` or an eval-time report) showing
cost by complexity and by critic over time.

**Why / impact.** This is the missing half of the routing + advisor work just
shipped. We changed *how* models are chosen to save tokens but added no way to
**measure the saving** — the design doc literally says "confirm with an eval
run." Without this you can't answer "did tiering help?", "is Haiku
under-flagging so we're paying for re-runs?", or "is the advisor paying for
itself?" It turns the routing rubric from a guess into a data-tuned dial. High
impact precisely because it makes every other model decision measurable.

**Effort.** S–M. Capture usage from the run, write it to the `.json`; the
rollup is a small script. No protocol-breaking change (additive provenance).

**Risk.** Low. Additive; doesn't touch the verdict. Main caveat: token usage is
**not** deterministic, so keep it OUT of eval gates and the reproducible
provenance set (same rule we applied to the advisor) — record it as
observability, never as a gate input.

**Dependency.** None. Best done first — it's the instrument the others are
tuned against.

## 2. Postmortem → bug-pattern learning loop — ✅ SHIPPED

> Implemented: `/postmortem` proposes a candidate in
> `reference/bug-patterns.candidates.md` (staging, unenforced) when a cause is a
> diff-detectable bug class; a maintainer promotes it into `BUG-PATTERNS.md`
> (next id via `validate.mjs --next-pattern-id`), where `code-review` enforces
> it. Safety: human-accept gate + `warning`-until-proven default (honored by the
> code-review skill). Deterministic catalog validator (`--check-patterns`:
> well-formed entries, unique + monotonic ids) wired into `eval.yml`; 7 unit
> tests; suite green.

**What.** When a postmortem identifies a root cause that code review *could*
have caught, promote it into a new `BP-NNN` entry in `reference/BUG-PATTERNS.md`
(with a provenance link back to the incident), so the `code-review` critic —
which already loads and checks every active `BP-` pattern against each diff —
enforces it forever after.

**Why / impact.** Highest strategic payoff: the system gets permanently smarter
with each incident instead of relearning the same lesson. The same class of bug
can't ship twice. All the pieces already exist (`rollback-postmortem` skill,
`BUG-PATTERNS.md`, code-review's `BP-` loop) — the only missing link is the
promotion step that connects them. This is the clearest "self-improving system"
feature on the list.

**Effort.** M. Add a "candidate bug pattern" output to the postmortem skill,
plus a lightweight review/accept gate so a human confirms before a pattern
becomes a hard check (auto-adding blocking checks unreviewed would be risky).

**Risk.** Low–Med. The risk is a noisy or over-broad pattern turning into
false-positive blockers on every PR. Mitigate with: human-accept before a
pattern goes active, a severity default of `warning` (not `blocker`) for
machine-proposed patterns until proven, and the same 12-finding cap discipline.

**Dependency.** Independent, but more valuable once #1 exists (you can see
whether a new pattern adds review cost).

## 3. Finding-stability / variance tracker — ✅ SHIPPED

> Implemented: `scoreStability(runs, golden)` in `scripts/recall.mjs` scores N
> repeated runs of a fixture — per-gap hit rate, run-to-run stdev of required
> recall, and a flaky-gap list — failing when a required gap's hit rate drops
> below `stabilityThreshold` (default 1.0). CLI `recall.mjs --stability`; opt-in
> `eval.yml` sweep gated on `MANIFEST_STABILITY_RUNS`; noted in `RELIABILITY.md`.
> 6 unit tests; suite green. Pure/deterministic given the runs, like `scoreRecall`.

**What.** Extend the existing `recall.mjs` + `eval/golden` harness to track
finding **variance run-to-run**, and specifically across model tiers — surfacing
when a critic's findings become unstable (the protocol's own "convergence line"
idea, measured).

**Why / impact.** You lean hard on determinism and reproducible-by-reference
findings. Mixing models per tier (what we just shipped) is exactly the change
that could introduce drift on the judgment layer. This guards that property: if
moving comms-completeness to Haiku makes its findings flap, the tracker catches
it in CI, not in a dev's confused re-verify. Medium impact — it's insurance on
the routing change rather than new capability.

**Effort.** S. The recall harness and golden fixtures already exist; this adds a
variance metric and a threshold, not a new harness.

**Risk.** Low. Test-only; never touches production runs or the verdict.

**Dependency.** Pairs naturally with #1 (cost) — together they're the
"measurement" half of the loop. Do alongside or right after #1.

## 4. Critic-level advisor escalation — ✅ SHIPPED

> Implemented: a fast-tier critic may consult the advisor on a borderline
> `warning`/`info` call only — defined in `CRITIC-PROTOCOL.md`, opt-in via
> `conventions.criticAdvisor`. The safety constraint is **enforced in code**:
> `validateFindings` rejects any advisor-influenced `blocker`
> (`metadata.advisorConsulted` + `severity: blocker`), so the promotability
> gate stays fully deterministic. Advisor-influenced findings are marked and
> excluded from reproducible provenance/eval. 4 unit tests + CLI check; suite
> green.

**What.** Let a light/default critic (Haiku/Sonnet) consult the advisor on a
single **borderline** finding, instead of promoting the whole critic to a strong
model. Already half-scoped in `model-tiering-and-advisor.md`.

**Why / impact.** Extends the cheap-first/escalate-on-uncertainty pattern from
the Implementer to the critics — strong judgment exactly where a finding is
genuinely ambiguous, common case stays cheap. Medium impact; the per-tier
routing already captures most of the win, so this is a refinement.

**Effort.** S. Advisor is already wired; this is guidance in the critic protocol
plus a trigger condition.

**Risk.** Med — and this is the important one. The advisor is non-deterministic,
and critics produce **verdict-bearing** findings (unlike the Implementer). An
advisor-influenced finding could make the verdict non-reproducible, which fights
the whole design. **Constraint:** an advisor may only help a critic *downgrade
or add caveats* / decide whether to emit, and the result must be recorded as
advisor-influenced and excluded from the reproducible-provenance comparison — or,
safer, scope it to advisory (`warning`/`info`) findings only, never blockers.
Worth doing last, carefully, after the measurement features can show its effect.

---

## Recommended sequence

1. **Cost/token observability (#1)** — first, because it's the instrument
   everything else is judged by, and it completes the loop on work already
   shipped.
2. **Finding-stability tracker (#3)** — alongside/just after #1; together they
   are the measurement layer, and #3 is cheap because the harness exists.
3. **Postmortem → bug-pattern loop (#2)** — the strategic bet; do it once you
   can measure its review-cost impact (via #1).
4. **Critic-level advisor escalation (#4)** — last and most cautiously, because
   it's the only one that can touch verdict reproducibility; gate it behind the
   stability tracker so drift is visible.

Net: do the two measurement features first (cheap, low-risk, and they de-risk
everything after), then the high-value learning loop, then the delicate
escalation refinement under the protection of the stability tracker.
