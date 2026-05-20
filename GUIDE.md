# Shipline — how it works

Read this once. It's the only doc you need before running your first
contract through the pipeline. The **[README](README.md)** is the
table of contents and the installation reference; this is the
manual for using it.

**If you haven't installed Shipline yet, read [README.md
Installation](README.md#installation) first.** Section 3 below
assumes the plugin is installed and walks you through the rest of
the setup (MCPs, secrets, repos.yml, picking a pilot feature).

---

## 1. The mental model

Shipline turns a PRD into a typed, machine-checkable artifact called a
**contract**. The contract is the source of truth at every stage. The
implementer reads it, the PR verifier checks the diff against it, the
deployment verifier runs its acceptance criteria against a live URL,
the launch monitor checks its success metrics against telemetry.
Nothing in the system interprets prose.

The contract has four states:

```
draft  →  verifying  →  verified  →  promoted
```

A contract in `verified` can be edited — and re-verified — for free.
The moment you `promote` it, a revision file freezes the state, the
SLA timer starts, and the build phase reads from the revision, not
the live contract. Edits after promote fork a new revision; the
running pipeline keeps using the snapshot it started with.

Everything lives in your repo at `.shipline/contracts/`:

```
.shipline/contracts/
├── SC-005.md                              # the live contract
├── SC-005.r1.md                           # immutable revision snapshot
├── SC-005.findings.md                     # critic output (human view)
├── SC-005.findings.json                   # critic output (machine-readable; recall harness reads this)
├── SC-005.implementation-plan.md          # implementer's plan
├── SC-005.pr-review.json                  # code-review findings (CR-*); gates the merge + feeds the fix loop
├── SC-005.deploy-qa-2026-05-19T10:00.md   # verifier reports per env
├── SC-005.guard-2026-05-21T14:00.md       # rollback-guard health checks during rollout
├── SC-005.launch-report-day1.md           # post-launch reports
├── SC-005.launch-report-day7.md
├── SC-005.launch-report-day14.md
├── SC-005.launch-report-day28.md
├── SC-005.bug-log.md                      # cumulative bug findings + routing state
└── SC-005.postmortem.md                   # only if rolled back: blameless postmortem
```

(At day 28 the contract auto-archives to `.shipline/archive/<year>/<ID>/`,
keeping the contract + final report and pruning the process exhaust —
see section 1e.)

Git is your audit trail. Every transition is a commit. Anyone with
repo access can answer "what did we decide, when, and why" without
asking you.

---

## 1b. Pick the right path — process proportional to risk

Not every change deserves the full contract pipeline. Match the
ceremony to the risk:

| Change | Path | Why |
|---|---|---|
| Typo, single CSS value, config flip | just edit + commit | process would cost more than the change |
| One-line bug, copy tweak, dep bump, localized fix | **`/fix`** (express lane) | triage → fix + regression test → PR, minutes; no critics/SLA/launch report |
| New behavior, 1 platform, ≤3 behaviors | **`/contract`** → Small | full ceremony pays off; 24h target |
| ≤2 platforms, ≤8 behaviors, additive schema | **`/contract`** → Medium | 72h target |
| Breaking change, migration, auth/billing, 3+ platforms | normal cycle (Large) | too risky to agent-ship; use Shipline for the spec + critics only |

The `/fix` express lane (the **quick-fix** skill) triages first: if a
"quick fix" turns out to add a new event, span platforms, or change
the schema, it stops and routes you to `/contract new`. That gate is
what keeps the fast path safe — you get speed on trivial changes
without sneaking real features through unverified.

Shipline's overhead is a feature, not a tax: it's the verification
that prevents prod bugs on *risky* changes. On trivial changes it gets
out of the way.

---

## 1c. Works with whatever infrastructure you have

Shipline degrades honestly. The spec/build half (which is where most
bugs are prevented) needs NO infrastructure — only GitHub. The ship/
land half uses whatever you have and is clear about what it can't do.

| You have | Ship step | "Did it land?" verdict |
|---|---|---|
| **Full** (feature flags + Sentry + analytics) | staged canary 1→100%, telemetry-gated | metric movement at day 1/7/14/28 |
| **Partial** (flags + Sentry, no analytics — the typical pilot) | canary via flags, error-gated by Sentry | "no regression" from Sentry + DB-count / server-log / manual for the metric |
| **Bare** (nothing — no flags, no Sentry, no analytics) | deploy to prod directly; rollback = manual revert | manual day-28 review + support tickets; report says `unmeasured` for the quant metric |

What's **constant across all three** — the value that doesn't depend
on infrastructure:
- A complete, critic-verified spec (edge cases, regression, security
  caught at PRD time)
- A verified implementation with AC tests in the repo's stack
- Cycle-time tracking (intake → prod), computed from git/CI, not telemetry

What **degrades without infrastructure**: only the post-launch
*quantitative* "did the metric move" verdict. On a bare repo, the
launch report honestly says `unmeasured — shipped without regression,
landing not confirmed` and recommends the cheapest fix: one structured
log line per success action (no analytics product needed). That's
information, not failure — it tells you which features you're flying
blind on.

**No feature-flag system?** The "canary" step becomes "deploy to prod
+ watch + manual revert if needed." You lose the gradual blast-radius
control, not the rest of the cycle. The verifier still runs the AC
tests against the deployed environment first.

So: pilot on your flags+Sentry repos for the full-confidence loop, and
run bare repos too — the pipeline still prevents bugs at spec time and
ships verified code; it just can't promise a measured landing where
there's nothing to measure.

---

## 1d. Where contracts live — central state

Contracts are the source of truth, so they need one home. Pick based
on your repo layout:

- **Single product repo** → `.shipline/contracts/` in that repo, on
  `main`. Done.
- **Multiple repos** (web + mobile + backend, like most teams) → a
  **dedicated specs repo** (`your-org/shipline-contracts`). A
  cross-repo contract can't sensibly live inside one code repo, and a
  single specs repo on one `main` branch gives you consistent central
  state for free: git's total commit order means no two devs get
  diverging findings for the same contract. Code PRs in the product
  repos reference the contract by ID.

Set it up once:

```bash
git init shipline-contracts && cd shipline-contracts
mkdir -p .shipline/contracts
cp ~/.claude/plugins/shipline/examples/repos.yml.example .shipline/repos.yml
# edit repos.yml to point at your product repos (github: org/repo)
git add -A && git commit -m "init shipline contracts" && git push
```

Then author/verify/promote from there. `/status` run in this repo is
your live dashboard of everything in flight.

**Advisory locks.** `owner`, `lockedBy`, `lockedAt` help teammates not
step on each other — `/contract verify` and `/implement` warn if
someone else holds a recent lock. They're advisory (git is the real
arbiter), and only meaningful on the single-branch specs-repo model.

