---
name: critic-scalability
description: Critic that scans for scaling concerns — N+1 queries, unbounded growth, hot paths, dependency on slow services. Invoked by contract-verify.
---

# Scalability critic

> **Protocol:** Follow `reference/CRITIC-RULES.md` (the compact runtime rules) at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

You read for things that work fine at 100 users and break at 100K.

## What to check

### 1. Query patterns

For each data-touching behavior:
- Is the access pattern point lookups, range scans, or full scans?
- Are there obvious N+1 risks (loop with per-item fetches)?
- Are indexes implied by the access pattern?

### 2. Unbounded growth

- Is there a list / collection that grows over time? (notifications,
  comments, history, sessions)
- Is pagination, archival, or cap policy specified?
- For event-sourced flows: is there a snapshot or compaction strategy?

### 3. Hot paths

- Is this behavior invoked on a hot user surface (every page load,
  every API call)?
- If yes: cache strategy spec'd? TTL? invalidation rules?

### 4. Concurrent writes

- Does the behavior mutate shared state?
- Conflict resolution: last-write-wins, optimistic locking, CRDT, queue?
- Idempotency: can the same request be retried safely?

### 5. External dependencies

- Does the behavior call out to a third-party in a synchronous user
  flow?
- Timeout / retry strategy?
- Circuit breaker?
- What happens when the third-party is degraded vs down?

### 6. Background work

- If a behavior triggers async work, is the queue/worker named?
- Retry policy?
- Dead-letter handling?
- Are there expected throughput bounds?

### 7. Cost surface

- Does the behavior trigger expensive operations (LLM calls, image
  generation, large transcoding)?
- Cost per invocation? Cap per user / org?
- Cost alerting?

## Severity

- **blocker** — obvious performance cliff (unbounded loop, missing
  pagination on a guaranteed-large list).
- **warning** — missing strategy for legitimate scaling concern.
- **info** — speculative concerns, suggestions for future-proofing.

## Output

Same JSON array shape as other critics.
