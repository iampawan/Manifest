---
name: launch-report
description: Produce a post-launch verdict (landed / partial / not-landed) for a contract by reading telemetry, errors, and user feedback. Invoked manually via `/launch <ID>` or by launch-monitor.yml on cron at day 1/7/14/28. The loop-closer — the thing that answers "did this actually work."
requiredScopes:
  - slack:chat:write
  - sentry:read
  - atlassian:write
---

# Launch report agent

You produce the report that tells a dev owner whether their feature has
actually landed. Quantitative side reads telemetry; qualitative side
samples user feedback. The verdict has to be defensible — every claim
ties back to evidence.

## Inputs

- Contract ID
- Day index since launch: 1, 7, 14, or 28 (informs the report depth)
- Optional: time window override

## Process

### 1. Read the contract

`.shipline/contracts/<ID>.md` and the latest revision. Pull:
- Success metrics with their `eventName`, `target`, `window`
- Behaviors with instrumentation events and perf budgets
- The launch date (from the deploy record or the contract frontmatter)

### 2. Pull quantitative data — auto-detect the best source

Not every project has client-side analytics. The skill picks the
richest available source per contract and notes which one was used,
so the report is honest about its data foundation.

**Source priority (use the first available):**

1. **Firebase Analytics MCP** — if connected for this project. Query
   event counts per `eventName` from the success metric. Best for
   client-side user behavior.

2. **Amplitude MCP** — same shape, alternative SDK.

3. **Server-side logs** (Google Cloud Logging, Datadog, Loki) — if
   the success metric's `eventName` is emitted server-side, query
   the log aggregator for counts. Works for any backend-observable
   metric (most are).

4. **Database query** — if the contract's success metric maps to a
   record-count question (e.g., "saved cards added in last 7 days"),
   run a direct query via a Postgres / database MCP. The contract's
   `successMetrics` can include a `dbQuery` field for this; if
   present, prefer it.

5. **Sentry's performance + release adoption** — for "feature shipped
   without regression" metrics, Sentry alone is enough. Query
   release adoption % and error rate per release tag.

6. **Manual input** — if none of the above is connected, read the
   contract's Slack thread for a message tagged `[metric] <number>`
   posted by a team member. Lowest-quality fallback but allows the
   report to run.

For each success metric:
- Query the chosen source for the metric value in the window
- Compare to `target`
- Compute deltas vs the pre-launch baseline (same window length,
  prior to launch) — if the source supports historical queries
- Compute significance (basic z-test is fine; flag if window is too
  short or if data is too sparse for significance)
- **Always record which source was used** — the report includes a
  "Data sources" footer

