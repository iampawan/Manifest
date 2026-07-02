# Ready Check — Setup & Getting Started

Ready Check is the 2-minute check a PM runs on a PRD **before** it goes to dev,
so engineering never has to chase you for basics. This guide has two parts:

- **[For PMs](#for-pms)** — how to use it. Almost no setup.
- **[For the admin / lead](#for-the-admin--lead)** — the one-time technical setup
  (plugin, connectors, token). Do this once for the whole team.

---

## For PMs

**You don't install anything.** Once your admin has set it up (below), you have
two ways to use it — pick whichever you like.

### Option A — the panel (nicest)

1. In **Cowork**, open the **Ready Check** panel from the sidebar.
   (Not there yet? Type `/ready-check panel` once and it appears.)
2. **Paste your PRD** — plain text, or a **JIRA / Confluence link** (it fetches
   the page for you). **No PRD yet?** Click **✨ Only have an idea?** and describe
   the feature in a sentence — it drafts a starter PRD skeleton for you to refine.
3. Click **Check my PRD**. Claude fills what your PRD genuinely covers (real
   answers, not keywords), lists what's missing or vague, and the **readiness
   score** ring shows how close you are.
4. **Fix the flagged items** (click a finding to jump to that field). Not sure
   what a strong answer looks like? Hit **Playbook** (top-right) or **"see
   example"** under any field for a good-vs-weak comparison. Can't answer one?
   Tick **"Can't provide — waive with a reason."**
5. When it says **Ready**, either:
   - **Copy hand-off** → paste into the JIRA ticket / dev Slack thread, or
   - **Generate PRD → Publish** → writes a clean PRD to your JIRA/Confluence.

   The hand-off unlocks **only** after the smart review passes with **no open
   blockers** — and editing any answer re-locks it until you re-check. That's the
   point: a green pass means it's genuinely ready, not just filled in.

The header **status dot** shows green when the panel's live (smart review on) and
red if it's opened outside Cowork.

### Option B — in chat

Type this in Cowork or Claude Code:

```
/ready-check <paste a JIRA / Notion / Doc / Figma link, or describe the feature>
```

It asks the plain questions, flags the gaps, and gives you the same hand-off.
Best when you just have a link — chat can fetch almost anything.

### That's the whole job

Answer the questions honestly. Green = your PRD has the basics and dev can
start. The dev never has to come back asking "what happens on error?" or "where's
the design?" — because the check already made sure it's there.

**Tip:** the metric should be a number with a timeframe ("+6% in 4 weeks"), and
always attach the **design link**. Those are the two most-missed items.

---

## For the admin / lead

One-time setup. ~15 minutes. After this, PMs just open the panel.

### 1. Install the plugin

In Claude Code or Cowork:

```
/plugin marketplace add https://github.com/iampawan/Manifest
/plugin install manifest@manifest
```

This gives everyone `/ready-check`. (Updating later? `/plugin marketplace update
manifest` then reinstall — Cowork caches the old version otherwise, and a restart
helps.)

### 2. Connect the connectors (enables fetch + publish)

In **Cowork → connector settings**, authorize:

- **Atlassian** — lets the panel fetch JIRA issues & Confluence pages, and
  publish PRDs back. Without it, PMs can still paste text; links just won't fetch.
- **Figma (REST)** — for the design-freeze **and the design audit** (see step 4).
  Note: the audit (missing mobile/web frames, missing error/empty/loading screens,
  placeholder copy) runs in **chat** (`/ready-check <figma-link>`) or dev-side
  `/contract pickup`, not in the sidebar panel — the panel is a sandbox and can't
  reach a local connector. Optional.

### 3. Give PMs the panel

The panel is per-user, so each PM runs `/ready-check panel` once (it creates it
in their Cowork). Or tell them "type `/ready-check panel`." When they do, the
skill also lists any connectors they still need to authorize.

### 4. (Optional) Figma design-freeze

The design-freeze needs the **Figma REST API**, which the official Figma
(Dev Mode) connector doesn't expose — so we ship a tiny, **dependency-free** REST
connector. It's bundled in the plugin (`tools/figma-rest-mcp/`) and declared in
`.claude-plugin/plugin.json` — **no `npm install`, no publish**.

1. **Get a token** (2-minute step-by-step: **[FIGMA-TOKEN.md](FIGMA-TOKEN.md)**):
   Figma → Settings → Security → *Personal access tokens* → generate with
   **`files:read`**. (https://www.figma.com/settings)
2. **Set `FIGMA_TOKEN=figd_…`** in the environment of whoever runs the dev-side
   freeze check (a dev, CI, or one shared read-only token). Installing the
   plugin auto-registers `figma-rest`; it starts when the token is present.
3. **PMs never need a Figma token** — the design-freeze runs dev-side at pickup,
   not in the PM's panel.

Test directly if you like:
`claude mcp add figma-rest --env FIGMA_TOKEN=figd_… -- node "$(pwd)/tools/figma-rest-mcp/index.mjs"`

### 5. Dev side — enforce the gate

Tell devs: **no gate code, no grooming.** When they run `/contract pickup
<ticket>`, it verifies the Ready Check code automatically and refuses an unready
PRD. Nothing extra for them to run.

**Quick manual check.** A dev can also open the panel's **Verify** button
(top-right), paste the hand-off the PM sent, and get an instant verdict:
*authentic* (the code matches the answers), *tampered/edited* (it was changed
after clearing), *not ready*, or *invalid*. In the PRD field, paste **the JIRA /
Confluence link** (not just text) — Verify fetches the live doc and checks both
the **source version** (drift → *Source changed since sign-off*) and the
**content hash** (*PRD content unchanged / changed*). Same freeze check as
`/contract pickup`, in one click.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Cowork shows an old plugin version | `/plugin marketplace update manifest` → reinstall → restart Cowork. Claude Code and Cowork cache separately. |
| "Couldn't fetch that ticket/page" | Authorize the **Atlassian** connector; confirm you can access that project/space. Or paste the text. |
| Pasted a link, nothing happens | Paste the **page text** if it's not a JIRA/Confluence link, or use `/ready-check <link>` in chat (chat fetches more). |
| "Check my PRD" does nothing on re-run | Reload the panel (it self-updates to the latest build). |
| Hand-off won't appear / stamp says NEEDS REVIEW or RE-REVIEW NEEDED | The gate needs a smart review of the **current** answers. Click **Check my PRD**; if you edited an answer after the last review, run it again. BLOCKERS OPEN means clear the flagged blockers first. |
| Status dot is red | The panel is open outside Cowork, so the smart review is off. The checklist and gate still work; open it from the Cowork sidebar for the full experience. |
| Figma design not validating | The **Dev Mode** Figma connector can't do it — you need the **Figma REST** connector from step 4 with a `files:read` token. |
| Panel not in the sidebar | Run `/ready-check panel` once; it creates it. |

---

## What's what (reference)

- **`/ready-check`** — the PM command (chat).
- **Ready Check panel** — the Cowork sidebar app (`gate/ready-check-cowork.html`).
  Header tools: **Playbook** (good-vs-weak per field) and **Verify** (dev-side
  pass check).
- **Offline web page** — `gate/prd-readiness-gate.html`, works in any browser
  (deterministic checklist only — no smart review).
- **`reference/READY-CHECK-RUBRIC.md`** — the 11-item Definition of Ready.
- **`/contract pickup`** — the dev-side deep pass that verifies the gate code.