**What this is NOT:** a real-time service. Two people editing the
*same* contract at once get a normal git merge conflict (rare; git
handles it), and you `git pull` to see the latest. A backend service
that adds real-time locking + a query API is the v2+ upgrade, deferred
until single-branch git actually causes friction. The plugin is built
so that service would wrap the same contract format, not replace it.

---

## 1e. Lifecycle & retention — does `.shipline/` grow forever?

It grows, but it's text in git — thousands of contracts is tens of MB,
not a storage problem. The real concern is *clutter*, and most
per-contract files are **ephemeral** (useful during the cycle, not
after). So Shipline archives, it doesn't hoard.

**When a contract lands** (day-28 final verdict), its files move to
`.shipline/archive/<year>/<ID>/`. The active `.shipline/contracts/`
folder then holds only in-flight + recently-landed work. History is
preserved and searchable; the working view stays lean. `/status` is
unaffected — it already shows only in-flight contracts.

**What's kept vs. pruned on archive:**
- **Kept** (lasting history): the contract `<ID>.md` and the final
  `launch-report-day28.md` — the "what we built + did it land + cycle
  time" record, useful for audits, onboarding, and your cycle-time
  distribution.
- **Pruned by default** (process exhaust): findings, implementation
  plan, deploy reports, day-1/7/14 reports, bug-log (mirrored to
  JIRA), interim revisions. Git history still has them if you ever
  need them. Set `conventions.retention: keep-all` in `repos.yml` to
  archive everything instead of pruning.

