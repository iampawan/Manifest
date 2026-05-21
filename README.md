# Manifest

A Claude Code / Cowork plugin that takes a PRD ("contract") through the full
lifecycle — author → verify → implement → ship → land — with quality gates
that won't let an under-specified spec progress.

The contract lives as **markdown in your repo** at `.manifest/contracts/*.md`.
Critics produce findings as adjacent files. Reports are committed alongside.
Git is your audit trail; no external database required.

For the full walkthrough — mental model, day-by-day flow, recovery
playbooks — read **[GUIDE.md](GUIDE.md)**.

## Pick the right path — process proportional to risk

Manifest scales the ceremony to the change. Four tiers:

| Change | Path | Process |
|---|---|---|
| Typo, single CSS value, config flip | just edit + commit | none |
| One-line bug, copy tweak, dep bump | **`/fix`** (express lane) | triage → fix + regression test → PR; minutes |
| New behavior, 1 platform, ≤3 behaviors | **`/contract`** → Small | full pipeline, 24h SLA |
| ≤2 platforms, ≤8 behaviors, additive schema | **`/contract`** → Medium | full pipeline, 72h SLA |
| Breaking change, migration, auth/billing | **`/contract decompose`** → epic | broken into Small/Medium children; migrations human-led |

## What the full pipeline does (Small / Medium)

| Stage | What runs | Output |
|---|---|---|
| **Author** | `/contract new` (JIRA/Linear/Notion link or text) | `.manifest/contracts/<ID>.md` |
| **Verify** | `/contract verify` (validator + only the relevant judgment critics) | `.manifest/contracts/<ID>.findings.md` (+ `.findings.json`) |
| **Promote** | `/contract promote` | Frozen revision, JIRA epic, SLA timer (24h/72h) |
| **Implement** | `/implement <ID>` (PR comment, runs in CI) | PR with code + tests in the repo's stack |
| **Verify PR** | `pr-verify.yml` → `verify-pr` (AC conformance) + `code-review` (code-level defects) | coverage comment + `CR-` findings; open blockers gate merge |
| **Review→fix** | `@claude /fix-pr <ID>` (Implementer fix-mode) | findings addressed + re-pushed, bounded by `maxFixIterations` |
| **Verify deploy** | `verify-deploy.yml` (platform-aware: web/Flutter/backend) | per-AC pass/fail + canary verdict |
| **Canary guard** | `rollback-guard.yml` (every 30 min) + `/canary`, `/rollback-check` | proceed / hold / recommend-rollback + next ramp step (recommends only) |
| **Launch report** | `launch-monitor.yml` (cron, 4 weeks) | Slack DM at day 1/7/14/28 |
| **Bug watch + route** | `bug-triage` (daily) | tickets with contract refs, routed to `/fix` or `/contract` (gated) |
| **Rollback** | `/postmortem <ID>` (after a revert) | `landed: rolled-back`, blameless postmortem, reopened follow-up |

Anytime: **`/status [<ID>]`** shows phase, SLA time-left (IST + UTC),
readiness, and next action — for one contract or everything in flight.

## Sizing

The deterministic validator classifies each verified contract as
**Small (24h)**, **Medium (72h)**, or **Large**. Small and Medium use
the automated pipeline. **Large is decomposed** (via `/contract
decompose`) into a dependency-ordered sequence of Small/Medium child
contracts — Manifest doesn't refuse Large, it makes it tractable. The
truly tiny stuff goes through the `/fix` express lane (no contract at
all). See "Pick the right path" in `/manifest` or GUIDE section 1b.

## How verification works (two layers)

Verification runs in two layers, not one pile of LLM prompts:

- **Deterministic layer** (`scripts/validate.mjs`) — real code that
  checks everything mechanical: every behavior has instrumentation /
  perf budget / comms states, every behavior has an acceptance
  criterion, platforms are in scope, sizing arithmetic, and the
  readiness verdict. 100% reproducible, free (no tokens), unit-testable.
  Also validates critic output against a strict schema — out-of-schema
  severities like "high"/"medium" are rejected, not silently accepted.

- **Judgment layer** (LLM critics) — only genuine reasoning: missing
  edge cases, security analysis, scalability, cross-repo regression,
  copy quality, platform-specific UX. Bounded by `reference/CRITIC-PROTOCOL.md`
  (one shared rule definition) and schema-validated.

The readiness verdict is computed by code, never judged by an LLM. See
`reference/CRITIC-PROTOCOL.md` for the rules and `docs/RELIABILITY.md` for the full
hardening plan and what's built vs still planned.

**Requires Node + `js-yaml`** for the validator: `cd scripts && npm install`.

