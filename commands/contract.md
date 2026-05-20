---
name: contract
description: Author, verify, or promote a Shipline contract. Run with no args (or `help`) to get a quick tutorial. Subcommands: new, verify, promote.
---

# /contract

The umbrella command for contract lifecycle operations.

## If you're new — start here

Running `/contract` with no arguments? You're probably looking for a
quick tutorial. Invoke the **tutorial** skill — it adapts to what
you want to learn:

```
/shipline tutorial      # 3-minute walkthrough
/shipline help          # reference card
```

Or jump right in:

```
/contract new <your JIRA / Linear / Notion link or "a description">
```

## Subcommands

### /contract new <input>

Starts intake and writes a draft contract to
`.shipline/contracts/<ID>.md`. Accepts several input forms:

```
/contract new "Add CSV export to /admin/users"                   # free-text
/contract new https://your-org.atlassian.net/browse/PROD-1234    # JIRA URL
/contract new https://linear.app/your-org/issue/ENG-987          # Linear
/contract new https://notion.so/<page-id>                        # Notion
/contract new https://github.com/org/repo/issues/42              # GH issue
/contract new https://figma.com/file/<...>                       # Figma file
```

When given a URL, the skill fetches the source via the appropriate
MCP, extracts what it can (title, goal, behaviors, ACs, platforms,
out-of-scope) and asks the user only what's still missing. The
contract carries a `source:` frontmatter field linking back to the
original ticket for audit.

For JIRA / Linear / Notion sources, the skill also posts a comment
back on the source ticket linking to the new contract — two-way
discoverability.

If you're new, the **contract-new** skill will narrate what it's
doing as it goes.

Invokes the **contract-new** skill.

### /contract verify <ID>

Runs the deterministic validator, then only the relevant judgment critics. Writes a findings
file. Sets readiness verdict and complexity.

Takes about 90 seconds. The deterministic validator handles field
presence, AC coverage, sizing, and the readiness verdict. Then only
the *relevant* judgment critics run (selected by change type):

- **edge-cases** — always; missing scenarios, state transitions
- **regression** — always; scans your other repos for conflicts
- **security** — always (unless purely cosmetic); auth, PII, injection
- **instrumentation** — if metrics/events exist; naming + collisions
- **comms-completeness** — if user-facing; copy quality
- **platform-parity** — if >1 platform; platform-specific UX
- **scalability** — if it touches data/server; N+1, growth, hot paths
- **perf-budget** — if non-default budgets / hot paths

(Sizing is computed by the validator, not an LLM critic.)

Output: `.shipline/contracts/<ID>.findings.md` plus updated frontmatter
on the contract itself (`status`, `complexity`, readiness reasons).

**Caching:** if the contract content + plugin version are unchanged
since the last verify, it reuses the prior findings and skips the
critics (no LLM cost on no-op re-runs). Use `/contract verify <ID>
--force` to re-verify regardless.

Invokes the **contract-verify** skill.

### /contract promote <ID>

Freezes a verified contract into a revision. Creates a JIRA epic
(if Atlassian MCP connected), opens a GitHub tracking issue, starts
the SLA timer (24h Small, 72h Medium). For Small/Medium only — a Large
contract is routed to `/contract decompose` instead.

This is a one-way commitment. Edits after promote fork a new revision
but the running pipeline reads the snapshot.

Invokes the **contract-promote** skill.

### /contract decompose <ID>

For a Large contract: breaks it into a dependency-ordered sequence of
Small/Medium child contracts, with migrations/auth flagged human-led.
The Large contract becomes an epic that owns the overall success
metric; each child is verified and promoted normally, in order. Large
isn't refused — it's made tractable.

Invokes the **contract-decompose** skill.

## Full example walkthrough

```
# From a JIRA ticket — the most common starting point
/contract new https://your-org.atlassian.net/browse/AUTH-1234

# Critics check it
/contract verify AUTH-1234

# Read .shipline/contracts/AUTH-1234.findings.md, edit the contract,
# re-run verify until green

# Freeze and start the build phase
/contract promote AUTH-1234

# From a draft PR
@claude /implement AUTH-1234
```

## See also

- `/shipline tutorial` for a guided 3-minute walkthrough
- `/implement` for triggering the implementer agent
- `/verify-pr` for re-running AC coverage on an existing PR
- `/launch` for manual launch reports
- `GUIDE.md` at the plugin root for the full manual