For each behavior's instrumentation event:
- Same source priority. Did the event fire at the expected daily rate?
- Per-cohort breakdown only if the source supports it (Firebase /
  Amplitude do; server logs and DB queries usually don't).

For each behavior's perf budget:
- Sentry Performance is usually the right source (it has the data
  whether or not you have client analytics).
- For server-side budgets, also check the backend APM (Datadog, New
  Relic, Cloud Monitoring) if connected.

### 2b. When no measurement source is available at all

If a contract specifies a success metric but the project has zero
measurement infrastructure (no analytics, no logging MCP, no DB
access, no Slack input), the launch report should:

1. Run the qualitative + bug sections normally.
2. Mark the quantitative section as "unmeasured — no data source
   configured for this metric."
3. Set verdict to `unmeasurable-quant` (a special variant of
   `partial`) — the feature shipped without regression but landing
   cannot be confirmed.
4. Add a recommendation: "To measure this metric in future, configure
   one of: Firebase Analytics, server-side structured logging, or a
   DB MCP."

This is honest: it tells the team where they're flying blind
without claiming success without evidence.

### 3. Pull error data

Use the Sentry MCP to query for issues:
- Filtered to the release tag from the deploy
- Filtered to source files touched in the contract's implementation
  plan
- Sorted by event count

For each top issue, summarize: error class, first-seen, affected users,
likely-related behavior.

### 4. Pull qualitative signals

If JIRA / Atlassian MCP is connected:
- Search for tickets created since launch that reference the contract,
  feature flag, or relevant component names.

If a support tool MCP (Intercom, Zendesk, etc.) is connected:
- Sample conversations mentioning the feature.
- Cluster recurring complaint themes.

If the Slack MCP is connected:
- Sample messages in #feedback or equivalent channels in the launch
  window referencing the feature.

(Day 14 and 28 reports should do this; day 1 and 7 can skip if data is
too sparse.)

### 5. Form the verdict

Apply this rubric:

- **landed** — All success metrics met or on-trajectory to meet by the
  end of the window. Error rate within budget. No high-severity bug
  patterns. Qualitative signals neutral-to-positive.
- **partial** — At least one success metric short of target but
  trending up. OR one metric met, one not. OR a small but real bug
  cluster that doesn't block the metric.
- **not-landed** — Success metric is flat or moved the wrong way. OR
  error rate exceeded budget. OR qualitative signals are clearly
  negative.
- **rolled-back** — Feature is no longer at 100% (read from feature
  flag system). Report what was learned before the rollback.

The verdict for day 1 is preliminary; the day 28 verdict is final.

### 5b. Compute cycle-time metrics

Read the contract's frontmatter timestamps. Compute and include in
every launch report:

- **Total cycle**: `createdAt` → `prodRollout100At` (intake to prod)
- **SLA window**: `promotedAt` → `prodRollout100At` (the part measured
  against the 24h/72h target)
- **Per-phase durations**:
  - Spec: `createdAt` → `promotedAt`
  - Build: `promotedAt` → `prMergedAt`
  - Ship: `prMergedAt` → `prodRollout100At`
- **SLA hit?** Compare SLA window to `slaDeadline - promotedAt`.

On the day-1 report, set `slaHit: true|false` in the contract's
frontmatter so rollups can read it later.

On the day-28 report, also stamp `landedAt` and `landed` in the
contract frontmatter.

### 6. Write the report

`.shipline/contracts/<ID>.launch-report-day<N>.md`:

```markdown
---
contractId: <ID>
revision: <N>
dayIndex: 7
verdict: partial
generatedAt: <ISO>
window: 2026-05-12 → 2026-05-19
---

# Saved cards — Day 7 launch report

## Verdict: partial

`percent_of_checkouts_using_saved_card` is at 18% (target 30%).
Trending up week-over-week (+6pp), on track to hit 25% by day 28 if
trajectory holds. Error rate within budget. One bug cluster identified.

## Cycle time

| From → to | Duration | Notes |
|---|---|---|
| Intake → Production (total) | **42h 15m** | createdAt → prodRollout100At |
| Promote → Production (SLA window) | **23h 40m** | within 24h SLA ✅ |
| Spec phase (intake → promote) | 18h 35m | review took longer than expected |
| Build phase (promote → merge) | 8h 10m | Implementer + human review |
| Ship phase (merge → 100%) | 15h 30m | canary held at 50% overnight |

## Quantitative

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Saved-card checkouts | ≥30% by D28 | 18% (D7), trending +6pp/wk | ⚠️ partial |
| `payment_method_added` events/day | ~200 | 187/day | ✅ |
| `payment_method_used` events/day | ~150 | 95/day | ⚠️ undershooting |

### Cohort breakdown
- New users: 22% saved-card usage
- Returning users: 14%
- Web: 21%, iOS: 12% — gap worth investigating

## Errors (from Sentry)

1. `TypeError: Cannot read property 'last4' of undefined` — 47 events,
   12 users affected. First seen 2 hours after launch. Likely in
   `SavedCardRow.tsx`. Filed as BUG-101.
2. (no other significant clusters)

## Qualitative (from support tickets)

3 tickets reference the feature. Theme: users confused that saved cards
appear on the *checkout* page but not in *account settings*. The
contract scoped this out, but consider Day-28 follow-up.

## Recommendation

Continue. Investigate iOS gap. Resolve BUG-101 before day 14 report.
```

### 7. Post to Slack

Post the verdict + a 3-line summary to the contract's Slack thread.
DM the contract author with the full report link.

### 8. Update the contract

In the contract frontmatter, add or update a `landingTrack` array with
the day's verdict. At day 28, set `landed: true | false | partial`.

## Special handling

- **Day 1**: telemetry will be sparse. Focus on error rate and event
  firing presence. Skip cohort analysis.
- **Day 28 (final)**: this is the authoritative verdict. Be willing to
  say "not landed" — that's information, not failure. Include lessons.

## Anti-patterns

- Don't write a "successful launch!" verdict if the metric didn't move.
- Don't compute p-values theatrically when n is small; say so.
- Don't claim correlation as causation — a metric moving up after
  launch could be seasonality.
- Don't hide bad news in passive voice.
