# Contributing to Manifest

Thanks for your interest in improving Manifest. This guide covers how the
project is laid out, how to run the tests, and what we look for in a pull
request.

## Prerequisites

- **Claude Code** (or Cowork) — to load and exercise the plugin
- **Node.js 18+** — the deterministic layer and its tests are plain Node
  (`node --test`), no build step or test framework to install

## Setup

```bash
# Install the validator's only dependency (js-yaml)
cd scripts && npm install

# Run the full eval suite from the repo root — must be green (93 tests today)
cd .. && node --test eval/*.test.mjs
```

To load your working copy as a live plugin while you iterate:

```bash
claude --plugin-dir .
```

SKILL.md edits are picked up on the next invocation; changes to
`plugin.json` / `marketplace.json` need a Claude Code restart.

## Project layout

| Path | What lives here |
|---|---|
| `skills/*/SKILL.md` | Skills — markdown + frontmatter. The `description` field tells Claude *when* to invoke the skill, so keep it specific. |
| `commands/*.md` | Slash command definitions (`/contract`, `/implement`, …). |
| `scripts/*.mjs` | The **deterministic layer** — validator, sizing, stack detection, diagram render. Pure Node, fully unit-tested. |
| `eval/*.test.mjs` | Tests for everything in `scripts/`. Fixtures live in `eval/contracts/` and `eval/golden/`. |
| `reference/` | Specs the skills read at runtime — contract format, the shared critic protocol, per-stack toolchains. |
| `workflows/*.yml` | GitHub Actions that get copied into a target repo's `.github/workflows/`. |
| `docs/` | Human-facing planning and install docs. |

## Two-layer design (please preserve it)

Manifest deliberately splits verification into two layers:

- **Deterministic** (`scripts/`) — anything mechanical and reproducible:
  schema checks, sizing arithmetic, the readiness verdict. This is code,
  not an LLM prompt, and **the readiness verdict is never judged by an
  LLM.** Changes here require a corresponding test in `eval/`.
- **Judgment** (LLM critics) — only genuine reasoning. Critic rules are
  defined once in `reference/CRITIC-PROTOCOL.md`; critic output is
  schema-validated by the deterministic layer.

When in doubt, push logic toward the deterministic layer.

## Making a change

1. **Branch** off `main`.
2. **Add or update a test** for any change to `scripts/` — the eval suite
   must stay green (`node --test eval/*.test.mjs`).
3. **Keep commit messages conventional** — `feat:`, `fix:`, `docs:`,
   `chore:`, etc.
4. **Update `CHANGELOG.md`** and bump the `version` in both
   `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` if
   the change is user-visible.
5. **Open a PR** describing what changed and why. Note if any
   `workflows/*.yml` changed, since consumers must re-copy those into
   their own repos.

## Reporting bugs / requesting features

Open a GitHub issue with steps to reproduce (for bugs) or the problem
you're trying to solve (for features). Including the Manifest version
(from `.claude-plugin/plugin.json`) and your Claude Code version helps.

## License

By contributing, you agree that your contributions will be licensed under
the [MIT License](LICENSE).
