---
name: verify-pr
description: Verify a PR satisfies its referenced contract's acceptance criteria. Reads the diff, the contract, and the test output; posts a structured review comment.
---

# /verify-pr <URL-or-number>

Lightweight PR verification — runs the **verify-deployment** skill in
"static" mode (against the PR diff, not a deployed URL).

## Usage

```
/verify-pr 123
/verify-pr https://github.com/<org>/<repo>/pull/123
```

## What it does

1. Fetches the PR via GitHub MCP.
2. Reads the contract ID from the PR title or body (formats:
   `[SC-005]`, `Closes #issue-with-contract`, or branch name prefix).
3. Loads the contract revision.
4. For each AC, checks:
   - Is there a Playwright test referencing this AC?
   - Did the test pass in the latest CI run?
5. Looks for things the contract requires but the diff doesn't add:
   - Instrumentation events not fired in code
   - Feature flag gate missing
   - i18n strings hardcoded
6. Posts a review comment with the coverage table and any gaps.

## When to use

- After the Implementer finishes, before human review.
- Re-runs automatically on every push to the PR (via `pr-verify.yml`).
- Manually invokable if you want to re-check a stalled PR.

## Output

A PR review comment with:
- ✅/❌ per AC
- Missing instrumentation calls
- Missing feature flag gates
- Quality nits (TODOs, console.logs, etc.)
