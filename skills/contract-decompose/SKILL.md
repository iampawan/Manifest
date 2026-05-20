---
name: contract-decompose
description: Turn a Large contract into a dependency-ordered sequence of Small/Medium child contracts, with risky parts (migrations, auth) flagged as human-led. Use when a contract is sized Large and the user says "decompose", "break this down", "split this epic", or invokes `/contract decompose <ID>`. Large isn't refused — it's made tractable.
---

# Contract decomposer (smart Large support)

A Large contract shouldn't be agent-shipped on a 24/72h timer — but it
shouldn't be thrown over the wall either. Your job: break it into a
sequence of independently-shippable Small/Medium child contracts,
ordered by dependency, so a multi-week epic becomes a series of
24h/72h pieces. The Large contract stays as the **epic** that owns the
overall success metric and tracks aggregate progress.

## When this runs

- A contract was sized `large` by the validator, and the user wants to
  proceed (rather than abandon).
- Invoked via `/contract decompose <ID>` or routed here from
  `/contract promote` when it detects a Large contract.

## Process

### 1. Read the Large contract

Read `.shipline/contracts/<ID>.md`. Confirm `complexity: large`.
Pull the goal, success metrics, all behaviors, and the critic findings
(the critics still ran on the Large spec — use their edge cases and
regression notes to inform the split).

### 2. Find the natural seams

Decompose along the lines that make each piece independently
shippable and valuable. Good seams, in rough priority:

- **Platform**: ship web first, then iOS, then Android (each a child).
- **Behavior cluster**: group behaviors that share a surface or data
  model into one child; split unrelated ones.
- **Risk isolation**: pull migrations, auth/billing changes, and new
  infrastructure into their OWN children, flagged human-led (see §4).
- **Enablement → feature**: a child that adds the backend endpoint
  (behind a flag, no UI) before the child that adds the UI consuming
  it. The first ships safely with nothing user-visible.
- **Read before write**: ship the read/display path before the
  mutation path when that lets you validate data independently.

Each child should be Small or Medium on its own. If a proposed child
is still Large, recurse — decompose it further.

### 3. Order by dependency

Build a DAG: which children must ship before which. A child that
consumes an API can't ship before the child that adds the API
(unless flag-gated to be inert). Produce a linear order that respects
the DAG, with parallelizable children noted.

### 4. Flag the human-led children

Some children genuinely shouldn't be agent-implemented:
- Schema migrations on hot tables
- Auth / billing / payment primitive changes
- New service / infrastructure standup
- Anything the security or scalability critic flagged as blocker-level
  on the Large spec

Mark these `implementation: human-led`. They still get a full
contract (spec + critics + ACs + tests), but a human writes the code;
the pipeline does verify + ship. This is the honest part — Shipline
helps spec and verify the risky pieces without pretending to safely
auto-implement them.

### 5. Write the epic + children

Update the parent contract frontmatter to mark it an epic:

```yaml
type: epic
complexity: large
children: [AUTH-12a, AUTH-12b, AUTH-12c, AUTH-12d]
successMetric: <the overall metric — measured across the whole epic>
```

Create each child as its own contract at
`.shipline/contracts/<childId>.md`, with:
- `parent: <ID>` in frontmatter
- `dependsOn: [<other-childIds>]` for ordering
- `implementation: agent | human-led`
- Its own behaviors, instrumentation, perf, comms, ACs (a real
  Small/Medium contract — run `/contract verify` on each)
- A slice of the parent's goal

Write a decomposition plan to `.shipline/contracts/<ID>.decomposition.md`:

```markdown
# AUTH-12 decomposition

Epic goal: <one line>. Success metric: <metric> (measured across all children).

## Ship order

1. AUTH-12a — Backend: add /auth/v2 endpoint behind flag (Medium, agent)
   depends on: none
2. AUTH-12b — Data: migrate sessions table (Small, HUMAN-LED — hot table)
   depends on: AUTH-12a
3. AUTH-12c — Web: new login UI on /auth/v2 (Small, agent)
   depends on: AUTH-12a, AUTH-12b
4. AUTH-12d — iOS + Android: mobile login on /auth/v2 (Medium, agent)
   depends on: AUTH-12c

## Notes
- 12b is human-led: migration on the sessions table (security critic
  flagged session-token handling as blocker-level on the epic spec).
- 12c and 12d can overlap once 12b ships.
```

### 6. Report

Tell the user:
- The epic and its N children, in ship order, with size + agent/human
- Which children are human-led and why
- "Each child is a normal contract. Verify and promote them in order:
  start with `/contract verify AUTH-12a`. The epic tracks the overall
  metric; you'll see it land when the last child does."

## Anti-patterns

- Don't create children that are still Large — recurse until each is
  Small/Medium.
- Don't mark a migration or auth change as agent-implementable to make
  the plan look cleaner. Human-led is the honest call; respect it.
- Don't lose the success metric — it lives on the epic and is measured
  across all children, not per-child.
- Don't decompose into so many tiny children that coordination
  overhead exceeds the benefit. Aim for the fewest independently-
  shippable pieces, not the most.
- Don't auto-promote children. The user verifies and promotes each in
  dependency order.
