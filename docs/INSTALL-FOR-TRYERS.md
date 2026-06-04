# Install Manifest (for teammates trying it out)

Two commands. Targeted at someone who just wants to install and try.

## Prerequisites

- Claude Code installed (any plan — your existing subscription auth
  is sufficient for trying it interactively)
- GitHub MCP connected in your Claude Code (for the regression
  critic to scan code across repos)

## Install

```bash
# 1. Add the Manifest marketplace
/plugin marketplace add https://github.com/iampawan/Manifest

# 2. Install the plugin
/plugin install manifest@manifest

# 3. Verify
/plugin
```

You should see `manifest` listed as installed. Skills auto-discover
from `skills/*/SKILL.md`; slash commands (`/contract`, `/implement`,
`/verify-pr`, `/launch`) become available immediately.

For Cowork users: same install, same plugin. User-scoped plugins are
visible in both Claude Code and Cowork mode.

## First-run setup

In whichever directory you'll author contracts (typically the root of
a product repo, or a separate "specs" repo):

```bash
# Make a contracts directory
mkdir -p .manifest/contracts

# Tell the regression critic about your repos
cp ~/.claude/plugins/manifest/examples/repos.yml.example .manifest/repos.yml
# Then edit .manifest/repos.yml — replace the org/repo names with yours
```

## Try it

Two entry points to pick from, depending on where the PRD already
lives:

**Option A — you're the author / co-author.** No PRD yet, just an
idea or a JIRA link:

```
/contract new "A small real feature from your backlog"
```

The intake skill asks five questions and produces a draft contract
in `.manifest/contracts/<ID>.md`. Then:

```
/contract verify <ID>
```

This runs the critics in parallel and writes a findings file next to
the contract. You'll see what got caught and which gates aren't yet
green.

**Option B — you're a dev and your PM already wrote the PRD somewhere
else** (0.18 beta). Paste any source — JIRA URL, Google Doc, Slack
message link, Notion page, or just paste the text:

```
/contract pickup https://your-org.atlassian.net/browse/ENG-1234
```

The agent fetches the PRD, runs the critics, and sorts every gap
into three buckets you can act on in minutes — auto-fill from code,
dev decides, only PM can answer. Questions to your PM go out as one
batched JIRA comment / Slack reply in your voice — PM stays in their
tool. Opt in per repo in `.manifest/repos.yml`:

```yaml
pickup:
  enabled: true
  identifyAgent: true
  defaultChannel: jira
```

See [GUIDE.md section 1g](../GUIDE.md#1g-pickup-flow--when-the-pm-authored-elsewhere-018-beta)
for the full walkthrough.

## Updates

When a new version is published:

```bash
/plugin marketplace update manifest
/plugin install manifest@manifest   # re-install to pull the latest
```

(Claude Code doesn't auto-update plugins by default; the re-install
pattern is the canonical way to refresh.)

## If installation fails

- **"marketplace not found"**: check the URL — must be a GitHub repo
  that contains `.claude-plugin/marketplace.json` at its root.
- **Private repo, auth errors**: easiest workaround is to clone
  locally and install from the local path: `/plugin marketplace add
  /path/to/local/clone`
- **Slash commands not showing**: run `/plugin` and confirm the
  plugin is enabled. Restart Claude Code if needed.

## What to do next

Read [`GUIDE.md`](GUIDE.md) for the full walkthrough. The single
highest-value first move is the "retrospective comparison" pattern
— run the critics against a recently-shipped feature's PRD and show the
bugs they would have caught at spec time.