---

# Installation

Three ways to install Manifest depending on your situation. Pick one.

| Method | When to use | Effort |
|---|---|---|
| **A. Marketplace install** | You're trying it out and someone has already published the repo. Pull and install in two commands. | Lowest |
| **B. Direct file install** | You have the plugin folder locally (this folder you're reading from). Drop it into Claude Code's plugins directory. | Low |
| **C. Development mode** | You're authoring or modifying the plugin itself. Run from the source folder so edits are live. | Lowest for iteration |

All three work in both **Claude Code** and **Cowork mode** — user-scoped
plugins are visible in both.

---

## Method A — Marketplace install (recommended for teammates)

If the plugin author has pushed Manifest to a GitHub repo (private or
public), this is the cleanest path. Two commands:

```
/plugin marketplace add https://github.com/<your-org>/manifest
/plugin install manifest@manifest
```

Then verify:

```
/plugin                       # shows installed plugins
/manifest                     # runs the tutorial
```

**Private repos:** authentication uses your existing git credentials
(SSH keys, GitHub CLI auth). If you hit auth errors, the documented
workaround is to clone the repo locally once and install from the
local path:

```bash
git clone https://github.com/<your-org>/manifest ~/work/manifest
```

Then in Claude Code:

```
/plugin marketplace add ~/work/manifest
/plugin install manifest@manifest
```

**Updates:** Claude Code pins the commit at install time and doesn't
auto-refresh — see [Updating Manifest](#updating-manifest) below.

---

## Method B — Direct file install (recommended for first-time setup)

If you have the `manifest/` folder on your machine (e.g., you cloned
it or were handed the folder), drop it into Claude Code's plugins
directory:

```bash
# 1. Copy the plugin into Claude Code's user-scope plugins directory
cp -r manifest ~/.claude/plugins/manifest

# 2. Verify the structure — the manifest must be inside .claude-plugin/
ls ~/.claude/plugins/manifest/.claude-plugin/plugin.json
# Expected: ~/.claude/plugins/manifest/.claude-plugin/plugin.json
```

Then in Claude Code:

```
/plugin                       # confirms manifest is loaded
/manifest                     # runs the tutorial
```

Skills auto-discover from `skills/*/SKILL.md`; slash commands
(`/contract`, `/implement`, `/verify-pr`, `/code-review`, `/verify-deploy`,
`/canary`, `/rollback-check`, `/postmortem`, `/launch`, `/manifest`)
become available immediately.

---

## Method C — Development mode (for plugin authors)

If you're iterating on the plugin itself, run Claude Code with the
plugin pointed at your working folder so edits take effect without
recopying:

```bash
cd ~/path/to/manifest
claude --plugin-dir .
```

Or, if you want it loaded persistently while you develop, symlink:

```bash
ln -s ~/path/to/manifest ~/.claude/plugins/manifest
```

Edits to SKILL.md files are picked up on next invocation. Edits to
the manifest may require a Claude Code restart.

---

## Updating Manifest

Claude Code does **not** auto-update an installed plugin — it pins what
it captured at install time. Update the way that matches how you
installed (the `version` in `.claude-plugin/plugin.json` and the
[CHANGELOG](CHANGELOG.md) tell you what you're on vs. what's latest):

**Method A — Marketplace.** Refresh the marketplace, then re-install:

```
/plugin marketplace update manifest
/plugin install manifest@manifest      # re-install to pull the latest
```

Restart Claude Code if commands don't reflect the new version. For
reproducible upgrades across a team, install a tagged release rather
than tracking `main` (if the author tags releases):

```
/plugin install manifest@manifest@v0.7.0
```

**Method B — Direct file install.** Re-copy the folder over the old one,
then restart Claude Code (or `/plugin` to confirm the new version). If
you got it from git, pull first:

```bash
cd ~/path/to/manifest && git pull         # if it's a clone
cp -r manifest ~/.claude/plugins/manifest # overwrite the installed copy
```

**Method C — Development mode.** Just `git pull` in your working folder.
With `claude --plugin-dir .`, SKILL.md edits are picked up on next
invocation; changes to `plugin.json`/`marketplace.json` need a restart.
A symlinked install behaves the same.

**Don't forget the workflows.** The GitHub Actions files
(`workflows/*.yml`) are **copied into your repo's `.github/workflows/`**
at setup — they live in your repo, not the plugin, so updating the
plugin does **not** update them. After an update that changed any
workflow (the CHANGELOG will say), re-copy them:

```bash
cp ~/.claude/plugins/manifest/workflows/*.yml .github/workflows/
```

Likewise, `repos.yml` is yours once copied — diff it against
`examples/repos.yml.example` after an update to pick up new `conventions`
keys (e.g., `perfBudget`, `rolloutPlan`).

---

## Post-install: wire your project

Whichever install method you used, the next step is the same. In the
repository where you'll author contracts (typically a product repo
or a separate "specs" repo):

```bash
# 1. Make a contracts directory
mkdir -p .manifest/contracts

# 2. Copy the example repos config and edit it
cp ~/.claude/plugins/manifest/examples/repos.yml.example .manifest/repos.yml
# Edit .manifest/repos.yml — replace org/repo placeholders with yours

# 3. (Optional, for CI later) Copy the GitHub Actions workflows
cp ~/.claude/plugins/manifest/workflows/*.yml .github/workflows/

# 4. Commit
git add .manifest/ .github/workflows/
git commit -m "chore: add Manifest pipeline"
```

For the full setup — MCPs to connect, GitHub secrets, Slack channels,
choosing your pilot feature — see **[GUIDE.md section 3](GUIDE.md)**.

---

## MCPs you need to connect

These are referenced by the skills. Connect whichever you have access
to via your Claude Code MCP settings:

| MCP | Required? | What it's for |
|---|---|---|
| **GitHub** | Required | Read code across repos, open PRs, post comments |
| **Sentry** | Required | Errors, releases, performance per release |
| **Slack** | Required | Human gates, daily reports, contract threads |
| **Firebase Analytics** | Recommended | Richest source for launch-report success metrics |
| **Amplitude** | Recommended | Alternative client analytics |
| **Atlassian (JIRA)** | Recommended | Pull contracts from JIRA tickets, auto-file bugs |
| **Figma** | Optional | Design coverage check, asset reference |
| **Postgres / DB** | Optional | Fallback for record-count launch metrics |
| **Google Cloud Logging / Datadog** | Optional | Fallback for server-side event counts |

You can start with just GitHub + Slack and add the others as you
need them. The plugin gracefully degrades — if a measurement source
isn't available, launch reports use whatever fallback is.

---

## Verify your install

After installing via any method, these should work:

```
/plugin           # lists installed plugins, manifest should appear
/manifest         # opens the tutorial / welcome flow
/setup            # checks what MCPs you have connected
/skills           # auto-discovered skills
```

If `/manifest` runs and gives you the welcome tutorial, you're set.
Run `/setup` next — on first run it's an **interactive wizard** that
auto-detects your repos, frameworks, event SDKs, and test patterns,
asks only the few things it can't detect, and writes a complete
`.manifest/repos.yml` for you (no placeholders to hand-edit). On later
runs `/setup` verifies your MCPs and scopes. Then try
`/contract new "a small feature"`.

---

## Troubleshooting

**"marketplace not found"** — Check the URL points to a GitHub repo
that has `.claude-plugin/marketplace.json` at its root.

**"plugin not found after install"** — Run `/plugin` to confirm
status. If it shows installed but commands don't work, restart
Claude Code.

**Private repo auth errors** — Use the local-clone workaround:
clone the repo manually, then `/plugin marketplace add <local-path>`.

**Slash commands missing** — Confirm via `/plugin` that the plugin
is enabled (not just installed). If still missing, check that
`commands/*.md` files have proper frontmatter.

**Skills not triggering** — Each SKILL.md needs a `description` field
in frontmatter that tells Claude when to invoke it. If a skill
isn't triggering, its description may need to be more specific.

---

## Try it

Once installed:

```
/manifest                     # 3-minute tutorial
/contract new "your first feature"
```

For a comprehensive walkthrough, read **[GUIDE.md](GUIDE.md)**.

For sharing with teammates, point them at
**[docs/INSTALL-FOR-TRYERS.md](docs/INSTALL-FOR-TRYERS.md)** — a focused doc
on Method A.

---

## Files

```
manifest/
├── .claude-plugin/
│   └── plugin.json                      # manifest (Claude Code discovers from here)
│       # marketplace.json.disabled — local-source marketplace; re-enable when publishing to GitHub
├── README.md                            # this file (entry + install)
├── GUIDE.md                             # how it works, end to end
├── CHANGELOG.md                         # version history
├── reference/                           # specs the skills read at runtime
│   ├── CONTRACT-FORMAT.md               # the contract schema
│   ├── CRITIC-PROTOCOL.md               # shared rule layer (severity enum, output schema)
│   └── STACK-PROFILES.md                # per-stack toolchains — skills assume no stack
├── docs/                                # human planning docs
│   ├── RELIABILITY.md                   # hardening plan — built vs planned
│   └── INSTALL-FOR-TRYERS.md            # focused install doc for teammates
├── scripts/
│   ├── validate.mjs                     # DETERMINISTIC: checks, schema, sizing, readiness, --sla/--status/--check-*
│   ├── detect.mjs                       # DETERMINISTIC: framework/SDK/test detection per repo
│   ├── recall.mjs                       # DETERMINISTIC: scores critic findings vs the golden set
│   ├── migrate-contract.mjs             # DETERMINISTIC: reformat old contracts to the grouped layout
│   ├── render-diagram.mjs               # DETERMINISTIC: contract Mermaid → standalone viewable HTML
│   └── package.json                     # depends on js-yaml
├── eval/
│   ├── validate.test.mjs                # validator + SLA + phase + review/guard schema tests
│   ├── detect.test.mjs                  # stack-detector tests  (93 total, all green)
│   ├── recall.test.mjs                  # recall-scorer tests
│   ├── migrate.test.mjs                 # migrator tests (value/body preservation, idempotent)
│   ├── render-diagram.test.mjs          # diagram extraction/render tests
│   ├── golden/                          # expected judgment findings (recall harness)
│   └── contracts/                       # clean + seeded-gaps + judgment-gaps fixtures
├── examples/
│   ├── EX-001-saved-cards.md            # example contract
│   ├── repos.yml.example                # multi-repo configuration template
│   └── repos.pocketfm.yml               # sample config for a multi-stack product
├── skills/
│   ├── tutorial/SKILL.md                # /manifest welcome
│   ├── setup-init/SKILL.md              # /setup wizard — auto-detects + writes repos.yml
│   ├── setup-check/SKILL.md             # /setup verify — MCPs + scopes
│   ├── contract-status/SKILL.md         # /status — phase + SLA + next
│   ├── contract-new/SKILL.md            # intake (JIRA / Linear / Notion / text)
│   ├── contract-verify/SKILL.md         # two-layer orchestrator (validator → judgment critics)
│   ├── contract-promote/SKILL.md        # freeze + start SLA + Slack anchor
│   ├── contract-decompose/SKILL.md      # Large → epic of Small/Medium children
│   ├── quick-fix/SKILL.md               # /fix express lane for trivial changes
│   ├── critic-minimality/SKILL.md       # } judgment critics — all reference
│   ├── critic-edge-cases/SKILL.md       # } reference/CRITIC-PROTOCOL.md; run conditionally.
│   ├── critic-platform-parity/SKILL.md  # } minimality is the scope counterweight (always runs)
│   ├── critic-instrumentation/SKILL.md
│   ├── critic-comms-completeness/SKILL.md
│   ├── critic-perf-budget/SKILL.md
│   ├── critic-regression/SKILL.md       # multi-repo + cross-repo API tracing
│   ├── critic-security/SKILL.md
│   ├── critic-scalability/SKILL.md
│   ├── implement/SKILL.md               # the heavy agent — stack-agnostic; build + fix modes
│   ├── code-review/SKILL.md             # PR-stage code-level review (CR- findings)
│   ├── verify-deployment/SKILL.md       # platform-aware (web / Flutter / backend)
│   ├── rollback-guard/SKILL.md          # rollout-window health watch + next-ramp-step (recommends only)
│   ├── rollback-postmortem/SKILL.md     # blameless postmortem + reopen after a rollback
│   ├── launch-report/SKILL.md           # the loop-closer
│   └── bug-triage/SKILL.md
├── commands/
│   ├── manifest.md                      # /manifest welcome + reference
│   ├── setup.md                         # /setup (init wizard or verify)
│   ├── status.md                        # /status [<ID>]
│   ├── contract.md                      # /contract new|verify|promote|decompose
│   ├── fix.md                           # /fix <bug-or-change>
│   ├── implement.md                     # /implement <ID>
│   ├── verify-pr.md                     # /verify-pr <PR>
│   ├── code-review.md                   # /code-review <PR>
│   ├── verify-deploy.md                 # /verify-deploy <ID> <URL>
│   ├── rollback-check.md                # /rollback-check <ID>
│   ├── canary.md                        # /canary <ID> — current stage + next step
│   ├── postmortem.md                    # /postmortem <ID> — after a rollback
│   ├── bug-triage.md                    # /bug-triage <ID>
│   └── launch.md                        # /launch <ID>
└── workflows/
    ├── pr-verify.yml                    # PR-triggered Implementer + verify-pr + code-review + fix loop
    ├── verify-deploy.yml                # post-deploy verification + telemetry
    ├── rollback-guard.yml               # rollout-window health watch (every 30 min)
    ├── launch-monitor.yml               # 28-day landing cron
    └── eval.yml                         # runs the test suite on every change
```
