# Manifest — who runs what, when

The whole point of Manifest: a PRD becomes build-ready through a **clear chain of
ownership**, so no step is skipped and no one gets blamed for someone else's gap.

**The one-line version:** PM gates the PRD → Dev deep-checks it against the code →
answer the gaps → groom → build → verify → launch → watch.

## Roles

| | Role | Owns |
|---|---|---|
| 🧑‍💼 | **PM** | The PRD and its readiness. Signs it off. Answers questions. |
| 🧑‍💻 | **Dev** | The contract, the code, the PRs. |
| 🧭 | **Lead** | Coordination — decompose, assign owners, promote, watch status. |
| 🤖 | **Auto** | CI / cron. No human trigger. |

> On a small team one person wears several hats — that's fine. The point is that
> for any given step, *someone* is clearly on the hook.

## The main path (a real feature)

| # | Step | Who | Run this | When (trigger) | You get |
|---|---|---|---|---|---|
| 1 | Make the PRD dev-ready | 🧑‍💼 PM | **Ready Check** panel, or `/ready-check <source>` in chat | Before handing anything to dev | A tamper-evident **gate code + hand-off** |
| 2 | Pick up & deep-check | 🧑‍💻 Dev | `/contract pickup <ticket>` | You received the hand-off / got assigned | Verified contract + **code-grounded findings** (regressions, security, edge cases) + **design audit** + a "**PM must answer**" list |
| 3 | Answer the gaps | 🧑‍💼 PM | Just reply in JIRA/Slack — the answer-watcher folds it in | Pickup posted questions | Contract updated. **SLA pauses** while blocked on you |
| 4 | Split it (if big / multi-person) | 🧭 Lead | `/contract decompose <ID>` | Contract is **Large** or spans FE + BE + more | An **epic** + child contracts, each with `owner` + `repo` + `dependsOn` |
| 5 | Coordinate | 🧭 Lead | `/status`, or `/status <epic>` | Anytime | Who holds the ball, the **critical path**, who's blocked on whom |
| 6 | Freeze & start the build | 🧭 Lead / Dev | `/contract promote <ID>` | Groomed and ready | Frozen contract, SLA timer starts, build kicked off |
| 7 | Implement | 🧑‍💻 Dev / 🤖 | `/implement <ID>` (or `@claude /implement <ID>` in a PR comment) | After promote | Code + tests + a PR |
| 8 | Review the PR | 🤖 + 🧑‍💻 Dev | `verify-pr` + `code-review` (run in CI on the PR) | Every PR | AC-conformance verdict + a code-defect review comment |
| 9 | Verify the deploy | 🤖 | `verify-deploy` (CI on deploy) | On deploy to an env | Canary-readiness verdict (Playwright + telemetry) |
| 10 | Roll out (canary) | 🧑‍💻 human flips the flag; 🤖 watches | `/canary`, `rollback-guard`, `/rollback-check` | During the rollout window | proceed / hold / **recommend-rollback** (never auto-rollback) |
| 11 | Did it actually work? | 🤖 + 🧑‍💼/🧑‍💻 | `/launch <ID>` (auto on cron: day 1 / 7 / 14 / 28) | After launch | **landed / partial / not-landed** verdict |
| 12 | If rolled back | 🧑‍💻 flips flag off, then | `/postmortem <ID>` | After a rollback | Blameless postmortem + reopened follow-up |

## Side paths

- **Trivial change** (one-liner, copy/CSS, config bump): 🧑‍💻 Dev → `/fix <bug>`.
  Skips the contract ceremony; **escalates to `/contract` if it turns out bigger.**
- **Ongoing bug watch** (during the monitoring window): 🤖 `bug-triage` runs
  nightly → dedupes → files clusters to JIRA → routes each to `/fix` or `/contract`.
- **First-time setup**: 🧭 Lead → `/manifest setup` (or `/setup`).
- **Lost / new?** → `/manifest` (help + tutorial).

## Which command do I run? (30-second guide)

- I'm the PM with a PRD or an idea → **Ready Check** (`/ready-check`).
- I got a ticket/hand-off to build → **`/contract pickup`**.
- It's a genuine one-line fix → **`/fix`**.
- This contract is huge / needs FE + BE → **`/contract decompose`**.
- Where's everything at? → **`/status`** (add an epic ID for the feature view).
- It's groomed — let's build → **`/contract promote`**.
- Did it land? → **`/launch`**.

## Two levels — don't confuse them

| | Level 1 | Level 2 |
|---|---|---|
| Command | `/ready-check` | `/contract pickup` |
| Who | 🧑‍💼 PM | 🧑‍💻 Dev |
| Judges | the PRD **text** vs the Definition of Ready | the PRD **against the code** (regressions, feasibility, design file) |
| Speed | seconds, no repo | ~1 min of agent work |

They're **complementary and sequential**, not either/or. **Don't run `/ready-check`
twice** — pickup is the dev-side step, and it *is* the verify.

## Accountability, baked in

- The **gate code + `promptedBy`** are the PM's signed sign-off; **waivers** are
  risks the PM explicitly accepted.
- The **SLA pauses while "blocked on PM"** (`ballLedger` / `effectiveSla`) — a dev
  is never shown overdue for a delay the PRD gap caused. `/status` leads with who
  holds the ball.
- A **feature (epic) lands only when every child lands** and the success metric
  moves — not when one dev finishes their part.

---

*See also: `gate/SETUP.md` (Ready Check setup), `reference/READY-CHECK-RUBRIC.md`
(the Definition of Ready), and each skill's `SKILL.md` for the detail behind a step.*
