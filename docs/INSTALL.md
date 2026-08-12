# Installing Manifest — every platform

Manifest has two layers, and that's the key to installing it anywhere:

| Layer | What it is | Where it runs |
|---|---|---|
| **The gates** | `scripts/*.mjs` — plain Node, deterministic | **Anywhere**: any agent, any terminal, CI |
| **The playbooks** | `skills/`, `commands/` — markdown prompts | Richest in Claude Code / Cowork; portable via `AGENTS.md` |

A gate code minted in one tool **verifies in every other**, because it's a content
hash computed by Node — not a model judgement. So a PM on Gemini, a dev on Cursor,
and CI all agree.

> **Ready Check needs nothing installed.** `scripts/ready-check.mjs` has **zero
> dependencies** — Node 18+ and that one file is the entire PM-side gate.
> Only the contract/repo tooling (`validate.mjs`, `build-code-context.mjs`) needs
> `js-yaml` via `cd scripts && npm install`.

---

## 0. Prerequisites (all platforms)

- **Node 18+** — check with `node --version`
- **The repo** — clone once, anywhere:
  ```bash
  git clone https://github.com/iampawan/Manifest ~/work/manifest
  cd ~/work/manifest/scripts && npm install    # only needed for contract tooling
  ```

Verify the engine works before wiring up any tool:

```bash
node ~/work/manifest/scripts/ready-check.mjs --rubric
```

If that prints the 11-item Definition of Ready, you're good on every platform below.

---

## 1. Claude Code (CLI)

```
/plugin marketplace add https://github.com/iampawan/Manifest
/plugin install manifest@manifest
```

Confirm: `/plugin` lists it, `/manifest` runs the tutorial.

See [README](../README.md#installation) for direct-file and development-mode installs.

---

## 2. Claude Cowork (desktop)

1. **Customize** (left sidebar) → **Plugins** tab
2. **Browse plugins** → install Manifest, or **"+" → upload** the `.plugin` file
3. Restart Cowork so it loads
4. Run `/ready-check` once — this also creates/refreshes the sidebar panel

**Updating:** the pinned Ready Check panel is a *saved snapshot*, not a live view.
After updating the plugin, run `/ready-check` once so the skill reconciles the panel
to the new build. Hover the version chip to confirm.

For teams: distribute via an **organization marketplace** (Team/Enterprise →
Organization settings → Plugins → GitHub sync, set "Installed by default") so updates
reach everyone on their next session instead of each person re-uploading a file.

---

## 3. Cursor

Cursor reads `AGENTS.md` natively.

```bash
# from your product repo
node ~/work/manifest/scripts/build-agents-md.mjs --out ./AGENTS.md
git add AGENTS.md && git commit -m "Add Manifest AGENTS.md"
```

Open the repo in Cursor and ask: *"Run a Ready Check on this PRD: <link>"*. The agent
reads `AGENTS.md` and shells out to the same deterministic engine.

If your repo already has an `AGENTS.md`, **append** the Manifest section rather than
overwriting — generate to a temp path and merge.

Connectors (Atlassian/Figma) are reusable: Cursor speaks MCP, so point it at the same
MCP servers you use elsewhere.

---

## 4. OpenAI Codex

Same as Cursor — Codex reads `AGENTS.md` from the repo root:

```bash
node ~/work/manifest/scripts/build-agents-md.mjs --out ./AGENTS.md
```

Then ask Codex to run a Ready Check. It will use `node scripts/ready-check.mjs …`
as documented in the file.

---

## 5. Gemini CLI / Antigravity

Gemini CLI reads `AGENTS.md`. Same one-liner:

```bash
node ~/work/manifest/scripts/build-agents-md.mjs --out ./AGENTS.md
```

If your Gemini setup prefers `GEMINI.md`, generate to that name instead — the content
is identical, only the filename convention differs:

```bash
node ~/work/manifest/scripts/build-agents-md.mjs --out ./GEMINI.md
```

---

## 6. GitHub Copilot

Copilot reads `AGENTS.md` too. Install it the same way, then use Copilot Chat in the
repo. (If your org standardises on `.github/copilot-instructions.md`, generate a copy
there as well — same content.)

---

## 7. Windsurf · Aider · Zed

All three read `AGENTS.md`. One command, no per-tool config:

```bash
node ~/work/manifest/scripts/build-agents-md.mjs --out ./AGENTS.md
```

---

## 8. CI (GitHub Actions, any runner)

No AI involved — the gates are just Node, which is the point:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: '20' }

# Refuse a PR whose ticket has no valid Ready Check hand-off
- run: node scripts/ready-check.mjs --verify handoff.txt

# Keep AGENTS.md in sync with the engine
- run: node scripts/build-agents-md.mjs --check
```

Exit codes: `0` valid/ready · `1` stale/not-ready · `2` input error or unverifiable.

Manifest also ships workflow templates in `workflows/` (PR verify, deploy verify,
rollback guard, launch monitor) — copy the ones you want into `.github/workflows/`.

---

## 9. No AI tool at all

Open **`gate/prd-readiness-gate.html`** in any browser. Same 11 items, same gate-code
algorithm, no install, no network, no account. A code minted there verifies
everywhere else.

This is the floor — nobody is blocked from clearing the gate.

---

## Keeping `AGENTS.md` current

It's **generated**, not hand-maintained — from the engine's rubric and the plugin
version, so it can't drift:

```bash
node scripts/build-agents-md.mjs           # regenerate
node scripts/build-agents-md.mjs --check   # exit 1 if stale (use in CI)
```

Regenerate after upgrading Manifest, and re-commit it in each repo where it lives.

---

## Verifying your install

Works on every platform:

```bash
node scripts/ready-check.mjs --rubric                  # the 11 items
node scripts/ready-check.mjs --scorecard answers.json  # a real scorecard
node scripts/ready-check.mjs --verify handoff.txt      # VALID / STALE / INVALID
```

If `--rubric` prints and `--verify` returns `VALID` on a known-good hand-off, the
install is correct — regardless of which tool you're driving it from.
