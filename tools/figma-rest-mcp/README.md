# figma-rest-mcp

The small piece Figma doesn't ship: a **REST** MCP that exposes a design's
**version** and **exports** — the plumbing Ready Check needs to *freeze a design*
at sign-off and detect drift. (Figma's official MCP is Dev Mode: screenshots and
code from an open desktop file, no file version.)

**A single file, zero dependencies.** `index.mjs` is raw JSON-RPC over stdio
using Node 18+ built-ins only (one import: `node:readline`). No `package.json`,
no `npm install`, no publish — it ships with the Manifest plugin (git) and runs
straight from disk via `node index.mjs`. ("Node-based" just means the runtime is
Node, which is unavoidable for any JS MCP and needs no install/publish.)

Four tools:

- `get_file_version(file)` → `{ version, lastModified, name }` — pin at sign-off.
- `list_versions(file)` → named version history (immutable snapshots).
- `export_node(file, nodeId, format)` → an image URL — the frozen visual.
- `audit_design(file)` → `{ platforms, states, placeholders, screens, findings }`
  — design-readiness gaps: platform coverage (mobile/tablet/desktop by frame
  width), which UI states exist (empty/loading/error/success by frame name), and
  placeholder copy (lorem/TODO/xxx). Powers Ready Check's design audit.

`file` accepts a Figma URL or a raw file key; `nodeId` accepts `1:2` or a URL
with `node-id`.

## Setup

The **only** thing each user needs is a read-only Figma token:

1. **Get a token** — Figma → Settings → Security → *Personal access tokens* →
   generate with **`files:read`**. (https://www.figma.com/settings)
2. **Set it once** in your environment: `FIGMA_TOKEN=figd_…`.

That's it. Because the connector is declared in the Manifest plugin
(`.claude-plugin/plugin.json → mcpServers.figma-rest`), installing the plugin
registers it automatically — it starts when `FIGMA_TOKEN` is present.

**Who needs the token?** Only whoever runs the design-freeze / dev-side pickup
(a dev, CI, or an admin's shared read-only token). **PMs never need it.**

### Test it directly (optional)

```bash
claude mcp add figma-rest --env FIGMA_TOKEN=figd_… -- node "$(pwd)/tools/figma-rest-mcp/index.mjs"
```

Then ask Claude: *"get the Figma file version for <your figma url>"*.

## Wiring into Ready Check (v0.22 design-freeze)

Its tools appear as `mcp__figma-rest__get_file_version`, etc. Then:

- **Panel:** set `FIGMA_MCP = 'mcp__figma-rest__'` at the top of
  `gate/ready-check-cowork.html` and declare the tools in `mcp_tools`.
- **At clear:** capture `design.version` (+ export a snapshot) into the freeze
  stamp alongside `prdHash`.
- **At `/contract pickup`:** re-read `get_file_version`; if the version advanced
  past the pin, `verifyFreeze` returns `stale-source` (design changed after
  sign-off).

## Note

The Figma calls are untested against a live token in this repo (the protocol
layer is smoke-tested). First run, confirm `get_file_version` returns a `version`
for one of your files.
