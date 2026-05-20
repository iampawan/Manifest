---
id: CLEAN-001
title: Clean reference contract (should pass deterministic checks)
status: verified
complexity: null
platforms: [web]
createdBy: eval@manifest
revision: 1
confidenceScore: 0.9
---

## Goal

A minimal fully-valid contract used by the eval harness. The
deterministic validator should produce ZERO findings and a `verified`
readiness for this one.

## Success metrics

- metric: feature_adoption
  eventName: feature_used
  target: ">= 20% within 28 days"
  window: 28d

## Behaviors

### B1. User triggers the feature
- platforms: [web]
- instrumentation:
    eventName: feature_used
    properties: [source]
    expectedRatePerDay: 100
- perfBudget:
    ttiMs: 1500
    p95LatencyMs: 500
    errorRatePct: 0.5
- commsStates:
    empty: "Nothing here yet"
    loading: "Working..."
    success: "Done"
    error: "Something failed — try again"

## Acceptance criteria

- AC1 (B1): Given a logged-in user, when they trigger the feature,
  then a feature_used event fires with source set.

## Out of scope

Everything not described above.