**So is the folder needed after a product is live?** The *active*
contracts folder only ever holds current work. The *archive* is
optional long-term memory — keep it for audit/retro value (it's
cheap), or `git rm -r .shipline/archive` if you decide the git
history alone is enough. Nothing in the live product depends on
`.shipline/` at runtime; it's a development-time record, not a runtime
artifact.

Archiving happens automatically at day-28, or manually any time via
`/contract archive <ID>`.

---

## 2. The four phases (for Small/Medium contracts)

### ① SPEC — author and verify
Where: in your editor with Shipline loaded (local Claude Code or Cowork).

You write the contract using `/contract new` (from a JIRA/Linear/Notion
link, or plain text). You review the draft. You run `/contract verify`,
which runs in **two layers**:

1. **Deterministic validator** (`scripts/validate.mjs`, real code) runs
   first — checks every behavior has instrumentation / perf budget /
   comms states, every behavior has an acceptance criterion, platforms
   are in scope, computes sizing and readiness. Reproducible, free, no
   LLM variance.
2. **Judgment critics** (LLM) run second — only for things that need
   reasoning: missing edge cases, security, scalability, cross-repo
   regression, copy quality, platform UX. Their output is schema-checked
   by the validator, so they can't emit out-of-schema severities.

You resolve findings inline by editing the contract (or dismiss with a
reason). Re-run verify until readiness goes green — the verdict is
computed by code, not judged by an LLM. Then `/contract promote`.

### ② BUILD — implement and review
Where: GitHub (the heavy work runs in CI, not on your laptop).

You open a draft PR. From the PR, comment `@claude /implement SC-005`.
The `pr-verify.yml` workflow picks this up and runs the Implementer
agent headlessly in CI. It clones the repo, reads the revision,
plans the changes, writes code + tests in the repo's stack, iterates
until local tests pass, and pushes commits to your PR. On completion,
it posts an AC coverage comment.

On every push the workflow runs **two checks**:
- **`verify-pr`** — *did they build the right thing?* AC coverage,
  instrumentation events, flag gate, no hardcoded strings.
- **`code-review`** — *is the code itself sound?* Security, correctness,
  performance, and maintainability defects on the diff, as `CR-`
  findings (same blocker/warning/info enum, schema-checked). Open
  blockers fail the check and gate the merge.

If code-review (or verify-pr) leaves open blockers, comment
`@claude /fix-pr SC-005` to run the **review→fix loop**: the Implementer
reads the open findings, fixes them narrowly, re-pushes, and CI
re-verifies. The loop is bounded by `maxFixIterations` (default 3) —
after the cap it stops and pings a human rather than churning.

A human reviewer looks at the PR — usually about 30 minutes for a
small contract — and merges. The reviewer's job is "does this look
sane," not "did the tests pass" (they did), "does it match the spec"
(verify-pr shows that), or "is the code dangerous" (code-review caught
the blockers).

### ③ SHIP — deploy and canary
Where: GitHub Actions and your hosting provider.

Merging to main triggers `verify-deploy.yml`. The Verifier agent
runs the same Playwright suite against the deployed QA URL,
samples telemetry from Sentry and Amplitude, and posts a verdict:
`ready-for-canary | hold | rollback`.

If ready, you get a Slack ping asking you to approve canary start.
You click. Remote Config (or your flag system) rolls out 1% → 10%
→ 50% → 100%.

While it ramps, **`rollback-guard.yml`** runs on a tight cadence
(every 30 min). The guard samples Sentry errors, crash-free rate, and
release adoption against the contract's budgets (and any
`rollbackTriggers` you set) and posts a recommendation: `proceed`
(healthy, keep ramping), `hold` (a warning or too-little data — pause
the ramp), or `recommend-rollback` (a clear breach — it posts a
top-level Slack alert to the owner with the breached signal and the
exact action). **The guard recommends; it never acts** — a human flips
the flag or reverts. Run it on demand any time with
`/rollback-check SC-005`, and `/canary SC-005` shows the current stage
+ next recommended ramp step.

