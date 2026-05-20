---
name: implement
description: Implement a promoted contract — write code, generate Playwright tests, iterate to green, open or update the PR.
---

# /implement <ID>

Triggers the **implement** skill against the given contract's latest
revision.

## New here?

Run `/manifest tutorial` for the 3-minute orientation before invoking
this. The Implementer is the heaviest agent in the system — it
expects a verified, promoted contract and runs for up to 8 hours.
Don't fire it casually.

## Usage

```
/implement <ID>
```

## Where to run it

Both paths invoke the same skill. Pick based on your situation.

**Locally — in your Claude Code session (recommended for pilot/MVP)**

```
/implement AUTH-1234
```

Runs the agent in your current session. You see what it's doing in
real time, can intervene if it goes sideways, can pause and resume.
Uses your existing Claude Code subscription auth — no separate token
needed. Best for:
- Demos and pilots (no CI setup required)
- Small features (1–3 hours of agent work)
- When you want full visibility / control

Caveat: your Claude Code session has to stay open while the agent
runs.

**From a PR comment — via the `pr-verify.yml` workflow (recommended for team-scale use)**

Comment on a draft PR:

```
@claude /implement AUTH-1234
```

The workflow invokes the `claude` CLI headlessly in CI. The agent
pushes commits to the PR branch. Uses a `CLAUDE_CODE_OAUTH_TOKEN`
or `ANTHROPIC_API_KEY` secret. Best for:
- Medium+ features (multi-hour agent runs)
- When the dev wants to close their laptop and walk away
- Team-wide use where many devs trigger implementations independently
- When you want every Implementer run captured in CI logs

Caveat: needs the workflow file installed in the target repo and a
secret provisioned.

## Output

- Code changes pushed to the PR branch.
- Playwright tests under `tests/<contract-id>.spec.ts` tagged with
  `@contract:<ID>` and `@ac:<ACn>`.
- AC coverage comment on the PR.

## Prerequisites

- Contract must be in `status: promoted` and have a revision file.
- Complexity must be `small` or `medium` (Large is refused).

## Examples

```
/implement SC-005
```
