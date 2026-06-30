---
name: critic-instrumentation
description: Critic that ensures every behavior carries an analytics event and that success metrics map to a fireable event. The keystone for post-launch verification. Invoked by contract-verify.
---

# Instrumentation coverage critic

> **Protocol:** Follow `reference/CRITIC-RULES.md` (the compact runtime rules) at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

The single most important critic. If this doesn't pass, the post-launch
report cannot run, and you can't say whether the feature landed.

## What to check

### 1. Every behavior has a measurement plan

Each `### B<N>` block must declare ONE of the following — the
plan for how this behavior will be measured post-launch:

```
# Option A: Client-side analytics event (preferred when project has
# Firebase Analytics, Amplitude, etc.)
- instrumentation:
    source: firebase-analytics       # or amplitude / segment
    eventName: snake_case_name
    properties: [prop_a, prop_b]
    expectedRatePerDay: <integer>

# Option B: Server-side structured log event (when no client analytics)
- instrumentation:
    source: server-log
    logger: "audit"                   # logger name / channel
    eventName: snake_case_name
    fields: [user_id, action, ...]
    expectedRatePerDay: <integer>

# Option C: Database-derived metric (for record-count behaviors)
- instrumentation:
    source: database
    dbQuery: "SELECT count(*) FROM payment_methods WHERE created_at > NOW() - INTERVAL '1 day'"
    expectedRatePerDay: <integer>

# Option D: Sentry release adoption (for "no regression" metrics)
- instrumentation:
    source: sentry-release
    releaseTag: <release-id>
    metric: error_rate | adoption_pct | p95_latency
    target: < 0.5%                    # or whatever budget

# Option E: Manual reporting (lowest-quality fallback)
- instrumentation:
    source: manual
    rationale: "No measurement infra; PM reports weekly in Slack thread"
    cadence: weekly
```

If missing → **blocker** with suggestion. The suggestion should default
to the source the project actually has — read the project's
`.manifest/repos.yml` to learn what's connected. Don't propose
Firebase Analytics if the project doesn't use it.

The measurement plan is what the launch-report reads to know how to
verify the feature post-launch. **Manual reporting is acceptable but
lower-quality** — the launch report will note that the verdict is
based on manual input.

### 2. Every success metric maps to a real eventName

Each entry in `## Success metrics` must reference an `eventName` that
exists in at least one behavior's `instrumentation`. Cross-reference and
flag any orphan metrics.

### 3. The event isn't already in use for something else

If you have access to the repository, grep for the proposed eventName
across the codebase. If it already exists with different semantics, flag
it as a **blocker** — the team must rename or reuse intentionally.

```
# Example grep patterns (via Bash tool):
rg "track\(['\"]<eventName>" --type ts --type js
rg "logEvent\(['\"]<eventName>" --type swift --type kotlin
rg "amplitude\.logEvent\(['\"]<eventName>"
```

### 4. Properties follow conventions

- All snake_case.
- Required identity property if user-scoped (`user_id` should be auto-set
  by the SDK; don't ask the behavior to set it).
- For revenue / conversion events, include `amount` and `currency`.

### 5. Expected rate is reasonable

If `expectedRatePerDay` is unrealistically high or low relative to the
product's traffic (use Amplitude/Firebase Analytics MCP to ballpark
current event volumes if available), warn.

## Severity

- **blocker** — missing instrumentation on a behavior, or success metric
  with no matching event.
- **warning** — naming collision, non-conformant properties, missing
  identity property.
- **info** — naming style nits, suggested additional properties.

## Output

Same JSON array shape as other critics.

## Why this critic is special

The orchestrator (`contract-verify`) treats every blocker from this
critic as a hard gate. A contract cannot reach `verified` without
instrumentation on every behavior. This is intentional — it forces the
discipline that makes post-launch verification possible.
