// Unit tests for the Ready Check engine (deterministic PM-side gate).
// Run with: node --test  (from repo root or eval/).
//
// The engine is deterministic, so these are exact-match. If a change to
// ready-check.mjs alters scoring or the gate-code algorithm, a test fails —
// that's the guard that keeps the web-page JS port and dev-side enforcement
// verifying the same codes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RUBRIC,
  checkReadiness,
  isSatisfied,
  gateCode,
  verifyGateCode,
  renderHandoff,
  parseHandoff,
  cacheChecks,
  renderPrd,
  djb2,
  CODE_RE,
} from "../scripts/ready-check.mjs";

// A complete, ready PRD (the "saved cards" demo).
const ready = {
  title: "Saved payment cards at checkout",
  items: {
    goal:   { detail: "Returning users re-enter card details every time and drop at payment." },
    metric: { detail: "+6% checkout conversion for returning payers in 4 weeks (Mixpanel)." },
    design: { detail: "https://figma.com/file/pf-saved-cards final approved" },
    scope:  { detail: "Android, iOS. Out of scope: web, UPI autopay." },
    oldbeh: { detail: "Payment screen always shows a blank card form; nothing stored." },
    flows:  { detail: "Checkout flow, payment screen, order-confirmation." },
    edge:   { detail: "Expired card, tokenize fails, no network, delete mid-checkout." },
    states: { detail: "Empty: no saved cards. loading spinner. success toast. error: try again." },
    l10n:   { detail: "All strings final, localised EN/HI." },
    writer: { na: true },
    events: { detail: "card_saved, saved_card_used, tokenize_failed." },
    deps:   { detail: "Payments backend exposes tokenization API." },
    rollout:{ detail: "Flag saved_cards, ramp 1/10/50/100." },
  },
};

// The rough version — only a vague goal.
const rough = {
  title: "Saved payment cards at checkout",
  items: { goal: { detail: "Let users pay faster by saving their card." } },
};

test("complete PRD clears at 11/11", () => {
  const v = checkReadiness(ready);
  assert.equal(v.cleared, true);
  assert.equal(v.met, 11);
  assert.equal(v.total, 11);
  assert.equal(v.pct, 100);
  assert.deepEqual(v.missing, []);
});

test("rough PRD is blocked and lists the gaps", () => {
  const v = checkReadiness(rough);
  assert.equal(v.cleared, false);
  assert.equal(v.met, 1);
  assert.equal(v.missing.length, 10);
  assert.ok(v.missing.some((m) => m.id === "design"));
  assert.ok(v.missing.some((m) => m.id === "metric"));
});

test("skippable item passes only when its reason is set", () => {
  const design = RUBRIC.find((r) => r.id === "design");
  assert.equal(isSatisfied(design, { na: true }), true);          // no-ui skip ok
  assert.equal(isSatisfied(design, {}), false);
  const goal = RUBRIC.find((r) => r.id === "goal");
  assert.equal(isSatisfied(goal, { na: true }), false);            // NOT skippable — na ignored
});

test("short answers don't count", () => {
  const goal = RUBRIC.find((r) => r.id === "goal");
  assert.equal(isSatisfied(goal, { detail: "x" }), false);
  assert.equal(isSatisfied(goal, { detail: "yes" }), true);
});

test("gate code only mints when ready, and matches format", () => {
  assert.equal(gateCode(rough), null);
  const code = gateCode(ready);
  assert.ok(CODE_RE.test(code), `bad format: ${code}`);
  assert.ok(code.startsWith("RC-SAV-"));
});

test("gate code is deterministic", () => {
  assert.equal(gateCode(ready), gateCode(structuredClone(ready)));
});

test("verify: valid / stale / invalid / not-ready", () => {
  const code = gateCode(ready);
  assert.equal(verifyGateCode(code, ready), "valid");

  const tampered = structuredClone(ready);
  tampered.items.scope.detail = "Android, iOS, and now WEB too";  // changed after clearing
  assert.equal(verifyGateCode(code, tampered), "stale");

  assert.equal(verifyGateCode("RC-XXX-000000", ready), "stale");  // well-formed but wrong
  assert.equal(verifyGateCode("not-a-code", ready), "invalid");
  assert.equal(verifyGateCode(code, rough), "not-ready");
});

