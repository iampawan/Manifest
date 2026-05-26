> SUPERSEDED in v0.3.0. Sizing is now computed deterministically by
> scripts/validate.mjs (computeSizing). This LLM critic is no longer
> registered. Kept as a record of the original rubric.

---
name: critic-sizing
description: Critic that classifies a verified contract as Small (24h), Medium (72h), or Large (no SLA). The keystone that routes work to the right pipeline path. Runs LAST in contract-verify, after all other critics have produced their findings.
---

# Sizing critic

> **Protocol:** Follow `reference/CRITIC-PROTOCOL.md` at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

The pipeline can only meet its SLAs if the work is correctly sized.
Misclassification is more costly than slow classification — when in
doubt, escalate to the larger bucket.

## Inputs

- The parsed contract.
- The full findings array from the other 8 critics.

## Process

### 1. Refuse if blockers are open

If any other critic emitted a `blocker`, return `complexity: null` with
a finding that says "cannot size until blockers are resolved." Sizing
runs *after* the others for this reason.

### 2. Apply the rubric mechanically

Start with **small** and escalate if any rule fires:

#### Escalates to Medium if any of these hold:
- More than 1 platform in scope
- More than 3 behaviors
- Adds a new email, push, or notification template
- Additive schema change (new column/field, no migration)
- Touches more than 5 files according to regression critic's references
- Behavior calls out to a third-party service this codebase doesn't
  already use

#### Escalates to Large if any of these hold:
- Breaking change to an existing API or data shape
- Schema migration on a table the regression critic flagged as hot
- Touches authentication, authorization, billing, or payment primitives
- Adds a brand-new vendor (not one already integrated)
- 3+ platforms
- Adds a new service / process / background worker
- Any contract field marked `riskOverride: high`
- More than 8 behaviors

### 3. Apply risk override

Even if mechanical rules say Small, escalate to Medium (and warn) if:
- Behavior touches PII or financial data
- Any security critic finding is severity ≥ warning
- The success metric is one the team has publicly committed to

The risk axis matters more than the size axis. A 10-line copy change on
the checkout page is still risky even if it's tiny.

### 4. Emit a sizing finding

Return ONE finding with severity `info` summarizing the decision:

```json
{
  "id": "SZ-001",
  "critic": "sizing",
  "severity": "info",
  "message": "Sized as SMALL — 1 platform (web), 2 behaviors, no schema, flag-gated.",
  "suggestion": "If you intended this for iOS too, add the platform and re-verify (will escalate to Medium).",
  "fragmentRef": "frontmatter",
  "status": "open"
}
```

If escalated, include in the message *which rule* triggered the
escalation — the user needs to know why.

### 5. Set the field

The orchestrator (`contract-verify`) reads your finding and sets
`contract.complexity` to `small`, `medium`, or `large` in the
frontmatter.

## Anti-patterns

- Don't average the rules. ANY one escalating rule wins.
- Don't size a contract with open blockers — refuse.
- Don't size based on "vibe." Cite the specific rule.
