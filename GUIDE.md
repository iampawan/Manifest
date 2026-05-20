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
├── SC-005.findings.md                     # critic output
├── SC-005.implementation-plan.md          # implementer's plan
├── SC-005.deploy-qa-2026-05-19T10:00.md   # verifier reports per env
├── SC-005.launch-report-day1.md           # post-launch reports
├── SC-005.launch-report-day7.md
├── SC-005.launch-report-day14.md
├── SC-005.launch-report-day28.md
└── SC-005.bug-log.md                      # cumulative bug findings
```

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
plans the changes, writes code + Playwright tests, iterates until
local tests pass, and pushes commits to your PR. On completion, it
posts an AC coverage comment.

A human reviewer looks at the PR — usually about 30 minutes for a
small contract — and merges. The reviewer's job is "does this look
sane," not "did the tests pass" (they did) and not "does it match
the spec" (the AC coverage comment shows that).

### ③ SHIP — deploy and canary
Where: GitHub Actions and your hosting provider.

Merging to main triggers `verify-deploy.yml`. The Verifier agent
runs the same Playwright suite against the deployed QA URL,
samples telemetry from Sentry and Amplitude, and posts a verdict:
`ready-for-canary | hold | rollback`.

If ready, you get a Slack ping asking you to approve canary start.
You click. Remote Config (or your flag system) rolls out 1% → 10%
→ 50% → 100% with the orchestrator watching Sentry and pausing on
breach. Manual rollback in v1; auto-rollback in v2 once telemetry
confidence is high.

### ④ LAND — monitor and verify
Where: the `launch-monitor.yml` cron in GitHub Actions.

Every day for 28 days, the cron runs. The Launch Monitor reads
telemetry, errors, and qualitative signals (support tickets, app
store reviews, Slack channels if connected) and computes a verdict
against the contract's success metrics. Reports land in Slack at
day 1, 7, 14, and 28. At day 28, the final verdict — `landed |
partial | not-landed | rolled-back` — is committed to the contract
and the monitoring window closes.

The Bug Watcher runs daily alongside, looking for new error
clusters and filing JIRA tickets with contract back-references.

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
Remote Config bumps the flag: 1% → 10% → 50% → 100%. The
orchestrator watches Sentry every 30 minutes. No breach. Goes to
100% by T+18:00.

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
canary. Read the failure, fix the contract or the implementation,
and start the build phase over. The SLA timer pauses while you're
in rollback (mark the tracking issue accordingly).

### Sentry spikes mid-canary
The orchestrator pauses the rollout and posts to Slack. You assess:
real regression or noise?
**Real**: roll the flag back to 0% (manual in v1). Don't progress to
100% until fixed.
**Noise**: resume the rollout from Slack with a one-click.

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
| `contract-verify` | Orchestrate 9 critics in parallel, compute readiness |
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
