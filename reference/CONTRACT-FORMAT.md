# Contract format

A contract is a markdown file at `.manifest/contracts/<ID>.md` with YAML
frontmatter and structured sections. The format is designed to be both
human-readable and machine-parseable.

## Minimal template

The frontmatter splits in two: a short set **you author**, and the rest
that **Manifest manages** as the contract moves through the pipeline.
You only edit the author fields (`id`, `title`, `changeType`,
`platforms`, `createdBy`) and the body sections below — never the
managed fields. See "Editing a contract" right after this template.

```markdown
---
# ── YOU AUTHOR (edit these) ──
id: SC-001
title: Saved payment methods on web and iOS
status: draft               # draft | verifying | verified | promoted
complexity: null            # set by critic-sizing: small | medium | large
changeType: feature         # feature | bug-fix — drives how much rigor verify applies
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

# Fix-loop counters (bounded so loops can't churn). maxFixIterations caps both.
fixIterations: 0                        # PR-stage review→fix passes (implement fix-mode)
verifyFixIterations: 0                  # spec-stage verify→fix passes (/contract fix)
maxFixIterations: 3                     # cap for both; override via repos.yml conventions

# Rollout health (set by rollback-guard while the feature is ramping)
guardVerdict: null                      # proceed | hold | recommend-rollback
guardCheckedAt: null                    # last rollback-guard sample (ISO)
currentRolloutPercent: null             # current canary stage; human advances the flag, guard records it
rolledBackAt: null                      # set by rollback-postmortem if the feature was reverted

# Post-launch bugs routed back into the pipeline (set by bug-triage).
# An open follow-up means landing is at risk — launch-report tempers its
# verdict accordingly. route: fix | contract; status: open | merged | closed.
bugFollowups: []                        # e.g. [{ ticket: BUG-101, route: fix, ref: "PR#234", status: open }]
# rolloutPlan: (optional per-contract override of repos.yml conventions.rolloutPlan)
#   stages: [{ percent: 1, holdHours: 2 }, { percent: 10, holdHours: 4 }, ...]
rollbackTriggers:                       # optional explicit guardrails; defaults used if absent
  errorRateMultiplier: 3                # error rate > N× baseline → breach
  crashFreeFloor: 99.0                  # crash-free users % must stay ≥ this
  newIssueSeverity: blocker             # new Sentry issue at/above this → breach
  minAdoptionForSignal: 0.05            # ignore signals until ≥ this fraction on the release
---

## Editing a contract — what to change, where, what to remove

You edit the contract by hand (or ask Claude to), then re-verify. When
findings point at a location, here's where it is and what's safe to do:

| Findings says… | Edit here |
|---|---|
| `B2`, "in B1's description" | the `### B2.` behavior block (one block per behavior) |
| `AC3`, "under Acceptance criteria" | the `## Acceptance criteria` list (`- AC<n> (B<n>):` lines) |
| `frontmatter` | only the YOU-AUTHOR fields (`id`, `title`, `changeType`, `platforms`, `createdBy`) |
| `Goal` / `Success metrics` / a section name | that `## <section>` |

- **What you own (edit freely):** `Goal`, `Success metrics` (omit it
  entirely for a bug-fix), the `### B<n>` behaviors, `Acceptance
  criteria`, `Diagrams`, `Out of scope`, `Open questions`, and the five
  author frontmatter fields.
- **What to remove / defer:** `## Out of scope` is the place to *defer*
  work — move a finding there instead of building it if it isn't needed
  now (this is how you keep scope small). To drop a behavior, remove the
  **whole** `### B<n>` block — don't leave it half-specified, because a
  behavior missing its required fields (instrumentation / perfBudget /
  commsStates / an AC) is a blocker.
- **What never to touch:** every frontmatter field except the five
  author ones — `status`, `complexity`, the timestamps, the fix
  counters, the guard/rollout fields, `bugFollowups`. The tool sets
  those; editing them by hand only confuses the SLA/cycle-time math.

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

## Diagrams (optional)

Include a Mermaid diagram only when a branching/state/multi-actor flow
genuinely makes the contract clearer — skip it for a simple change or a
bug fix. **To see it as a picture, not text:** open the file in your
IDE's markdown *preview* (VS Code with the Mermaid extension, JetBrains
and Obsidian render it natively), or run `/contract diagram <ID>` to
write a standalone `<ID>.diagram.html` you can open in any browser.

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
| `complexity` | set by the validator | small / medium / large |
| `platforms` | yes | Subset of [web, ios, android, server, email] |
| `revision` | yes | Bumps on every promoted edit |
| `type` | no | `epic` for a decomposed Large contract; omitted otherwise |
| `parent` | no | On a child: the epic ID it belongs to |
| `children` | no | On an epic: ordered list of child contract IDs |
| `dependsOn` | no | On a child: child IDs that must ship first |
| `implementation` | no | `agent` (default) or `human-led` (migrations/auth — speced + verified by Manifest, human writes the code) |
| `slackThreadTs` | set on promote | Slack `thread_ts` of the contract's anchor message; later updates reply in this thread |
| `slackChannel` | set on promote | The channel the thread lives in (default `#manifest`) |
| `owner` | set at intake | Who owns this contract (email/handle) |
| `lockedBy` | advisory | Who is actively working it right now; set on verify/implement, cleared on completion |
| `lockedAt` | advisory | ISO time the lock was taken (a lock older than ~2h is treated as stale) |

### Central state — where contracts live

Contracts are the source of truth, so they need ONE home. For a
multi-repo product, that home is a **dedicated specs repo** (e.g.
`your-org/manifest-contracts`) on a single `main` branch — not the
`.manifest/` of any one code repo. Git gives a total commit order on
one branch, so that repo *is* a consistent central store: no two devs
get diverging findings for the same contract. Code PRs in the product
repos reference the contract by ID; they don't carry contract state.
`/status` run in the specs repo is the live dashboard.

