# Get & set your Figma token (2 minutes)

Design-freeze needs a **read-only** Figma token. **Only devs / CI / an admin need
this — PMs do not.** One shared read-only token for the team is fine.

## 1. Generate the token (5 clicks)

1. Go to **https://www.figma.com/settings**
2. Open the **Security** tab.
3. Under **Personal access tokens**, click **Generate new token**.
4. Name it (e.g. `ready-check`), and set scope **File content → Read-only**
   (`files:read`). Leave everything else off.
5. Click **Generate**, then **copy** the token (`figd_…`) — you can't see it again.

## 2. Set it (pick one)

**A — Claude Code (easiest for one person):**
```bash
claude mcp add figma-rest --env FIGMA_TOKEN=figd_yourtoken \
  -- node "$(pwd)/tools/figma-rest-mcp/index.mjs"
```

**B — Environment variable (works everywhere, incl. the plugin auto-register):**
```bash
# macOS/Linux — add to ~/.zshrc or ~/.bashrc, then restart the terminal/app:
export FIGMA_TOKEN=figd_yourtoken
```
```powershell
# Windows PowerShell:
setx FIGMA_TOKEN "figd_yourtoken"
```
With the token in your environment, the Manifest plugin auto-registers the
`figma-rest` connector on install — nothing else to run.

**C — CI:** add `FIGMA_TOKEN` as a secret/variable in your CI settings.

## 3. Check it works

In Claude Code, run `/mcp` — you should see **figma-rest** connected. Then ask:

> get the Figma file version for `https://www.figma.com/design/<yourFileKey>/...`

You should get back `{ version, lastModified, name }`. If you see
"FIGMA_TOKEN not set", the env var didn't load — re-check step 2 and restart the app.

## Notes

- **Read-only** is enough (`files:read`) — the token never edits your designs.
- It's a **secret**: don't commit it or paste it in shared docs. Rotate it in the
  same Security page if it leaks.
- **PMs never set this.** The design-freeze check runs dev-side at
  `/contract pickup`, where the token already lives.
