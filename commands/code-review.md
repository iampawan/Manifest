---
name: code-review
description: Review a PR diff for code-level defects (security, correctness, performance, maintainability) and post a severity-tagged review comment. Complements /verify-pr's AC-conformance check.
---

# /code-review <URL-or-number>

Runs the **code-review** skill against a PR diff. This is the
code-quality half of PR verification — it asks *"is the code sound?"*
where `/verify-pr` asks *"does it satisfy the contract?"* Both run on
the same PR; neither replaces the other.

## Usage

```
/code-review 123
/code-review https://github.com/<org>/<repo>/pull/123
```

## What it does

1. Fetches the PR diff via GitHub MCP and resolves the repo's stack
   from `repos.yml` (review is stack-appropriate).
2. Loads the contract revision so the diff is reviewed against intent.
3. Walks the diff for security, correctness, performance, and
   maintainability defects.
4. Emits `CR-` findings (closed severity enum: blocker/warning/info),
   validated by `scripts/validate.mjs --check-review` — out-of-schema
   output is rejected, open blockers gate the merge.
5. Writes `.shipline/contracts/<ID>.pr-review.md` and posts a PR review
   comment with the findings table.

## When to use

- After the Implementer opens the PR, alongside `/verify-pr`.
- Runs automatically on every push via `pr-verify.yml`.
- Open blockers feed the **review→fix loop**: the Implementer addresses
  them automatically and re-pushes (see `/implement` and GUIDE.md).

## See also

- `/verify-pr` — AC/contract conformance on the same PR
- `/implement` — the Implementer, including review→fix mode
- `reference/CRITIC-PROTOCOL.md` — the shared severity enum
