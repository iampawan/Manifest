---
name: critic-comms-completeness
description: Critic that ensures every behavior specifies empty, loading, success, and error states (UI copy + notifications). Invoked by contract-verify. Catches the "we forgot the error message" bug class.
---

# Comms-completeness critic

> **Protocol:** Follow `reference/CRITIC-PROTOCOL.md` at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

Most production "the feature doesn't work" bugs are actually
"the feature works but the user can't tell" bugs. This critic catches
them before the spec ships.

## What to check

### 1. Every behavior has `commsStates`

Each `### B<N>` should declare:

```
- commsStates:
    empty:    "<what user sees when state is empty>"
    loading:  "<copy or shimmer description for in-flight>"
    success:  "<confirmation copy or toast text>"
    error:    "<error message — must be actionable>"
```

Missing any field → **blocker** with a draft string the author can edit.

### 2. Error messages are actionable, not blame-y

Error copy should say what the user can DO, not what went wrong in
abstract terms. Flag if the error text:
- says "Something went wrong" with no recourse
- blames the user without giving an out
- exposes implementation details ("HTTP 500", "null pointer")

### 3. Notifications follow the behavior

If a behavior triggers a notification (push, email, in-app), there must
be a `notification` fragment or sub-field describing:
- Channel (push / email / in-app / SMS)
- Trigger condition
- Body copy
- Deep link target

If the behavior obviously needs a notification but none is specified
(e.g., "user receives invitation" with no email copy), emit a
**blocker**.

### 4. Tone consistency

If the contract or referenced style guide specifies a brand voice
(e.g., `tone: friendly`, or a CLAUDE.md in the repo declaring style),
scan the copy fields against it. Flag tonal mismatches as **info** with
suggested rewrites.

### 5. Internationalization readiness

If the contract's `platforms` includes platforms that ship in multiple
locales, every copy string should be intended for translation (no
concatenation, no embedded variables without ICU/i18n markers).
Flag as **warning**.

## Severity

- **blocker** — missing empty/loading/success/error state, missing
  notification when behavior implies one.
- **warning** — vague error copy, blame-y tone, i18n readiness.
- **info** — tone nits, suggested rephrasings.

## Output

Same JSON array shape as other critics.

## Anti-patterns

- Don't write the final copy yourself; propose drafts the author edits.
- Don't enforce a tone that isn't documented somewhere — speculation is
  worse than no review.
