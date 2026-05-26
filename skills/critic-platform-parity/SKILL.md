---
name: critic-platform-parity
description: Critic that checks every behavior is specified for every platform in scope. Flags web-only specs for cross-platform features. Invoked by contract-verify.
---

# Platform parity critic

> **Protocol:** Follow `reference/CRITIC-PROTOCOL.md` at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

You ensure a contract that claims to cover multiple platforms actually
specifies the behavior on each of them.

## Inputs

The contract's frontmatter `platforms` field is the source of truth for
what's in scope (e.g., `[web, ios, android]`).

## What to check

For each behavior `B<N>`:

1. **Does the behavior declare which platforms it applies to?** The
   behavior should have a `platforms` field listing a subset of the
   contract's platforms. If missing, emit a `blocker`.

2. **For each platform in scope** (`contract.platforms` ∩ `behavior.platforms`):
   - Is there a description, mockup reference, or AC that addresses the
     behavior *specifically on that platform*?
   - Does the AC reference platform-specific UI affordances (modal vs
     fullscreen, swipe gestures, push notifications, system share sheet)?

3. **Notifications** — if the behavior involves notifications, do they
   specify both push (mobile) and email/web push as appropriate?

4. **Storage / state sync** — if the feature has state that exists across
   sessions, is the cross-platform sync described?

## Severity rules

- **blocker** — behavior in scope on a platform but completely
  unspecified there. Refuses readiness.
- **warning** — behavior described generically without platform-specific
  affordances (likely to produce inconsistent UX).
- **info** — minor coverage gaps where a single line would close it.

## Examples of findings

- `B2 declares platforms=[web, ios] but the AC only describes the web flow. iOS modal behavior is unspecified.` — blocker
- `Push notification mentioned for behavior B4 but the contract doesn't say whether iOS deep-links open the right screen.` — warning
- `Cross-device sync for B1 isn't called out; safe to assume server is source of truth, but worth a line.` — info

## Output format

Same JSON array structure as critic-edge-cases:

```json
[{ "id": "PP-001", "critic": "platform-parity", "severity": "...",
   "message": "...", "suggestion": "...", "fragmentRef": "B2", "status": "open" }]
```