If you do roll back, run `/postmortem SC-005` once the flag is off: it
records `landed: rolled-back`, writes a blameless postmortem from the
contract's timeline + guard reports + Sentry, and reopens the work as a
follow-up (never closes it as done). That's the rollback ending of the
loop — see ④.

### ④ LAND — monitor and verify
Where: the `launch-monitor.yml` cron in GitHub Actions.

Every day for 28 days, the cron runs. The Launch Monitor reads
telemetry, errors, and qualitative signals (support tickets, app
store reviews, Slack channels if connected) and computes a verdict
against the contract's success metrics. Reports land in Slack at
day 1, 7, 14, and 28. At day 28, the final verdict — `landed |
partial | not-landed | rolled-back` — is committed to the contract
and the monitoring window closes.

The Bug Watcher (`bug-triage`) runs daily alongside, looking for new
error clusters and filing JIRA tickets with contract back-references —
then **routing each new bug back into the pipeline** instead of leaving
it in a queue: a trivial, high-confidence cluster (or any S0/S1) can
auto-enter the `/fix` express lane; anything bigger drafts a `/contract`
stub. Everything else is *proposed* and waits for a human, it never
auto-merges, and it caps auto-starts per run. The follow-up is recorded
on the contract as `bugFollowups`, so an open fix tempers the `landed`
verdict — the loop stays closed even after launch.

---

## 3. Setup walkthrough

### 3.1 Install the plugin

