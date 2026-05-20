# Contract format

A contract is a markdown file at `.shipline/contracts/<ID>.md` with YAML
frontmatter and structured sections. The format is designed to be both
human-readable and machine-parseable.

## Minimal template

```markdown
---
id: SC-001
title: Saved payment methods on web and iOS
status: draft               # draft | verifying | verified | promoted
complexity: null            # set by critic-sizing: small | medium | large
platforms: [web, ios]
createdBy: pawan@example.com
revision: 1

# Cycle-time timestamps — each stamped by the skill that triggers the
# transition. The Launch Report computes total cycle time from these.
createdAt: 2026-05-19T09:00:00Z        # /contract new
verifiedAt: null                        # readiness gate goes green
promotedAt: null                        # /contract promote (SLA timer starts here)
slaDeadline: null                       # promotedAt + 24h or 72h
prOpenedAt: null                        # implement skill opens PR
prMergedAt: null                        # PR merged to main
qaDeployedAt: null                      # successful deploy to QA env
canaryStartedAt: null                   # 1% rollout begins
prodRollout100At: null                  # feature flag hits 100%
landedAt: null                          # day-28 verdict committed
landed: null                            # true | false | partial | rolled-back
slaHit: null                            # promotedAt → prodRollout100At within SLA?
---

## Goal

One paragraph. What problem does this solve, for whom, why now?

## Success metrics

- metric: percent_of_checkouts_using_saved_card
  eventName: checkout_completed
  property: payment_method_source
  target: ">= 30% within 28 days"
  window: 28d

## Behaviors

### B1. User adds a card during checkout
- platforms: [web, ios]
- instrumentation:
    eventName: payment_method_added
    properties: [source, card_brand]
    expectedRatePerDay: 200
- perfBudget:
    ttiMs: 1500
    p95LatencyMs: 800
    errorRatePct: 0.5
- commsStates:
    empty: "No saved cards yet"
    loading: "Saving your card..."
    success: "Card saved. You'll see it next time."
    error: "We couldn't save that. Try again or use a different card."

### B2. User selects a saved card at checkout
- ...

## Acceptance criteria

Each AC MUST declare which behavior it covers, using `(B<n>)` right
after the AC id. The deterministic validator uses this to verify that
every behavior has at least one AC — without explicit linkage it can't
check coverage. One AC can cover multiple behaviors: `AC1 (B1, B2):`.

- AC1 (B1): Given a logged-in user with no saved cards, when they complete
  checkout and check "Save this card", then a payment_method_added event
  fires with source="checkout" and the card appears on /account/payment-methods.
- AC2 (B2): ...

## Diagrams

```mermaid
flowchart LR
  Checkout --> AddCard --> SaveDecision --> Stored
  Stored --> NextCheckout --> SelectSaved --> Pay
```

## Out of scope

Explicitly list what this does NOT include, so reviewers don't add scope.

## Open questions

Things the author needs answered before promote. Critics will flag these.
```

## Field reference

### Frontmatter

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Short stable ID. Prefix by epic area (SC, AUTH, etc.) |
| `title` | yes | One line |
| `status` | yes | State machine: draft → verifying → verified → promoted |
| `complexity` | set by sizing critic | small / medium / large |
| `platforms` | yes | Subset of [web, ios, android, server, email] |
| `revision` | yes | Bumps on every promoted edit |

### Cycle-time timestamps

Every transition stamps a timestamp. The Launch Report computes total
cycle time and per-phase durations from these. Each stamp is set by
the skill or workflow that triggers the transition:

| Field | Set by | Captures |
|---|---|---|
| `createdAt` | `contract-new` | When intake started |
| `verifiedAt` | `contract-verify` | When readiness went green |
| `promotedAt` | `contract-promote` | When SLA timer started |
| `slaDeadline` | `contract-promote` | promotedAt + 24h (small) or 72h (medium) |
| `prOpenedAt` | `implement` | When the Implementer opened the PR |
| `prMergedAt` | `verify-pr` (on merge) | When the PR merged to main |
| `qaDeployedAt` | `verify-deployment` | When QA deploy succeeded |
| `canaryStartedAt` | `verify-deployment` | When 1% rollout began |
| `prodRollout100At` | `verify-deployment` | When flag hit 100% |
| `landedAt` | `launch-report` | When day-28 verdict committed |
| `landed` | `launch-report` | Final verdict |
| `slaHit` | `launch-report` | Did promotedAt → prodRollout100At fit the SLA? |

The Launch Report includes a cycle-time section per day surfacing:
- **Total intake → prod**: createdAt → prodRollout100At
- **Promoted → prod**: promotedAt → prodRollout100At (the SLA window)
- **Per-phase**: time in each phase (spec / build / ship / land)

Track these across many contracts and you get a real distribution of
your team's actual cycle time — which is more valuable than any
single SLA promise.

### Behavior fields

Each behavior needs `instrumentation`, `perfBudget`, and `commsStates` for the
contract to reach `verified` status. The instrumentation-coverage,
perf-budget, and comms-completeness critics enforce this.

### Sizing rules (set by critic-sizing)

| Bucket | Rules |
|---|---|
| **small** | 1 platform, ≤3 behaviors, no schema, no auth, flag-gated |
| **medium** | ≤2 platforms, ≤8 behaviors, additive schema OK, existing vendors |
| **large** | Anything else — exits the pipeline |

## Findings file

Verification produces `.shipline/contracts/<ID>.findings.md`:

```markdown
---
contractId: SC-001
verifiedAt: 2026-05-19T10:00:00Z
verifiedRevision: 1
readiness: review_needed
confidenceScore: 0.78
---

## Open blockers (0)

(none)

## Warnings (2)

### W1 [instrumentation-coverage] B3 has no instrumentation field
Suggestion: add an event for "user removes saved card", at least `payment_method_removed`.
Status: open

### W2 [platform-parity] B2 only describes web behavior
Suggestion: clarify iOS interaction (modal vs full screen).
Status: open

## Info (5)
...
```
