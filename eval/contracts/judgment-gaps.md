---
id: JGAPS-001
title: Account settings — delete account, export data, sessions list
status: draft
complexity: null
platforms: [web, ios]
createdBy: eval@shipline
revision: 1
---

## Goal

Let a logged-in user manage their account: delete their account, export
their data, and see their active sessions. Reduce support load from
manual account-deletion requests.

(RECALL FIXTURE — unlike seeded-gaps.md this contract is STRUCTURALLY
COMPLETE, so the deterministic validator emits zero findings. The
planted defects are judgment-only; each is enumerated in
eval/golden/judgment-gaps.expected.json with the critic that owns it.
Do not "fix" them by adding detail — that defeats the fixture.)

## Success metrics

- metric: self_serve_deletion_rate
  eventName: account_deleted
  property: initiated_by
  target: ">= 60% of deletion requests are self-serve within 28 days"
  window: 28d

## Behaviors

### B1. User deletes their account
- platforms: [web, ios]
- instrumentation:
    eventName: account_deleted
    properties: [initiated_by]
    expectedRatePerDay: 20
- perfBudget:
    ttiMs: 1500
    p95LatencyMs: 800
    errorRatePct: 0.5
- commsStates:
    empty: "No account to delete"
    loading: "Working..."
    success: "Done"
    error: "Something went wrong. Please try again."

### B2. User exports their data
- platforms: [web, ios]
- instrumentation:
    eventName: data_exported
    properties: [format]
    expectedRatePerDay: 15
- perfBudget:
    ttiMs: 2000
    p95LatencyMs: 1200
    errorRatePct: 1.0
- commsStates:
    empty: "Nothing to export yet"
    loading: "Preparing your export..."
    success: "Your export is ready"
    error: "Export failed. Please try again."

### B3. User views active sessions
- platforms: [web, ios]
- instrumentation:
    eventName: session_viewed
    properties: [device, location]
    expectedRatePerDay: 40
- perfBudget:
    ttiMs: 1000
    p95LatencyMs: 500
    errorRatePct: 0.5
- commsStates:
    empty: "No active sessions"
    loading: "Loading sessions..."
    success: "Here are your active sessions"
    error: "Couldn't load sessions. Please try again."

## Acceptance criteria

- AC1 (B1): Given a logged-in user, when they confirm deletion, then
  account_deleted fires and the account is removed.
- AC2 (B2): Given a logged-in user, when they request an export, then
  data_exported fires and a file is produced.
- AC3 (B3): Given a logged-in user, when they open settings, then
  session_viewed fires and active sessions are listed.

## Out of scope

- Admin-initiated deletion
- Scheduled/automatic exports
