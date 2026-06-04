# Bug patterns — Manifest's growing catalog

The implementer reads this file and **avoids these patterns**.
The `code-review` critic reads this file and **looks for these patterns**.
Both stay in sync because both reference the same source.

Every time an external reviewer (Cursor BugBot, a human reviewer, a
postmortem) catches a class of bug that Manifest didn't flag itself,
**the pattern goes here**. The library only grows; it never resets.

## How to add a pattern

When a Cursor finding (or a postmortem cause) is something the
implementer should have avoided, add an entry below:

```
### <ID> — <plain-English name>

**Where it bites**: <one-line user-visible impact>

**The shape**: <a minimal code example that exhibits the bug>

**Why it slips past basic review**: <one line — what makes it
non-obvious>

**The fix**: <a minimal code example after the fix>

**Where first observed**: <PR link, postmortem ID, or "internal QA">
```

Pattern IDs follow `BP-NNN`, monotonically increasing. Don't renumber
when you remove a pattern (rare); strike through with `~~BP-007~~`
and a one-line reason.

## Rules

- **The implementer's pre-write step** (`skills/implement/SKILL.md`
  step 3) must scan this file and pre-emptively avoid every active
  pattern.
- **The code-review critic** (`skills/code-review/SKILL.md`) must
  check every active pattern on every diff. Findings cite the
  `BP-NNN` in their `id` extension (e.g., `CR-007` with metadata
  `{ "bugPattern": "BP-003" }`).
- **The self-review loop** in the implementer runs `code-review`
  with the **full** library on every iteration — not just the
  previous round's findings. This is what stops the "fix one,
  Cursor finds another" cycle: by iteration 2, the agent has
  scanned for every pattern in the catalog, not just the class it
  just fixed.
- **Stack-agnostic phrasing**. Patterns describe the shape, not a
  specific language. The Examples can be in whichever language is
  clearest, but the pattern applies wherever the shape appears.

---

## Patterns

### BP-001 — Empty catch followed by side effects assuming success

**Where it bites**: A failed action reports as successful in the UI,
analytics, or downstream state. User sees "recording started" but no
recording happens. Funnels are skewed.

**The shape**:

```ts
try {
  recognition.start()
} catch (e) {
  // empty
}
setIsRecording(true)                      // pretends success
trackEvent('dictation_started', { ... })  // pretends success
```

**Why it slips past basic review**: TypeScript and the basic `no-empty`
ESLint rule allow `catch {}` if `allowEmptyCatch: true`. Reviewers
focused on the happy path miss the catch. The bug only surfaces when
`start()` actually throws (mic busy, prior session not torn down).

**The fix**:

```ts
try {
  recognition.start()
  setIsRecording(true)
  trackEvent('dictation_started', { ... })
} catch (e) {
  reportError(e, { surface: 'dictation' })
  toast('Couldn't start dictation. Check your microphone.')
  // do NOT setIsRecording(true); do NOT fire the start event
}
```

**Where first observed**: Pocket-Fm/unified-editor PR (UWS-502
voice-dictation), Cursor BugBot 2026-06-04.

---

### BP-002 — useState flag as concurrency guard

**Where it bites**: Rapid double-action (double-click, double-tap,
double-submit) bypasses the guard and re-enters. State that was
supposed to be guarded (counters, accumulators, in-flight requests)
gets reset or duplicated.

**The shape**:

```ts
const [isRunning, setIsRunning] = useState(false)

const handleClick = useCallback(() => {
  if (isRunning) return            // stale read across rapid clicks
  setIsRunning(true)
  beginAction()
}, [isRunning])
```

React batches state updates and may not have re-rendered between
two rapid clicks. The second click reads the *stale* `isRunning`
(still `false`) and re-enters.

**Why it slips past basic review**: It looks textbook React. The
race is invisible until tested with `userEvent.dblClick` or a real
double-tap.

**The fix**:

```ts
const isRunningRef = useRef(false)

const handleClick = useCallback(() => {
  if (isRunningRef.current) return  // synchronous read; no race
  isRunningRef.current = true
  beginAction()
}, [])

// or: disable the button while in flight
<button disabled={isRunning} onClick={handleClick}>...</button>
```

For complex flows, use both — `useRef` for the guard, `useState` for
the UI's disabled flag.

**Where first observed**: Pocket-Fm/unified-editor PR (UWS-502
voice-dictation), Cursor BugBot 2026-06-04.

---

### BP-003 — No-op / silently-swallowed errors

**Where it bites**: A failure happens, nothing tells the user, nothing
tells the team. Reported as "it just doesn't work" weeks later. The
support ticket has no logs to trace.

**The shape**:

```ts
try {
  await api.savePreference(...)
} catch (e) {
  console.log(e)   // not Sentry, not user-facing, just stdout in dev
}
```

or:

```ts
try {
  parse(input)
} catch (e) {
  // intentionally ignored
}
return null  // and the caller does nothing meaningful with null
```

**Why it slips past basic review**: `console.log` looks like
logging. The reviewer sees "error is handled" and moves on. In
production there's no console reader, the error vanishes.

**The fix**:

```ts
try {
  await api.savePreference(...)
} catch (e) {
  reportError(e, { surface: 'preferences.save', userId })
  toast('Couldn't save your preference. Try again.')
  // OR re-throw if the caller can handle it
}
```

