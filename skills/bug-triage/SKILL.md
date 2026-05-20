---
name: bug-triage
description: Scan Sentry, support tickets, and app store reviews for new bug clusters; deduplicate against existing tickets; file to JIRA with contract back-references; then route each new cluster back into the pipeline (trivial→/fix, substantial→/contract) with propose-by-default guardrails. Invoked nightly by launch-monitor.yml as part of the 4-week monitoring window.
requiredScopes:
  - atlassian:write
  - slack:chat:write
  - sentry:read
---

# Bug triage agent

You run alongside the launch reports. Each invocation looks for new bug
clusters across error tracking and user-facing channels, dedupes against
already-filed tickets, and creates new tickets with proper context.

## Inputs

- Optional: contract ID (scope to one feature). If omitted, scan all
  contracts currently in their landing window.
- Time window: default last 24 hours.

## Process

### 1. Identify contracts in monitoring

Read `.shipline/contracts/*.md`. Find contracts where:
- `landed` is not yet set (still in monitoring window), OR
- `landingTrack` contains a verdict from the last 28 days

These are the features you're responsible for.

### 2. Pull errors from Sentry

Use the Sentry MCP to query:
- New issues in the last 24h
- Filtered to release tags matching contracts in monitoring
- OR filtered to source paths touched in implementation plans

For each new issue, extract: error class, count, affected users, first
seen, stack trace top frame, code locations.

### 3. Pull qualitative signals

If support tool MCPs are connected:
- New tickets in the last 24h
- Search for keywords from contract titles + feature flag names

If app store review MCPs are connected (App Store Connect / Play
Console):
- New 1-2 star reviews mentioning feature-relevant keywords

### 4. Cluster

Group findings by likely root cause. Two errors with the same top frame
or the same component name are likely one cluster. Two support tickets
describing the same confusion are one cluster.

For each cluster:
- Severity (S0..S3 by your team's convention)
- Affected user count estimate
- Likely related contract / behavior
- Probable bug category: functionality / comms / UI / perf

### 5. Deduplicate against JIRA

Use the Atlassian MCP to search for existing tickets with overlapping
- error class
- contract reference
- date range

If a match found, *update* the existing ticket with new evidence (+1
occurrences, add the new affected users). Don't create duplicates.

### 6. File new tickets

For each new cluster, create a JIRA ticket with:
- Title summarizing the symptom
- Description with reproduction steps inferred from stack trace + user
  reports
- Link back to the contract revision
- Link to the Sentry issue
- Component tag matching the responsible team (infer from
  CODEOWNERS or repo structure)
- Severity
- Suggested assignee (the last person to touch the relevant file,
  per git blame)

### 7. Report

Update `.shipline/contracts/<ID>.bug-log.md` (append-only) with each new
cluster filed. Post a daily summary to the contract's Slack thread:

> 🐛 Day 4 bug triage: 1 new S2 (BUG-101 — TypeError in SavedCardRow,
> 12 users). 2 dupes against existing tickets, +5 occurrences each.

If zero new bugs, post a quieter line: "Day 4 bug triage: clean."

### 8. Route the bug back into the pipeline (loop closure)

Filing a ticket isn't the end. A post-launch bug is new work, and it
should re-enter the same pipeline everything else flows through instead
of waiting in a queue for someone to notice. For each *newly filed*
cluster (not dupes — those are already tracked), decide a route.

**8a. Classify the cluster** (same bar `quick-fix` uses):
- **trivial / localized** — one file or a small, well-understood change
  with a clear stack-trace location → **express lane** (`/fix`).
- **substantial** — multiple files, unclear cause, spans platforms, or
  touches a migration/auth/data path → **full contract** (`/contract`).

**8b. Decide auto-start vs propose** — this is the safety gate, because
the diagnosis is inferred from a stack trace and acting on a wrong one
wastes cycles:
- **Auto-start** ONLY when BOTH: the cluster is *trivial* AND
  high-confidence (a single clear top frame + an identified file), OR
  it is **S0/S1** (a live, high-severity regression where speed wins).
- **Otherwise propose** — post the suggested route and wait for a human
  to confirm. When in doubt, propose.
- Either way, **never auto-merge.** Auto-start opens the work; the PR
  still goes through `verify-pr` + `code-review` + human approval like
  any other change.
- **Cap**: auto-start at most 2 routes per run. Beyond that, propose the
  rest — a flood of auto-fixes from one nightly sweep is a smell, not a
  feature.

**8c. Create the routing artifact:**
- *Express lane*: open (or, if proposing, draft) a `/fix` entry seeded
  from what you already have — symptom, inferred repro, the suspect file
  + git-blame owner, and the originating contract's regression context.
  The actual code change runs through the existing Implementer
  (`implement` holds the `github:contents:write` /
  `pull_requests:write` scopes — bug-triage itself only files/links).
- *Contract*: draft a `/contract new` stub — `goal: fix <symptom>`,
  behaviors and ACs derived from the repro and the affected behavior —
  entering the normal verify→promote flow.

**8d. Link and record state** so it's traceable and not re-routed:
- Add the follow-up to the originating contract frontmatter:
  `bugFollowups: [{ ticket: BUG-101, route: fix, ref: PR#234, status: open }]`.
  `/status` and `launch-report` read this — an open follow-up means
  "landed" is at risk and should temper a `landed` verdict.
- Cross-link the ticket ↔ the fix PR / new contract ↔ the originating
  contract.
- Mark the cluster `routed` in `<ID>.bug-log.md` so tomorrow's run
  dedupes against it and doesn't route the same bug again.

If GitHub/JIRA write access or `/fix` isn't available, degrade: post
the proposed route (with the seed details) to the contract's Slack
thread / as a PR comment, and let a human pick it up. Never silently
drop a routable bug.

## Anti-patterns

- Don't open a ticket for every error — only for clusters with ≥3
  occurrences and ≥2 affected users (or any S0/S1 regardless).
- Don't speculate on root cause beyond the stack trace evidence.
- Don't assign without checking the team is on-call.
- Don't file a ticket the same engineer just filed manually 10 minutes
  earlier — be willing to wait and dedupe in the next pass.
- Don't auto-start a fix off a low-confidence diagnosis. If the stack
  trace doesn't point to a clear file, propose — don't act.
- Don't auto-merge anything. Routing opens the work; approval is still
  a human + the PR gates (verify-pr, code-review).
- Don't re-route a cluster you already routed — check the `routed` mark
  in the bug-log first.

## Slack threading

Post Slack updates as a REPLY in the contract's thread, not a new
top-level message: use `thread_ts: <contract.slackThreadTs>` in the
channel `<contract.slackChannel>` (both set by contract-promote). This
keeps `#shipline` to one line per contract. Exception: an overdue SLA,
a `rollback`, or a canary auto-pause also posts a brief top-level alert
linking back to the thread. (See reference/CONTRACT-FORMAT.md.)
