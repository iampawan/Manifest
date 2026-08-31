# Manifest MCP

Manifest's deterministic core and lifecycle playbooks over MCP.

It has two transports:

- **stdio** for an agent running on a developer laptop;
- **Streamable HTTP** for one PocketFM-hosted endpoint shared by the organization.

Both expose the same tools, resources, and prompts. The tools accept content
payloads instead of assuming they can read a developer's checkout, so the HTTP
server is stateless and safe to run centrally.

## What it exposes

- Ready Check: evaluate, mint/verify handoffs, freeze verification, content hash,
  PRD/addendum rendering, code-context checks, ledger, and epic rollup;
- Contracts: deterministic validation, status, safe in-memory migration, and
  Mermaid HTML rendering;
- Setup/evals: stack detection, recall scoring, and stability scoring;
- Manifest commands, skills, and reference documentation as MCP resources;
- one MCP prompt for every Manifest command.

External actions are intentionally not hidden inside this server. Jira/GitHub
writes, code edits, deployment, and production monitoring are performed by the
connected agent using Manifest's skills and that agent's approved connectors.
That keeps credentials and write approval on the user's laptop or agent host.

## Local stdio

No MCP-specific install is required. Ready Check is dependency-free. Contract
tools additionally need the repository's existing validator dependency:

```bash
cd scripts && npm install
node tools/manifest-mcp/server.mjs
```

Example project-level `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "manifest": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/Manifest/tools/manifest-mcp/server.mjs"
      ]
    }
  }
}
```

The root `plugin.json` and `mcp.json` implement Agent Plugins 1.0, so compatible
agents can install the repository as one portable plugin. Cursor also reads
`.cursor-plugin/plugin.json`, which adds Manifest's commands to its discovered
skills and MCP server.

## Shared HTTP endpoint

Run locally:

```bash
MANIFEST_MCP_TOKEN="replace-me" \
  node tools/manifest-mcp/server.mjs --http
```

Defaults:

- MCP: `http://127.0.0.1:7337/mcp`
- health: `http://127.0.0.1:7337/health`

To bind outside localhost, a bearer token is mandatory:

```bash
MANIFEST_MCP_HOST=0.0.0.0 \
MANIFEST_MCP_PORT=8080 \
MANIFEST_MCP_TOKEN="a-long-random-secret" \
  node tools/manifest-mcp/server.mjs --http
```

Cursor remote configuration:

```json
{
  "mcpServers": {
    "manifest": {
      "url": "https://manifest-mcp.pocketfm.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MANIFEST_MCP_TOKEN}"
      }
    }
  }
}
```

The checked-in Dockerfile expects the repository root as build context:

```bash
docker build -f tools/manifest-mcp/Dockerfile -t pocketfm/manifest-mcp .
docker run --rm -p 8080:8080 \
  -e MANIFEST_MCP_TOKEN="a-long-random-secret" \
  pocketfm/manifest-mcp
```

Put TLS and PocketFM identity/auth in front of it before organization-wide use.
A static bearer token is suitable for an internal pilot, not the final identity
model.

## Test

```bash
node --test tools/manifest-mcp/server.test.mjs
```
