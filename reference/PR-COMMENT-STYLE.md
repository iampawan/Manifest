# PR-comment style

The one rule that everything else follows: **a PR comment is read by
the busiest person on the team.** Write so they understand in 10
seconds what's wrong, why it matters, and what to do.

The opposite of this style is what AI tools commonly produce:

> CR-007: useState flag used as concurrency guard. The handler reads
> `isRecording` from state which is stale across rapid renders.
> Suggest `useRef`.

That's technically correct but reads like a compiler error. A junior
dev seeing it asks "what does that *mean*?" A PM seeing it skips it.

This is the same finding rewritten in this style:

> 🐛 **Race condition on rapid clicks**
>
> When the user clicks the mic button twice quickly, the second
> click runs before React has updated `isRecording`. The guard
> thinks the session is still off and fires again — resetting
> `insertedCharCount` to 0.
>
> **Why it matters.** Users who double-tap (common on mobile, common
> when impatient) will lose their dictation character count and may
> see weird state during the brief overlap.
>
> **The fix.** Use `useRef` for the "is it running" flag instead
> of `useState`. Refs update synchronously, so the second click
> sees the right value.
>
> ```ts
> // before
> const [isRecording, setIsRecording] = useState(false)
> const beginSession = useCallback(() => {
>   if (isRecording) return       // stale across rapid clicks
>   setIsRecording(true)
>   void startRecording()
> }, [isRecording, startRecording])
>
> // after
> const isRecordingRef = useRef(false)
> const beginSession = useCallback(() => {
>   if (isRecordingRef.current) return   // synchronous, no race
>   isRecordingRef.current = true
>   void startRecording()
> }, [startRecording])
> ```
>
> `voice-dictation-toolbar-button.tsx:42`

Same information. The second one a junior reads and acts on; a PM
reads and understands the user impact.

## The four-part structure (every finding)

Every PR comment / critic finding follows this:

### 1. Title line — a plain-English diagnosis

- Lead with what's happening, not the rule name. "Race condition on
  rapid clicks" > "useState flag used as concurrency guard."
- One emoji at the start helps scanning: 🐛 bug / ⚠️ risk / 💡 nit
  / 🔒 security / 🐢 perf. One emoji, no more.
- Bold the title. Eight words or fewer.

### 2. What happens — plain English, not code

- Describe the buggy sequence the way you'd describe it to a teammate
  at lunch.
- Name the user action, the system reaction, and the bad outcome.
- No jargon as the lead. "React hasn't re-rendered" is fine *inside*
  the explanation; it can't be the explanation.

### 3. Why it matters — user impact

- One line. Who hits it, how often, what they see.
- "Users who double-tap will lose their character count" is right.
- "This violates React state hygiene" is wrong — that's the rule,
  not the impact.

### 4. The fix — a concrete code snippet

- Show `// before` and `// after`. The diff is the artifact; words
  are the explanation around it.
- If the fix is non-obvious or has tradeoffs, add one line below the
  snippet about why this version works.
- End with the file path and line number.

## What NOT to do

- ❌ Don't lead with the critic ID (CR-007). It's a reference, not a
  headline. Put it at the very end, small.
- ❌ Don't dump the rule name as the title. "useState flag used as
  concurrency guard" is what you found, not what's wrong.
- ❌ Don't write findings without a code snippet. If the fix is genuinely
  prose-only (e.g., "remove this file"), write what to type.
- ❌ Don't stack multiple findings into one comment. One issue per
  comment so reviewers can resolve them individually.
- ❌ Don't write "the user should ...". The user isn't reading this;
  the dev is. Say "you can fix this by ..." or just show the fix.
- ❌ Don't apologize, hedge, or pad. "It might be worth considering
  potentially ..." → just say it.

## Length budget

- **Blocker** finding: up to ~150 words + code snippet.
- **Warning** finding: up to ~80 words + code snippet.
- **Info** finding: one line. If it needs more, it's a warning.

Going over budget is the smell that the finding is two findings.
Split it.

## Applies to

This style applies to every comment Manifest agents post:

- `code-review` critic findings (CR-N)
- `verify-pr` AC-coverage findings
- `critic-*` findings written into `.findings.md` (the human view —
  the JSON file in `.findings.json` keeps the structured fields)
- Implementer self-review comments
- `bug-triage` comments on filed issues
- `/fix-pr` change explanations
- Any `@claude /...` agent reply on a PR

The critics that produce JSON (per `reference/CRITIC-PROTOCOL.md`)
must populate these additional optional fields so the consumer can
render this style without re-parsing the `message`:

```json
{
  "id": "CR-007",
  "critic": "code-review",
  "severity": "warning",
  "plainTitle": "Race condition on rapid clicks",
  "whatHappens": "When the user clicks the mic button twice quickly...",
  "whyItMatters": "Users who double-tap will lose their character count...",
  "theFix": "Use `useRef` for the \"is it running\" flag instead of `useState`...",
  "codeSnippet": "// before\nconst [isRecording, ...]\n\n// after\n...",
  "file": "voice-dictation-toolbar-button.tsx",
  "line": 42,
  "status": "open"
}
```

These fields are **additive** — they don't replace the existing
schema (`message`, `suggestion`, `file`, `line`). They give the
rendering layer the prose it needs without forcing the critic to
do markdown formatting in `message`.

A finding that's missing `plainTitle` or `whatHappens` is a critic
bug — surface it loudly. Don't let the old terse format leak through
because some critic prompt forgot to follow the protocol.
