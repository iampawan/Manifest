---
name: setup
description: Check what MCPs and config Shipline needs that aren't yet connected. Tells you what's wired, what's missing, and what each gap would unlock. Run this first time you install, or any time something feels off.
---

# /setup (alias: /shipline setup)

Configure or check your Shipline setup. Behaves differently based on
whether you've set up yet:

- **No `.shipline/repos.yml` yet** → runs the **setup-init** wizard:
  auto-detects your repos, frameworks, event SDKs, and test patterns,
  asks only what it can't detect, and writes a complete config. Zero
  placeholders to hand-edit.
- **`.shipline/repos.yml` exists** → runs the **setup-check** verifier:
  reports which MCPs are connected, which scopes are granted, and what
  each gap would block.

## Usage

```
/setup                # auto-routes: init if unconfigured, check if configured
/setup init           # force the detection wizard (re-run to add repos)
/setup check          # force the verifier
/shipline setup       # same as /setup
```

## The init wizard (first run)

1. Discovers your repos (from a code-index MCP, or asks you).
2. Auto-detects per repo: framework, languages, event SDK, test
   framework, where API calls live, and (for backends) which route
   prefixes they own.
3. Infers cross-repo API links (which frontend calls which backend).
4. Asks ONLY the handful of things it can't detect — e.g., native-vs-
   Flutter convention, a missing backend repo, your Slack channel.
5. Writes a complete `.shipline/repos.yml` and creates
   `.shipline/contracts/`.
6. Verifies MCPs + scopes.
7. Summarizes and points you at `/contract new`.

## The check verifier (later runs)

Reports MCP connection status, scope gaps mapped to the commands they'd
break, and project-config gaps. See the table it prints for what to
connect next.

## What it checks

**MCPs (required, recommended, optional):**
- GitHub (required — code + PR access)
- Sentry (required — errors + releases)
- Slack (required — human gates + daily reports)
- Firebase Analytics / Amplitude (recommended — launch metrics)
- Atlassian / JIRA (recommended — pull contracts from tickets)
- Figma (optional — design coverage)
- DB / Cloud Logging (optional — server-side metric fallbacks)

**Local project config:**
- Is `.shipline/contracts/` a directory?
- Is `.shipline/repos.yml` present and pointing at your repos?
- Are the GitHub Actions workflow files in `.github/workflows/`?

**Output:** a status table grouped by tier, plus ONE recommended
next action.

## When to run

- **First install** — confirms the plugin loaded and points at the
  first action.
- **After connecting a new MCP** — verifies it's discoverable to
  Shipline.
- **Before sharing the plugin with teammates** — gives you a snapshot
  to hand off (e.g., "you need these 3 MCPs to run it").
- **When something's failing weirdly** — usually the answer is "an
  MCP you need isn't connected and the skill quietly fell back."

## Example output

```
🛠  Shipline setup check
━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED
✅ GitHub MCP    — connected
✅ Sentry MCP    — connected
❌ Slack MCP     — not connected
   → Without it: no team-facing notifications

RECOMMENDED
✅ Firebase Analytics — connected
❌ Atlassian MCP      — not connected
   → Without it: can't pull contracts from JIRA URLs

━━━━━━━━━━━━━━━━━━━━━━━━

What you can do right now:
✅ Author from free-text, run critics, run Implementer in CI
❌ No Slack notifications (please connect)
⚠️ /contract new <jira-url> won't work (falls back to free-text)

Next step: Connect the Slack MCP, then /contract new "<a small feature>"
```
