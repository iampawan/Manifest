# Shipline

A Claude Code / Cowork plugin that takes a PRD ("contract") through the full
lifecycle — author → verify → implement → ship → land — with quality gates
that won't let an under-specified spec progress.

The contract lives as **markdown in your repo** at `.shipline/contracts/*.md`.
Critics produce findings as adjacent files. Reports are committed alongside.
Git is your audit trail; no external database required.

For the full walkthrough — mental model, day-by-day flow, recovery
playbooks — read **[GUIDE.md](GUIDE.md)**.

## What this plugin does

| Stage | What runs | Output |
|---|---|---|
| **Author** | `/contract new` | `.shipline/contracts/<ID>.md` |
| **Verify** | `/contract verify` (runs 9 critics in parallel) | `.shipline/contracts/<ID>.findings.md` |
| **Promote** | `/contract promote` | Frozen revision, JIRA epic, SLA timer |
| **Implement** | `/implement <ID>` (in PR comment, runs in CI) | PR with code + Playwright tests |
| **Verify PR** | `pr-verify.yml` workflow | AC coverage comment on PR |
| **Verify deploy** | `verify-deploy.yml` workflow | Playwright vs live URL |
| **Launch report** | `launch-monitor.yml` (cron, 4 weeks) | Slack DM at day 1/7/14/28 |

## Sizing

A `critic-sizing` skill classifies each verified contract as **Small (24h)**,
**Medium (72h)**, or **Large (normal cycle)**. Only Small and Medium use the
automated pipeline; Large stays out.

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

Three ways to install Shipline depending on your situation. Pick one.

| Method | When to use | Effort |
|---|---|---|
| **A. Marketplace install** | You're trying it out and someone has already published the repo. Pull and install in two commands. | Lowest |
| **B. Direct file install** | You have the plugin folder locally (this folder you're reading from). Drop it into Claude Code's plugins directory. | Low |
| **C. Development mode** | You're authoring or modifying the plugin itself. Run from the source folder so edits are live. | Lowest for iteration |

All three work in both **Claude Code** and **Cowork mode** — user-scoped
plugins are visible in both.

---

## Method A — Marketplace install (recommended for teammates)

If the plugin author has pushed Shipline to a GitHub repo (private or
public), this is the cleanest path. Two commands:

```
/plugin marketplace add https://github.com/<your-org>/shipline
/plugin install shipline@shipline
```

Then verify:

```
/plugin                       # shows installed plugins
/shipline                     # runs the tutorial
```

**Private repos:** authentication uses your existing git credentials
(SSH keys, GitHub CLI auth). If you hit auth errors, the documented
workaround is to clone the repo locally once and install from the
local path:

```bash
git clone https://github.com/<your-org>/shipline ~/work/shipline
```

Then in Claude Code:

```
/plugin marketplace add ~/work/shipline
/plugin install shipline@shipline
```

**Updates:** Claude Code captures the commit hash at install time and
doesn't auto-refresh. When the plugin author pushes a new version:

```
/plugin marketplace update shipline
/plugin install shipline@shipline     # re-install to pull the latest
```

---

## Method B — Direct file install (recommended for first-time setup)

If you have the `shipline/` folder on your machine (e.g., you cloned
it or were handed the folder), drop it into Claude Code's plugins
directory:

```bash
# 1. Copy the plugin into Claude Code's user-scope plugins directory
cp -r shipline ~/.claude/plugins/shipline

# 2. Verify the structure — the manifest must be inside .claude-plugin/
ls ~/.claude/plugins/shipline/.claude-plugin/plugin.json
# Expected: ~/.claude/plugins/shipline/.claude-plugin/plugin.json
```

Then in Claude Code:

```
/plugin                       # confirms shipline is loaded
/shipline                     # runs the tutorial
```

Skills auto-discover from `skills/*/SKILL.md`; slash commands
(`/contract`, `/implement`, `/verify-pr`, `/launch`, `/shipline`)
become available immediately.

---

## Method C — Development mode (for plugin authors)

If you're iterating on the plugin itself, run Claude Code with the
plugin pointed at your working folder so edits take effect without
recopying:

```bash
cd ~/path/to/shipline
claude --plugin-dir .
```

Or, if you want it loaded persistently while you develop, symlink:

```bash
ln -s ~/path/to/shipline ~/.claude/plugins/shipline
```

Edits to SKILL.md files are picked up on next invocation. Edits to
the manifest may require a Claude Code restart.

---

## Post-install: wire your project

Whichever install method you used, the next step is the same. In the
repository where you'll author contracts (typically a product repo
or a separate "specs" repo):

