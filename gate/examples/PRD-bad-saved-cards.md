# PRD — Saved payment cards at checkout  ⛔ (fails Ready Check)

*A real-looking but under-specified PRD — the kind that reaches dev today,
triggers a week of clarifying questions, and gets groomed with wrong estimates.
Ready Check blocks it in seconds. Scores 1/11.*

---

Saved payment cards at checkout.

**Goal:** let users pay faster by saving their card.

It should work on the app. Please prioritise for this sprint — marking P0.

Design is mostly done, will share soon. Should be straightforward.

---

## Why this fails the gate (and what dev would have had to chase)

| Item | What's wrong | The question dev would ask |
|---|---|---|
| Success metric | Missing | "Faster by how much? How do we measure success?" |
| Design | "will share soon" = not attached | "Is there a Figma? This was the exact P0 miss last sprint." |
| Scope & platforms | "the app" — which? What's out of scope? | "Android, iOS, both? Is web in? UPI?" |
| What happens today | Missing | "What does the payment screen do now?" |
| Impacted flows | Missing | "Does this touch order-confirmation? Refunds?" |
| Edge cases | Missing | "Expired card? Tokenize fails? No network? Declined?" |
| UI states | Missing | "What shows when there are no saved cards? On error?" |
| Localized copy | Missing | "Strings final? Localized for HI?" |
| Writer impact | Not stated | "Does this affect creators at all?" |
| Instrumentation | Missing | "What events do we fire to measure the metric?" |

Only **goal** is (vaguely) present — and even that isn't measurable. "Should be
straightforward" and "P0" are not requirements.

**The point:** none of these are hard questions. They're basics the PM can
answer in two minutes with Ready Check — *before* an estimate is given, instead
of over a week of back-and-forth after.
