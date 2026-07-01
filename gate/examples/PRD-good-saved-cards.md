# PRD — Saved payment cards at checkout  ✅ (passes Ready Check)

*A complete PRD. Every one of the 11 required items is answered specifically.
This is what "ready for dev grooming" looks like. Gate code: `RC-SAV-…`.*

---

## 1. Problem & goal
New and returning users re-enter full card details on every purchase. Card
entry is the highest-drop step in checkout. **Goal:** let a returning user pay
in one tap with a previously used card.

## 2. Success metric
**+6% checkout conversion for returning payers within 4 weeks** of 100%
rollout, measured in Mixpanel (funnel: `checkout_started → payment_success`,
segment = users with ≥1 prior successful payment). Guardrail: payment-failure
rate does not increase.

## 3. Design
Figma (final, approved): https://figma.com/file/pf-saved-cards
Covers: saved-card list, "pay with saved card" state, add-new-card, and the
manage/delete-card sheet.

## 4. Scope & platforms
**In scope:** Android and iOS apps.
**Out of scope:** web, UPI autopay, saving netbanking, saving UPI IDs. (These
are explicitly deferred, not forgotten.)

## 5. What happens today
The payment screen always renders a blank card form. Nothing is stored; every
purchase requires full re-entry of card number, expiry, and CVV.

## 6. Impacted flows & surfaces
Checkout flow, the payment screen, and the order-confirmation screen (which
will show the masked card used). No change to the cart or catalog.

## 7. Edge cases & error states
- Saved card is **expired** → hide from one-tap, prompt to update.
- **Tokenization fails** at save → don't store; show retriable error.
- **No network** during pay → standard offline error, no charge.
- User **deletes a card mid-checkout** → fall back to add-new-card.
- **Multiple saved cards** → default to most recently used, allow switch.
- Card **declined** on saved-card pay → surface issuer message, offer another.

## 8. UI states (empty / loading / done / error)
- **Empty:** "No saved cards yet" with an add-card CTA.
- **Loading:** spinner on tokenize / on pay.
- **Success:** confirmation toast, card saved for next time.
- **Error:** "Couldn't save card, please try again."

## 9. Localized values / copy
All strings finalized and localized for EN and HI; locale from app settings.
Masked-card format: `•••• 4242`.

## 10. Writer / creator impact
None — this is a listener-side payment change. Content/creator tooling is not
affected.

## 11. Instrumentation / events
`card_saved`, `saved_card_used`, `tokenize_failed`, `saved_card_deleted`
(Mixpanel). Payloads include card network and success/failure reason.

## Dependencies *(recommended)*
Payments backend must expose a tokenization API and a list-saved-cards endpoint.

## Rollout *(recommended)*
Behind flag `saved_cards`; ramp 1% → 10% → 50% → 100% with a 24h bake at each
stage; watch payment-failure guardrail.