Three install methods documented in detail in **[README.md
Installation section](README.md#installation)**: marketplace
(`/plugin marketplace add`), direct file copy
(`cp -r shipline ~/.claude/plugins/`), or development mode
(`claude --plugin-dir .`). Pick whichever matches your situation
and come back here for the post-install configuration.

After install, verify with:

```
/plugin           # confirms shipline is loaded
/shipline         # opens the tutorial
```

The same install works in **Cowork mode** — user-scoped plugins
are visible in both.

### 3.2 Connect required MCPs

Shipline reads from the MCPs your client has connected. You need at
minimum:

| MCP | What it's for |
|---|---|
| **GitHub** | Read code, open PRs, post comments |
| **Sentry** | Errors during canary; bug-watcher input; LaunchReport |
| **Slack** | Human gates, daily reports, contract threads |

Strongly recommended:

| MCP | What it's for |
|---|---|
| **Amplitude** (or Firebase Analytics) | Event telemetry for LaunchReport — without one of these, the quantitative half of post-launch verification is hollow |
| **Atlassian (JIRA)** | Auto-file bugs with contract refs |

Optional:

| MCP | What it's for |
|---|---|
| **Figma** | Design coverage check; Implementer can read Figma frames |

Connect each via your client's MCP settings. The plugin skills will
call the right tools automatically.

### 3.3 Wire your target repo

In the repository where you'll ship features:

```bash
# Contracts directory
mkdir -p .shipline/contracts
echo ".shipline/*.tmp" > .shipline/.gitignore

# Copy the workflows
cp ~/.claude/plugins/shipline/workflows/*.yml .github/workflows/

# Commit
git add .shipline/ .github/workflows/
git commit -m "chore: add Shipline pipeline"
```

### 3.4 Set GitHub secrets

The workflows reference these. Add them in repo Settings → Secrets:

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | All workflows (Claude CLI auth) |
| `SENTRY_AUTH_TOKEN` | `verify-deploy.yml`, `launch-monitor.yml` |
| `AMPLITUDE_API_KEY` | `verify-deploy.yml`, `launch-monitor.yml` |
| `SLACK_BOT_TOKEN` | `launch-monitor.yml` |
| `JIRA_API_TOKEN` | `launch-monitor.yml` (bug watcher) |

`GITHUB_TOKEN` is provided automatically by Actions.

### 3.5 Decide your Slack channel

By convention, Shipline posts to `#shipline` for cross-contract events
and a per-contract thread for everything else. Create the channel and
invite the bot user that owns `SLACK_BOT_TOKEN`.

### 3.6 Pick your pilot feature

The single most important setup step. Pick something genuinely **Small
bucket** — one platform, ≤3 behaviors, no schema, no auth changes. A
copy change, a new filter chip, a CSV export button. Resist the urge
to test on something exciting.

**Bonus criterion: pick a project that has some measurement infra
in place.** Firebase Analytics is ideal; structured server logs are
fine; a database the launch report can query also works. If none of
your candidate projects has any of these, Shipline still works — the
critics, Implementer, Verifier, and Bug Watcher all run regardless —
but the launch report will mark success metrics as "unmeasured"
rather than confirming the feature landed. That's an honest verdict,
just less compelling for the demo. If you have a choice, pilot on
the project with the richest measurement first.

---

## 4. Your first feature, hour by hour

Real walkthrough on a Small contract with a 24h SLA. Times are illustrative.

### T+0:00 — Tuesday 9:00 AM
Open Claude Code in your repo. Run:

```
/contract new "Add CSV export button to /admin/users"
```

The intake skill asks five questions. You answer in ~5 minutes. A
draft contract lands at `.shipline/contracts/AU-007.md`.

### T+0:15 — Verify
```
/contract verify AU-007
```

Nine critics run in parallel. Total wall time: ~90 seconds. You get
back a findings file with:
- 2 warnings (instrumentation field empty on B1; comms-completeness
  missing error state)
- 1 info (perf budget defaulting to suggested values)

You open `AU-007.md`, fill in the missing fields. Re-run verify.

### T+0:30 — Readiness green
Findings file shows `readiness: verified`, complexity: `small`.

```
/contract promote AU-007
```

A revision file is created at `AU-007.r1.md`. A JIRA epic gets
opened. A GitHub tracking issue lands with the SLA timer prominently
shown: "Due: 2026-05-20 09:30 (T+24h)". A Slack message hits
`#shipline`: "🚀 *Add CSV export to admin users* (AU-007) promoted —
small · SLA 24h".

### T+0:45 — Open the PR
You open a draft PR with a one-line description referencing the
contract. Comment on the PR:

```
@claude /implement AU-007
```

The `pr-verify.yml` workflow fires. You see "Implementer running…"
appear in the PR's Checks tab.

### T+1:00 to T+8:00 — Implementer works
You go about your day. The Implementer:
1. Clones the repo
2. Reads `AU-007.r1.md`
3. Writes `.shipline/contracts/AU-007.implementation-plan.md`
4. Adds the CSV export button, the export endpoint, and the
   instrumentation event
5. Generates `tests/AU-007.spec.ts` with one Playwright test per AC
6. Runs lint, typecheck, unit tests, Playwright locally — all green
7. Pushes commits

Periodically the workflow re-runs verify-pr on each push and updates
the AC coverage comment.

### T+8:00 — Slack ping
You get a Slack DM: "PR #142 ready for your review. 3 ACs covered.
All tests green. AC coverage report attached."

### T+8:30 — Human review (30 min)
You open the PR. Read the AC coverage comment. Skim the diff. The
tests passed, so you're not verifying behavior — you're verifying
that the diff is sane and the approach matches house style. Looks
good. Approve. Merge.

### T+9:00 — Deploy to QA
Your existing CI deploys main to QA. The `verify-deploy.yml`
workflow fires. The Verifier agent:
1. Runs Playwright against the QA URL
2. Samples Amplitude for the `users_csv_exported` event firing
3. Checks Sentry for new errors tagged to this release
4. Posts a verdict: `ready-for-canary`

### T+10:00 — Slack approval for canary
"AU-007 ready for canary at 1%. Error rate baseline 0.02%. No
regressions. Approve?"

You click ✅ in Slack.

### T+10:00 to T+18:00 — Staged rollout
You bump the flag through the `rolloutPlan` stages: 1% → 10% → 50% →
100%. At each stage, `rollback-guard` samples Sentry every 30 minutes
and posts a verdict + the next recommended step (`/canary AU-007` shows
it any time): "healthy, baked 2h — advance to 10%." No breach, so you
advance at each green check. Reaches 100% by T+18:00. The guard
recommends; you flip the flag — it never advances the rollout for you.

You leave for the day. SLA met with 6h to spare.

### T+24:00 — Day 1 launch report
Next morning, you wake up to a Slack DM: "*Add CSV export to admin
users* — Day 1 launch report. Verdict: *landed (preliminary)*.
`users_csv_exported` firing at 23/day, error rate 0.05% (budget 0.5%).
No bug clusters."

### T+7, 14, 28 days — landing window
Daily bug triage runs. Launch reports at day 7, 14, 28. Final
verdict at day 28: `landed`. The contract's `landed: true` is
committed. Monitoring window closes. Done.

---

## 5. Medium feature variant

Same flow, longer cycle. The differences:

- **Spec phase** takes ~8 hours instead of 1, because the contract
  spans web + iOS and has 5+ behaviors that need parity specs.
- **Build phase** runs the Implementer twice in parallel — once per
  platform. The plugin opens two linked PRs and the AC coverage
  comments are split per platform.
- **Human review** is ~1 hour, not 30 minutes, because there's more
  ground to cover.
- **Canary** holds at each stage longer (4h at 10%, 8h at 50%) to
  catch cross-platform interactions.
- **Total budget**: ~72h.

Everything else is the same.

---

## 6. What happens when things go wrong

### A critic emits a blocker you can't resolve
**Common case**: regression critic flags a conflict with existing code.
**Fix**: edit the contract to resolve (clarify the interaction, or
change the approach). Mark the finding `dismissed` with a reason
*only* if the critic is wrong — and prefer to fix the contract over
dismissing.

### The Implementer's tests don't pass
**The agent iterates on its own**. It only pushes when local tests are
green. If it gets stuck (5+ iterations without progress), it posts a
comment asking the human for guidance and stops. The contract may
have a contradiction the agent couldn't resolve.
**Fix**: read the agent's last comment. Usually it identifies the
ambiguity. Update the contract, re-run `/implement`.

### Verifier says `hold` after QA deploy
Some AC failing or some event not firing.
**Fix**: read the deploy report. The Verifier files a Task back to
the Implementer with the failure detail; the Implementer iterates on
the same PR. No human re-review needed unless the failure suggests
the contract was wrong.

### Verifier says `rollback`
Critical AC fails OR error rate exceeds budget OR zero events firing.
**Fix**: revert the deploy (your normal CI process). Don't bump the
canary. Run `/postmortem <ID>` to record `landed: rolled-back`, capture
a blameless postmortem, and reopen the work — then fix the contract or
the implementation and start the build phase over. The SLA timer pauses
while you're in rollback (mark the tracking issue accordingly).

### Sentry spikes mid-canary
`rollback-guard` (running every 30 min) flips its verdict to `hold` or
`recommend-rollback` and posts a top-level Slack alert with the breached
signal and the recommended action. It does not pause or revert the
rollout itself — you assess: real regression or noise?
**Real**: flip the flag back to 0% and run `/postmortem AU-007` to
capture what happened. Don't progress to 100% until fixed.
**Noise**: hold at the current stage, then advance once the next guard
check is green again.

### Launch report says `not-landed` at day 28
The feature shipped but didn't move the metric. This is information,
not failure.
**Fix**: read the qualitative section of the report for hypotheses.
File a follow-up contract that addresses the gap. Don't quietly drop
the metric — the verdict is committed to the contract for posterity.

### A finding keeps coming back after you "fixed" it
The critic's prompt is wrong for your context. Edit the critic's
SKILL.md to be more specific to your codebase, your conventions,
or your team's definition. Skills are markdown — change them in
place. This is the *whole point* of skills being editable.

---

## 7. The skill catalog (quick reference)

### Authoring
| Skill | Purpose |
|---|---|
| `contract-new` | Five-question intake → draft contract markdown |
| `contract-verify` | Validator + relevant judgment critics; compute readiness |
| `contract-promote` | Freeze revision, start SLA, create JIRA epic + GH issue |

### Critics (run by `contract-verify`)
| Critic | What it checks |
|---|---|
| `critic-edge-cases` | Missing scenarios, state transitions, error paths |
| `critic-platform-parity` | Behaviors specified for each platform in scope |
| `critic-instrumentation` | Every behavior has an event; success metrics map to events |
| `critic-comms-completeness` | Empty/loading/success/error states + notifications |
| `critic-perf-budget` | Every behavior has explicit TTI/latency/error thresholds |
| `critic-regression` | Reads codebase; flags conflicts with existing behaviors |
| `critic-security` | Auth, PII, injection surfaces, audit logging |
| `critic-scalability` | N+1 risks, unbounded growth, hot paths, external deps |
| `critic-sizing` | Runs LAST; classifies as Small / Medium / Large |

### Agents
| Skill | Purpose |
|---|---|
| `implement` | Heavy. Reads revision, writes code + Playwright tests, opens PR |
| `verify-deployment` | Runs ACs against a live URL, samples telemetry, posts verdict |
| `launch-report` | Day 1/7/14/28 post-launch verdict with quant + qual evidence |
| `bug-triage` | Daily scan of Sentry + support + reviews; files JIRA |

---

## 8. Slash command catalog

```
/contract new "<description>"       # Start a new contract
/contract verify <ID>                # Run all critics
/contract promote <ID>               # Freeze + start SLA
/implement <ID>                      # Trigger Implementer (best run in PR comment)
/verify-pr <PR-URL>                  # Re-run AC coverage on an existing PR
/launch <ID> [--day N]               # Manual launch report for a contract
```

---

## 9. FAQ

**Q: Can I edit a contract after promote?**
Yes. Edits fork a new revision. The currently-running pipeline keeps
using its snapshot revision; the next promote uses the new state.

**Q: Can the Implementer run locally on my laptop?**
Yes (`/implement <ID>` in your editor), but the recommended pattern
is to trigger from a PR comment so the heavy work runs in CI and
your laptop is free.

**Q: What if my team uses a different test framework than Playwright?**
Edit `skills/implement/SKILL.md`. Replace the Playwright references
with your framework. The skill is markdown — that's the whole point.

**Q: What if our PRDs are 30 pages?**
The contract format is opinionated about structure. If your existing
PRDs don't fit, do the intake fresh via `/contract new` rather than
trying to import. The structure is what makes critics tractable.

**Q: Do we need all the MCPs to start?**
No. Start with GitHub + Sentry + Slack. Add Amplitude/Firebase
Analytics when you want real launch reports. Add JIRA when you want
bug auto-filing. Each addition unlocks more.

**Q: What about features that don't fit the format — research,
exploration, A/B tests?**
Those use the regular cycle. The critic-sizing skill will refuse
to size them as Small or Medium, and Large bucket exits the
pipeline. Shipline is for "we know what we want, ship it" features.

**Q: Can multiple contracts run through the pipeline at once?**
Yes. They're independent. The orchestrator handles them in parallel.
JIRA epics, tracking issues, and Slack threads are per-contract.

**Q: What if I promote a contract and then realize it's wrong?**
Update the contract, re-verify, re-promote (which forks a new
revision). The running build phase uses its snapshot, so the in-flight
work may need to be discarded — close the PR, file a new one against
the new revision.

**Q: Where do I customize critic behavior for my team?**
Each critic is a markdown SKILL.md file. Edit it. The system prompt
in the file IS the critic. Add team-specific rules, examples, or
constraints. Commit the changes to the plugin and the whole team
gets them.

**Q: How do I know if a critic is over-firing or missing things?**
Run the pipeline on 2–3 real features. Track which findings turned
out to be useful vs noise. Tighten or loosen the SKILL.md
accordingly. Critics improve with use, not with speculation.

---

## 10. Where to go next

After your first pilot completes (ideally a small feature run end to
end in 24h):

1. **Tune the critics** that over-fired or missed things on your real
   feature. Edit SKILL.md files in place.
2. **Add one missing critic** if the pilot revealed a gap not covered
   by the existing nine.
3. **Run a Medium pilot** once you trust the Small flow.
4. **Connect optional MCPs** — Amplitude/Firebase, JIRA, Figma — and
   feel each one earn its place.
5. **Don't touch Large bucket** until you've done at least 5 Small
   and 3 Medium successfully.

The whole point of Shipline being a plugin is that you can iterate on
it. Skills are markdown. Workflows are YAML. Commit and the team gets
the upgrade. Start small. Improve in flight.
