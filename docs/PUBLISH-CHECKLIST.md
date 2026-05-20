# Publish checklist — ship Manifest to your team

One page. Gets you from "works on my laptop" to `/plugin install
manifest` for teammates. ~15 minutes.

## 0. Prerequisite — pick the org/repo name

You'll publish to a GitHub repo, e.g. `your-org/manifest`. Decide it
now; you'll substitute it below.

## 1. Fix the marketplace source

`.claude-plugin/marketplace.json` ships with a placeholder. Replace
`YOUR-ORG` with your real GitHub org/user:

```json
"source": "github://your-org/manifest"
```

Important: the source MUST be the `github://` form, not `"./"`. The
`"./"` local form is what triggered the earlier
"source type your Claude Code version does not support" error.

Delete the leftover `.claude-plugin/marketplace.json.disabled` (it's
inert, just tidy-up):

```bash
rm .claude-plugin/marketplace.json.disabled
```

## 2. Test locally BEFORE pushing (this is the gate)

The marketplace.json schema has changed across Claude Code versions
and errored once already — so verify on your machine first:

```bash
# From the plugin folder
cd /path/to/manifest

# 2a. Validate the manifests are well-formed JSON
cat .claude-plugin/plugin.json      | python3 -m json.tool > /dev/null && echo "plugin.json ok"
cat .claude-plugin/marketplace.json | python3 -m json.tool > /dev/null && echo "marketplace.json ok"

# 2b. Run the eval suite (deterministic layer must be green)
cd scripts && npm install && cd ..
node --test eval/validate.test.mjs eval/detect.test.mjs   # expect 30 passing

# 2c. Load it as a plugin and confirm commands appear
claude --plugin-dir .
#   then in Claude Code: /plugin   (manifest should list)
#                        /manifest (tutorial should run)
```

If `--plugin-dir` throws the "source type" error again, the
marketplace.json is the cause — temporarily rename it to
`.disabled` for local dev; it's only needed once published. Then
verify the marketplace.json format against the current docs:
https://code.claude.com/docs/en/plugin-marketplaces

## 3. Push to GitHub

```bash
cd /path/to/manifest
git init                      # if not already a repo
git add -A
git commit -m "Manifest v0.3.0"
gh repo create your-org/manifest --private --source=. --push
#   (drop --private for a public repo)
```

## 4. Tag the release

Install pins to a tag, so teammates get reproducible behavior:

```bash
git tag v0.3.0
git push origin v0.3.0
```

## 5. Teammates install (two commands)

```
/plugin marketplace add your-org/manifest
/plugin install manifest
```

Then `/setup` (runs the detection wizard) and `/manifest` (tutorial).

Hand them `docs/INSTALL-FOR-TRYERS.md` — it's the teammate-facing
version of this.

## 6. Shipping an update later

```bash
# You: bump version in plugin.json + marketplace.json, update CHANGELOG
git commit -am "Manifest v0.3.1"
git tag v0.3.1 && git push origin main v0.3.1

# Teammates:
/plugin refresh
/plugin install manifest@v0.3.1     # or re-install to get latest tag
```

Claude Code doesn't auto-update plugins — teammates re-install to pull
a new version. Announce updates (Slack) so people know to refresh.

## 7. Wire a target repo (per product repo, once)

In each repo where features get built:

```bash
mkdir -p .manifest/contracts
cp /path/to/manifest/workflows/*.yml .github/workflows/   # for CI later
# Run /setup in that repo to auto-generate .manifest/repos.yml
git add .manifest/ .github/workflows/ && git commit -m "chore: add Manifest"
```

Set the CI secret (one of):
- `CLAUDE_CODE_OAUTH_TOKEN` (subscription auth — preferred), or
- `ANTHROPIC_API_KEY`
Plus `SENTRY_AUTH_TOKEN`, analytics key, `SLACK_BOT_TOKEN`, `JIRA_API_TOKEN`
as you enable those stages.

## The one thing to double-check

The marketplace.json source format is the only piece that bit us
before and that varies by Claude Code version. Steps 2b/2c are the
gate — if `/plugin marketplace add` + `/plugin install` works for you
locally (or from the pushed repo), it'll work for teammates. If it
errors, the format needs adjusting to your Claude Code version per the
docs link in step 2; everything else in the plugin is version-stable.
