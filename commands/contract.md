---
name: contract
description: Pick up, fix, and promote Manifest contracts. Run with no args (or `help`) to get a quick tutorial. Subcommands: pickup (canonical Spec entry), fix, promote, decompose, diagram, migrate, archive. `new` and `verify` exist for backward compatibility and power-user re-checks respectively.
---

# /contract

The umbrella command for contract lifecycle operations.

## If you're new — start here

Running `/contract` with no arguments? You're probably looking for a
quick tutorial. Invoke the **tutorial** skill — it adapts to what
you want to learn:

```
/manifest tutorial      # 3-minute walkthrough
/manifest help          # reference card
```

Or jump right in:

```
/contract pickup <a JIRA / Doc / Slack URL, or "a description">
```

## Subcommands

### /contract pickup <source-or-description>  *(canonical Spec entry)*

The single entry point for getting a feature spec'd. Source is
anything:

```
/contract pickup https://your-org.atlassian.net/browse/ENG-1234
/contract pickup https://docs.google.com/document/d/<...>
/contract pickup https://linear.app/<org>/issue/ENG-987
/contract pickup https://notion.so/<page-id>
/contract pickup https://yourcorp.slack.com/archives/C123/p1234567890
/contract pickup https://figma.com/file/<...>
/contract pickup "Add CSV export to /admin/users"                     # free-text
/contract pickup        # then paste text or drop an image
```

What it does:

- Detects the source type and fetches via the right MCP. Follows
  embedded links one level deep (Figma inside JIRA, tech spec inside
  the Google Doc).
- Pulls related history in the background — past contracts on the
  same surface, postmortems, recent Sentry, open PRs touching the
  same files.
- Drafts the contract, runs the validator + the relevant judgment
  critics in parallel, plus a dev-side `critic-code-context` that
  surfaces auto-fill proposals from the repo.
- Sorts every gap into three buckets:
  **A. agent fills from code** (one tap to accept) ·
  **B. dev decides** (engineering judgment) ·
  **C. only PM can answer** (drafted as PM-facing questions).
- For Bucket C, agent composes one batched message in the dev's
  voice on the channel the source came from — JIRA comment, Slack
  reply, Notion comment, Google Doc suggestion. **PM never has to
  touch Manifest.**
- Watches the channel for replies; when PM answers, the answer
  materializes as an AC edit with a provenance comment, the question
  moves to a `<ID>.qa.md` sidecar, and the contract re-verifies
  incrementally.

End-to-end time for a small contract: ~3–5 minutes of dev review,
then any PM questions go async. Implementation on the unblocked
behaviors can start in parallel — non-blocking questions don't pause
work.

Enable per repo in `.manifest/repos.yml`:

```yaml
pickup:
  enabled: true            # opt in (per repo)
  identifyAgent: true      # "— <dev> (via Manifest)" footer on PM-facing posts
  defaultChannel: jira     # or: slack | notion | gdoc
  blockingByDefault: false
  cacheTTL: 24h
```

Without `pickup.enabled: true`, the command falls back to the
legacy `/contract new` flow with a notice.

Invokes the **contract-pickup** skill. See `skills/contract-pickup/SKILL.md`
for the full flow.

### /contract new <input>  *(legacy alias — prefer `pickup`)*

The pre-0.18 author flow. Kept as a thin alias for backward
compatibility — accepts the same inputs as `pickup` and delegates to
the **contract-new** skill, which then runs verify as a separate
step. New work should use `/contract pickup`; this entry stays so
older docs, talks, and muscle memory don't break.

Inputs:

```
/contract new "Add CSV export to /admin/users"                   # free-text
/contract new https://your-org.atlassian.net/browse/PROD-1234    # JIRA URL
/contract new https://linear.app/your-org/issue/ENG-987          # Linear
/contract new https://notion.so/<page-id>                        # Notion
/contract new https://github.com/org/repo/issues/42              # GH issue
/contract new https://figma.com/file/<...>                       # Figma file
```

For JIRA / Linear / Notion sources, this skill also posts a comment
back on the source ticket linking to the new contract — two-way
discoverability.

Invokes the **contract-new** skill.

### /contract verify <ID>  *(re-check after manual edits)*

Manually re-runs the validator + the relevant judgment critics
against a contract. Useful only when you've made manual edits to the
`.md` file directly and want to re-check without going through the
full pickup flow. In the canonical pickup flow, verify runs
*automatically* as the contract is drafted and edited — you don't
normally invoke it yourself.