The `owner` / `lockedBy` / `lockedAt` fields are an **advisory** layer
on top: they help teammates avoid stepping on each other, but they're
only meaningful in the single-branch specs-repo model (a lock in a
git file across divergent branches diverges like anything else). They
warn, they don't hard-block — git remains the real arbiter.

A real-time, concurrent-edit-locked central *service* (Firestore/
Postgres + API) is the v2+ upgrade if single-branch git ever causes
real friction; the plugin is deliberately built so that service would
wrap the same contract format rather than replace it.

### Large contracts → epics

A `large` contract is not refused. `/contract decompose <ID>` turns it
into an **epic** (`type: epic`) whose `children` are dependency-ordered
Small/Medium contracts. The epic owns the overall success metric
(measured across all children); each child is a normal contract with
`parent` set, verified and promoted in order. Risky children
(migrations, auth) carry `implementation: human-led`. The validator
skips behavior-level checks on an epic (its behaviors live in the
children). See the `contract-decompose` skill.

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

### Slack threading — one channel, no spam (convention)

All Manifest updates post to ONE channel (`#manifest` by default), but
they DON'T flood it. Each contract gets exactly **one top-level
message** (the promotion announcement); every later update — implement
done, verify verdict, canary approval, launch reports day 1/7/14/28,
bug triage — posts as a **threaded reply** under it.

The mechanism: `contract-promote` posts the anchor message and records
its Slack `thread_ts` on the contract:

```yaml
slackThreadTs: "1716192000.123456"   # set by contract-promote
slackChannel: "#manifest"            # the channel the thread lives in
```

Every later skill that posts (implement, verify-deploy, launch-report,
bug-triage) posts with `thread_ts: <slackThreadTs>` so it lands in the
thread, not the channel. Result: the channel shows one line per
contract; click in to see its whole history.

**Exception — urgent alerts.** SLA overdue, a `rollback` verdict, or a
canary auto-pause ALSO post a brief top-level alert that links back to
the thread, so genuinely urgent things aren't buried. Everything else
stays threaded.

### SLA countdown in every update (convention)

Every status update during the build/ship phases — PR comments,
Slack messages, command output — leads with the current SLA line so
the dev always knows where they stand. Get it deterministically:

```bash
node <plugin-root>/scripts/validate.mjs --sla .manifest/contracts/<ID>.md
```

It prints one of:
- `⏳ SLA: 18h 20m left (due <time>)` — on track
- `⏳⚠️ SLA: 3h 10m left (due <time>)` — under 20% of the window left
- `⚠️ SLA OVERDUE by 2h 5m (was due <time>)` — past deadline (exit 1)
- `SLA: not started (promote to start the timer)` — pre-promote

The implement, verify-pr, verify-deploy, and promote skills all
prepend this line. The countdown resolves once the feature hits 100%
prod (then `slaHit` records the final hit/miss).

### Behavior fields

Every behavior needs `instrumentation` and an acceptance criterion. The
other two fields are **contextual**, so the gate fits the behavior
instead of demanding boilerplate:

- **`commsStates`** is a UI concern — required only for **user-facing**
  behaviors (platforms include web/ios/android/etc.). A **server-only**
  behavior (platforms are all `server`/`backend`) is exempt.
- **`perfBudget`** is governed by a policy: `required` (missing/`TBD` is
  a blocker), `warn` (a warning — visible but doesn't block; **the
  default**), or `off` (not checked). Set it per repo via
  `conventions.perfBudget` in `repos.yml`, or per contract via the
  `perfBudgetPolicy` frontmatter field. When checked, you need only
  **one numeric field that's relevant** (e.g. `ttiMs` for UI,
  `p95LatencyMs` for a network call) — a behavior with no network call
  doesn't have to invent a p95.

### Change type — `feature` vs `bug-fix`

`changeType` tells verify how much rigor to apply. The default
(`feature`) runs full rigor. **`bug-fix` deliberately runs lean**, so a
small bug doesn't get feature-grade ceremony:

- **No success-metric / shadow-baseline requirement.** A bug fix's
  "metric" is *the bug is gone + a regression test passes* — not a new
  product-analytics event. The `## Success metrics` section is optional
  for a bug-fix contract.
- **Instrumentation critic OFF.** Don't demand a new event taxonomy. A
  behavior may declare `instrumentation: none` with a one-line rationale.
- **Edge-cases and comms scoped to the change.** Critics evaluate the
  bug's actual surface and the copy that's actually changing — they do
  NOT enumerate exhaustive edge cases (IME, SSR, full Unicode classes,
  drag-drop, …) that a net-new feature would warrant. Such cases are
  *deferred to Out of scope* unless they ARE the bug.
- **Reduced critic set**: edge-cases (scoped), regression, security (if
  relevant). The `minimality` critic always runs and pushes back on
  disproportionate scope.

If a "bug fix" genuinely needs new instrumentation, a flag, or spans
platforms, it isn't a bug fix — set `changeType: feature` (or it's
really a feature contract). The point is to stop a one-line gate from
growing a shadow-observation phase.

### Sizing rules (set by critic-sizing)

| Bucket | Rules |
|---|---|
| **small** | 1 platform, ≤3 behaviors, no schema, no auth, flag-gated |
| **medium** | ≤2 platforms, ≤8 behaviors, additive schema OK, existing vendors |
| **large** | Anything else — exits the pipeline |

## Findings file

Verification produces `.manifest/contracts/<ID>.findings.md`:

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