test("hand-off round-trips and re-verifies", () => {
  const block = renderHandoff(ready, { date: "01 Jul 2026" });
  assert.match(block, /READY CHECK PASSED/);
  assert.match(block, /Ready-Check: RC-SAV-/);
  assert.match(block, /figma\.com/);

  const parsed = parseHandoff(block);
  assert.equal(parsed.code, gateCode(ready));
  // Re-verifying the parsed hand-off must still be valid (design + scope + bullets survive).
  const v = verifyGateCode(parsed.code, { title: parsed.title, items: parsed.items });
  assert.equal(v, "valid");
});

test("backend-only feature can clear without design or UI states", () => {
  const backend = structuredClone(ready);
  backend.items.design = { na: true };
  backend.items.states = { na: true };
  const v = checkReadiness(backend);
  assert.equal(v.cleared, true);
  assert.match(renderHandoff(backend), /Design: \(no UI\)/);
});

test("brand-new feature can skip old-behavior", () => {
  const fresh = structuredClone(ready);
  delete fresh.items.oldbeh;                     // missing → blocked
  assert.equal(checkReadiness(fresh).cleared, false);
  fresh.items.oldbeh = { na: true };             // explicitly new → clears
  assert.equal(checkReadiness(fresh).cleared, true);
});

test("cacheChecks flags event-naming convention drift, no repo needed", () => {
  const cache = { events: { naming_patterns: { convention: "snake_case" } } };
  const camel = structuredClone(ready);
  camel.items.events.detail = "cardSaved, savedCardUsed";
  const notes = cacheChecks(camel, cache);
  assert.ok(notes.some((n) => n.id === "events" && n.severity === "warning"));
  // snake_case names produce no naming warning
  assert.equal(cacheChecks(ready, cache).some((n) => n.id === "events"), false);
});

test("cacheChecks returns nothing without a cache", () => {
  assert.deepEqual(cacheChecks(ready, null), []);
});

test("a waiver with a reason clears the item and is recorded", () => {
  const w = structuredClone(ready);
  delete w.items.metric.detail;                       // no answer
  assert.equal(checkReadiness(w).cleared, false);     // blocked without justification
  w.items.metric = { waived: true, reason: "metric owned by growth team, decision pending this week" };
  const v = checkReadiness(w);
  assert.equal(v.cleared, true);                      // waiver clears it
  assert.equal(v.waivers.length, 1);
  assert.equal(v.waivers[0].id, "metric");
});

test("a waiver with no reason does NOT clear", () => {
  const w = structuredClone(ready);
  w.items.metric = { waived: true, reason: "" };
  assert.equal(checkReadiness(w).cleared, false);
  assert.ok(checkReadiness(w).missing.some((m) => m.id === "metric"));
});

test("waivers surface in the hand-off and round-trip through verify", () => {
  const w = structuredClone(ready);
  w.items.metric = { waived: true, reason: "owned by growth, decision pending" };
  const block = renderHandoff(w, { date: "01 Jul 2026" });
  assert.match(block, /1 waiver\(s\), dev to accept/);
  assert.match(block, /Waivers \(dev to accept or push back\)/);
  assert.match(block, /\[metric\].*reason: owned by growth/);

  const parsed = parseHandoff(block);
  assert.equal(parsed.items.metric.waived, true);
  assert.equal(verifyGateCode(parsed.code, { title: parsed.title, items: parsed.items }), "valid");
});

test("changing a waiver reason changes the code (tamper-evident)", () => {
  const a = structuredClone(ready); a.items.metric = { waived: true, reason: "reason one" };
  const b = structuredClone(ready); b.items.metric = { waived: true, reason: "reason two" };
  assert.notEqual(gateCode(a), gateCode(b));
});

test("renderPrd produces an 11-section PRD with the gate code", () => {
  const prd = renderPrd(ready, { date: "01 Jul 2026" });
  assert.match(prd, /^# PRD — Saved payment cards at checkout/);
  assert.match(prd, /Ready Check: \*\*RC-SAV-/);
  for (const h of ["1. Problem & goal", "3. Design", "7. Edge cases", "11. Instrumentation"]) assert.ok(prd.includes(h), `missing ${h}`);
  assert.match(prd, /## Rollout/);
});

test("renderPrd shows N/A defaults and waivers", () => {
  const backend = structuredClone(ready);
  backend.items.design = { na: true };
  backend.items.metric = { waived: true, reason: "growth owns it" };
  const prd = renderPrd(backend);
  assert.match(prd, /No UI \(backend only\)\./);
  assert.match(prd, /## Waivers \(dev to accept\)/);
  assert.match(prd, /growth owns it/);
});

test("djb2 is stable (pins the cross-port algorithm)", () => {
  assert.equal(djb2("abc"), 193485963);
  assert.equal(djb2(""), 5381);
});