```bash
# 1. Make a contracts directory
mkdir -p .shipline/contracts

# 2. Copy the example repos config and edit it
cp ~/.claude/plugins/shipline/examples/repos.yml.example .shipline/repos.yml
# Edit .shipline/repos.yml — replace org/repo placeholders with yours

# 3. (Optional, for CI later) Copy the GitHub Actions workflows
cp ~/.claude/plugins/shipline/workflows/*.yml .github/workflows/

# 4. Commit
git add .shipline/ .github/workflows/
git commit -m "chore: add Shipline pipeline"
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
/plugin           # lists installed plugins, shipline should appear
/shipline         # opens the tutorial / welcome flow
/setup            # checks what MCPs you have connected
/skills           # auto-discovered skills (17 of them)
```

If `/shipline` runs and gives you the welcome tutorial, you're set.
Run `/setup` next — on first run it's an **interactive wizard** that
auto-detects your repos, frameworks, event SDKs, and test patterns,
asks only the few things it can't detect, and writes a complete
`.shipline/repos.yml` for you (no placeholders to hand-edit). On later
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
/shipline                     # 3-minute tutorial
/contract new "your first feature"
```

For a comprehensive walkthrough, read **[GUIDE.md](GUIDE.md)**.

For sharing with teammates, point them at
**[docs/INSTALL-FOR-TRYERS.md](docs/INSTALL-FOR-TRYERS.md)** — a focused doc
on Method A.

For demo strategy and stakeholder-convincing plans, read
**[docs/MVP-PLAN.md](docs/MVP-PLAN.md)**.

---

## Files

```
shipline/
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
│   ├── MVP-PLAN.md                      # demo + rollout strategy
│   ├── RELIABILITY.md                   # hardening plan — built vs planned
│   └── INSTALL-FOR-TRYERS.md            # focused install doc for teammates
├── scripts/
│   ├── validate.mjs                     # DETERMINISTIC layer (mechanical checks + schema validation)
│   ├── detect.mjs                       # DETERMINISTIC stack detection (framework/SDK/test per repo)
│   └── package.json                     # depends on js-yaml
├── eval/
│   ├── validate.test.mjs                # 13 tests for the validator
│   ├── detect.test.mjs                  # 16 tests for the detector
│   └── contracts/                       # golden contracts (clean + seeded-gaps)
├── examples/
│   ├── EX-001-saved-cards.md            # example contract
│   ├── repos.yml.example                # multi-repo configuration template
│   └── repos.pocketfm.yml               # sample config for a multi-stack product
├── skills/
│   ├── tutorial/SKILL.md                # /shipline welcome
│   ├── setup-check/SKILL.md             # /setup — verify MCPs + config
│   ├── contract-new/SKILL.md            # intake (JIRA / Linear / Notion / text)
│   ├── contract-verify/SKILL.md         # two-layer orchestrator (validator → judgment critics)
│   ├── contract-promote/SKILL.md        # freeze + start SLA
│   ├── critic-edge-cases/SKILL.md       # } judgment critics — all reference
│   ├── critic-platform-parity/SKILL.md  # } CRITIC-PROTOCOL.md for severity + schema
│   ├── critic-instrumentation/SKILL.md
│   ├── critic-comms-completeness/SKILL.md
│   ├── critic-perf-budget/SKILL.md
│   ├── critic-regression/SKILL.md       # multi-repo + API tracing via GitHub MCP
│   ├── critic-security/SKILL.md
│   ├── critic-scalability/SKILL.md
│   ├── critic-sizing/SKILL.md           # (mostly handled by validator now)
│   ├── implement/SKILL.md               # the heavy agent
│   ├── verify-deployment/SKILL.md       # platform-aware (web / Flutter / backend)
│   ├── launch-report/SKILL.md           # the loop-closer
│   └── bug-triage/SKILL.md
├── commands/
│   ├── shipline.md                      # /shipline welcome + reference
│   ├── setup.md                         # /setup
│   ├── contract.md                      # /contract new|verify|promote
│   ├── implement.md                     # /implement <ID>
│   ├── verify-pr.md                     # /verify-pr <PR>
│   ├── verify-deploy.md                 # /verify-deploy <ID> <URL>
│   ├── bug-triage.md                    # /bug-triage <ID>
│   └── launch.md                        # /launch <ID>
└── workflows/
    ├── pr-verify.yml                    # PR-triggered Implementer + verifier
    ├── verify-deploy.yml                # post-deploy verification + telemetry
    └── launch-monitor.yml               # 28-day landing cron
```
