# Ready Check rubric — the Definition of Ready (PM-side gate)

The single source of truth for what "ready for dev grooming" means. The
`ready-check` skill, the deterministic engine (`scripts/ready-check.mjs`), and
the offline web page (`gate/prd-readiness-gate.html`) all encode this list.
**If you change the rubric, change all three** — `eval/ready-check.test.mjs`
pins the engine.

## Why a PM-side gate exists

Raised in `#fast-track-contract`: dev kept chasing PMs for basic PRD details,
grooming half-baked requirements mid-sprint, then getting blamed for delays.
The fix is a first, cheap check the PM clears *before* engineering estimates —
"airport security for PRDs." It is deliberately a **floor** (are the basics
present and specific?), not a deep judge. The depth is Level 2, dev-side.

## The line: what moves to the PM vs stays with dev

The dividing line is **what can be judged from the PRD text (± a published
code-context digest) vs what needs the live repo.**

- **PM side (this gate):** everything judgeable from the PRD text, plus
  convention/surface awareness from the code-context cache. Made smart by the
  skill's judgement pass, so PMs see their own blockers.
- **Dev side (`/contract pickup`):** regression risk, security, scalability,
  perf realism, feasibility, and the estimate — these need the code, not text.

Guardrail: don't push implementation decisions onto PMs. Text-judgeable
*product* gaps → PM. Code-judgeable *technical* gaps → dev.

## The 11 required items (+ 2 recommended)

Each is a plain question a PM can answer. `skippable` items may be marked N/A
with a stated reason; everything else needs a real answer (≥ 3 chars, no
"TBD"). The engine only checks presence + specificity; the skill judges quality.

| # | id | Plain question | Skippable when | Deeper dev critic | Code-context field |
|---|----|----|----|----|----|
| 1 | `goal`   | What problem are we solving? | — | minimality | — |
| 2 | `metric` | How will we know it worked? | — | minimality | — |
| 3 | `design` | Where is the design? (Figma/mock link) | no UI change | — | — |
| 4 | `scope`  | Which platforms — and what's NOT included? | — | platform-parity | — |
| 5 | `oldbeh` | What happens today? | brand-new feature | regression | — |
| 6 | `flows`  | Which screens/flows does it touch? | — | regression | `surface_index` |
| 7 | `edge`   | What could go wrong? (edge & error cases) | — | edge-cases | — |
| 8 | `states` | What does the user see: nothing / loading / done / error? | not user-facing | comms-completeness | `i18n` |
| 9 | `l10n`   | Is the wording final and translated? | — | — | `i18n` |
| 10 | `writer` | Does this affect writers or creators? | no writer impact | — | — |
| 11 | `events` | What should we track? (analytics) | — | instrumentation | `events` |
| — | `deps`    | Depends on another team or API? *(recommended)* | — | — | `dependencies` |
| — | `rollout` | How will it roll out? *(recommended)* | — | — | — |

Design (3) is the item that caused last sprint's P0 — a UI feature cannot clear
without a link unless the PM explicitly marks it backend-only. The link then
rides in every hand-off so "the design wasn't even there" can't recur.

## Verdict

- **Ready** — all 11 required satisfied (skips count as satisfied). A gate code
  is minted; the hand-off is emitted; grooming may start.
- **Not ready** — any required item missing. The gate code is withheld and the
  exact gaps are listed. Recommended items never block; they're flagged.

## Gate code — deterministic + tamper-evident

Format `RC-<AAA>-<6>` (`RC-SAV-WCWA86`). It's a djb2 hash of the normalized
satisfied answers + title, so:

- the same PRD always yields the same code (reproducible), and
- editing any answer after clearing changes the code → a stale hand-off no
  longer verifies. Dev runs `ready-check.mjs --verify` and sees `valid`,
  `stale`, or `invalid` before pickup.

The code is content-bound, not a random token — that's what makes "no code, no
grooming" an actual gate rather than a sticker.

## Code-aware notes (no repo access)

When `.manifest/.cache/code-context.json` is present, the engine adds *non-
blocking* notes from the published digest — e.g. an event name that breaks the
app's `snake_case` convention, or a named flow that touches more surfaces than
the PRD lists. This is how the PM check gets code-aware without ever holding
source credentials. The precise, live scanning stays dev-side.
