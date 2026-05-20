---
name: fix
description: Express lane for trivial bugs and tiny changes — skips the full contract ceremony. Use for one-line fixes, copy/CSS tweaks, config changes, dependency bumps. Triages size and escalates to /contract if the change turns out bigger than trivial.
---

# /fix <description-or-bug-link>

The fast path. For changes too small to deserve a contract.

## Usage

```
/fix "OTP timer doesn't reset when app is backgrounded"
/fix https://your-org.atlassian.net/browse/PROD-1234
/fix "bump lodash to 4.17.21"
/fix "checkout button copy: 'Buy' → 'Buy now'"
```

Invokes the **quick-fix** skill: triage → fix → regression test → PR.
No critics, no SLA, no launch report.

## When to use /fix vs /contract

| Use `/fix` (express) | Use `/contract` (full) |
|---|---|
| One-line bug fix with clear repro | New user-facing behavior |
| Copy / CSS / config tweak | Needs a new analytics event |
| Dependency bump | Touches 2+ platforms |
| Localized to one root cause | Schema change |
| No new event / schema / platform | Edge cases genuinely matter |
| Minutes | Touches auth / billing |

`/fix` triages first. If your "quick fix" is actually a feature (adds
an event, spans platforms, changes the schema), it stops and points
you at `/contract new` — so the fast path stays safe.

## When even /fix is overkill

For a literal typo, a single CSS value, or a config flip, just edit
the file and commit — no command needed. `/fix` is for small changes
you still want as a tracked PR with a regression test. If you don't
need either, skip it.

## Output

- A lightweight fix record at `.shipline/fixes/<ID>.md`
- The fix + a regression test (in the repo's stack)
- A PR titled `[FIX-NN] <title>`

No contract, no behaviors, no critics. Proportional to the change.