Every catch must answer two questions: (a) is the user told?
(b) is the team told? If both are "no," it's BP-003.

**Where first observed**: Pocket-Fm/unified-editor PR (UWS-502
voice-dictation), Cursor BugBot 2026-06-04.

---

### BP-004 — Analytics fired before action succeeded

**Where it bites**: Funnel metrics lie. `feature_started` count is
higher than `feature_completed` count by more than it should be,
because `_started` fires even when the start failed.

**The shape**:

```ts
trackEvent('checkout_started')         // fires unconditionally
const ok = await beginCheckout()
if (!ok) return showError()
// no start event was actually a real start
```

**Why it slips past basic review**: Analytics is often added late;
reviewers don't think about funnel math.

**The fix**:

```ts
const ok = await beginCheckout()
if (!ok) {
  trackEvent('checkout_start_failed', { reason })
  return showError()
}
trackEvent('checkout_started')         // fires only on real start
```

**Where first observed**: Inferred from BP-001 — same root pattern;
gets its own ID because the fix is different (don't move catch, move
the event-fire).

---

### BP-005 — State writes after unmount / dispose

**Where it bites**: React warns "Cannot update state on an unmounted
component." Flutter throws "setState called after dispose." Go panics
on a channel send to a closed channel. Memory leaks. Sentry noise.

**The shape**:

```ts
useEffect(() => {
  fetch('/data').then(res => {
    setData(res)   // component may be unmounted by now
  })
}, [])
```

**Why it slips past basic review**: Works fine 99% of the time.
The 1% is a route change mid-fetch.

**The fix**:

```ts
useEffect(() => {
  let alive = true
  fetch('/data').then(res => {
    if (alive) setData(res)
  })
  return () => { alive = false }
}, [])

// or, with AbortController for cancellation upstream:
useEffect(() => {
  const ctrl = new AbortController()
  fetch('/data', { signal: ctrl.signal })
    .then(res => setData(res))
    .catch(err => { if (err.name !== 'AbortError') reportError(err) })
  return () => ctrl.abort()
}, [])
```

**Where first observed**: Common React pattern; called out by Cursor on
multiple repos in the wild. Promoted here as a default check.

---

### BP-006 — Effect missing dependencies (or worse, lying about them)

**Where it bites**: Effect uses a value but doesn't list it in deps;
the effect closes over a stale value. Or worse, the developer added
`// eslint-disable-next-line react-hooks/exhaustive-deps` to silence
the warning.

**The shape**:

```ts
useEffect(() => {
  setupListener(userId)   // userId is read, not declared
}, [])
```

or:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { ... }, [a, b])  // missing c, with a comment hiding it
```

**Why it slips past basic review**: ESLint catches it *if* the rule
is on and not disabled. Many repos disable it locally for
"refactoring later."

**The fix**: list every value the effect reads. If you need to
intentionally not re-run on a value change, refactor — extract to a
ref or restructure the effect — don't lie with `disable-next-line`.

`react-hooks/exhaustive-deps: error` (not warn) at the repo's eslint
root is the mechanical fix. See `reference/RECOMMENDED-LINT-RULES.md`.

**Where first observed**: Common React; promoted here as a default
check.

---

## Stack-specific equivalents

Each pattern above has a canonical analogue in other stacks. The
critic should flag them by the same `BP-NNN` even when the language
differs:

| Pattern | TS/React | Flutter | Go | Python |
|---|---|---|---|---|
| BP-001 | empty `catch` + setState | empty `catch` + setState | empty `if err != nil {}` + side effects | bare `except: pass` + state mutation |
| BP-002 | `useState` race | `setState` race in BLoC stream | unbuffered channel read race | shared dict mutation without lock |
| BP-003 | `console.log(e)` | `print(e)` | `_ = err` | `pass` in except |
| BP-005 | state after unmount | `setState` after `dispose` | send on closed channel | task after loop close |
| BP-006 | missing effect deps | missing `riverpod` deps | missing context propagation | n/a |

When adding a new pattern in TS, also write the Go / Flutter
equivalent if obvious; this keeps the catalog cross-stack.

---

## How the catalog gets used end-to-end

```
PR is shipped → Cursor / human / postmortem flags a pattern we missed
              ↓
        add BP-NNN entry here
              ↓
   next /implement run reads this file as part of pre-write recon
   (avoids the pattern at write time)
              ↓
   next /implement self-review runs code-review with the full library
   (catches the pattern if it slipped through anyway)
              ↓
   pattern is permanently caught from this point forward
```

The catalog has a one-way ratchet: every Cursor finding makes the
next PR cleaner. No pattern is ever caught twice.

---

## Audit

Quarterly, scan recent PRs against the catalog:

- Patterns flagged by external reviewers (Cursor, humans) but NOT in
  this file → add as BP-NNN.
- Patterns in this file but never triggered by the critic → either
  the critic prompt is missing the cue, or the pattern is no longer
  relevant; investigate and update.

The audit lives at `eval/bug-patterns.test.mjs` (TBD) — a future
patch will add a recall scorer that re-runs the critic against a
fixture diff per pattern and fails CI if any pattern's detection
drops.