Writes a findings file. Sets readiness verdict and complexity.

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

Output: `.manifest/contracts/<ID>.findings.md` plus updated frontmatter
on the contract itself (`status`, `complexity`, readiness reasons).

**Speed.** Verify does the *smallest correct* amount of work:
- **No-op cache** — if nothing changed since the last verify, it reuses
  the prior findings and runs zero critics.
- **Incremental re-verify** — after an edit, only the critics over the
  *changed* behaviors re-run; unchanged findings (and the regression
  repo-scan, if the API surface didn't move) are reused. So fixing one
  finding and re-verifying is fast, not a full re-run.
- **`--fast`** — `/contract verify <ID> --fast` runs only edge-cases +
  security and skips the regression scan, for a quick draft-loop verdict.
  A `--fast` verify is **not promotable** — run a full verify before
  `/contract promote`.
- **`--force`** — re-run everything regardless of cache.

Invokes the **contract-verify** skill.

### /contract fix <ID>

The bounded verify→fix loop — one command instead of the slow manual
"verify → ask Claude to fix → re-verify → new blocker → repeat" cycle.
It runs verify, applies the fixes for **all open blockers** in one batch
(adding any new behaviors/ACs *complete*, so they don't bounce a fresh
deterministic blocker), then re-verifies incrementally and loops until
**0 blockers** or a **3-pass cap** (`maxFixIterations`). It targets
blockers only — warnings stay advisory. On the cap it stops and hands
you the remaining blockers rather than churning. You review the contract
before `/contract promote`.

```
/contract fix SC-005
```

Invokes the **contract-verify** skill in fix mode.

### /contract migrate <ID>

Brings an existing contract up to the current author-friendly layout
(the YOU-AUTHOR / MANIFEST-MANAGES frontmatter groups, `changeType` added
if missing). It's a **safe, deterministic reformat** — it preserves every
value, including managed state (timestamps, status, `landed`,
`bugFollowups`) and any unknown fields, and leaves the body untouched. It
does **not** re-verify or change scope.

```
node <plugin-root>/scripts/migrate-contract.mjs .manifest/contracts/<ID>.md          # preview
node <plugin-root>/scripts/migrate-contract.mjs .manifest/contracts/<ID>.md --write   # apply
```

Refuses frozen revision snapshots (`<ID>.r<N>.md`) — those are immutable.
To also trim an over-engineered older contract, set `changeType: bug-fix`
(if it is one) and run `/contract verify` so `minimality` flags the bloat.

### /contract diagram <ID>

See the contract's Mermaid diagrams as actual pictures, not text — handy
when the `.md` won't be on GitHub and you're deciding from your IDE.
Mermaid already renders in most IDE markdown *previews* (VS Code with the
Mermaid extension; JetBrains and Obsidian natively). For a guaranteed
view regardless of IDE setup, this writes a standalone HTML you open in
a browser:

```
node <plugin-root>/scripts/render-diagram.mjs .manifest/contracts/<ID>.md   # writes <ID>.diagram.html
```

(Needs network when you open the file — it loads Mermaid from a CDN.
Diagrams are optional in a contract; add one only when a branching flow
makes it clearer.)

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

### /contract archive <ID>

Move a landed contract's files to `.manifest/archive/<year>/<ID>/` so
the active folder stays lean. Keeps the contract + final launch report,
prunes the process exhaust (findings, deploy reports, interim reports —
git history retains them; set `retention: keep-all` to keep everything).
Happens automatically at day-28; this is the manual trigger. See
GUIDE 1e (lifecycle & retention).

## Full example walkthrough

```
# From a JIRA ticket — the most common starting point
/contract new https://your-org.atlassian.net/browse/AUTH-1234

# Critics check it
/contract verify AUTH-1234

# Read .manifest/contracts/AUTH-1234.findings.md, edit the contract,
# re-run verify until green

# Freeze and start the build phase
/contract promote AUTH-1234

# From a draft PR
@claude /implement AUTH-1234
```

## See also

- `/manifest tutorial` for a guided 3-minute walkthrough
- `/implement` for triggering the implementer agent
- `/verify-pr` for re-running AC coverage on an existing PR
- `/launch` for manual launch reports
- `GUIDE.md` at the plugin root for the full manual
