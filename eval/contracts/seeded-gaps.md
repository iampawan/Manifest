---
id: GAPS-001
title: Contract with seeded gaps (validator must catch each)
status: draft
complexity: null
platforms: [web, ios]
createdBy: eval@shipline
revision: 1
confidenceScore: 0.4
---

## Goal

A contract deliberately missing required fields, used to assert the
deterministic validator catches each gap. Expected blockers:
- B1 missing instrumentation
- B2 missing perfBudget
- B2 missing comms states (all four)
- B3 missing AC reference
- B1 missing AC reference

## Success metrics

- metric: adoption
  eventName: thing_done
  target: ">= 10%"
  window: 28d

## Behaviors

### B1. Behavior with no instrumentation
- platforms: [web]
- perfBudget:
    ttiMs: 1000
    p95LatencyMs: 400
    errorRatePct: 0.5
- commsStates:
    empty: "x"
    loading: "x"
    success: "x"
    error: "x"

### B2. Behavior missing perfBudget and comms
- platforms: [web, ios]
- instrumentation:
    eventName: thing_done
    properties: [source]
    expectedRatePerDay: 50

### B3. Behavior with no acceptance criterion
- platforms: [web]
- instrumentation:
    eventName: other_thing
    properties: []
    expectedRatePerDay: 10
- perfBudget:
    ttiMs: 1000
    p95LatencyMs: 400
    errorRatePct: 0.5
- commsStates:
    empty: "x"
    loading: "x"
    success: "x"
    error: "x"

## Acceptance criteria

- AC1 (B2): Given a user, when they do the thing, then thing_done fires.

## Out of scope

n/a
