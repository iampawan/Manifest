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
  prdHash,
  verifyFreeze,
  djb2,
  CODE_RE,
  ballLedger,
  effectiveSla,
  epicRollup,
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

test("prdHash is stable and whitespace-insensitive", () => {
  assert.equal(prdHash("Hello   world"), prdHash("hello world"));
  assert.notEqual(prdHash("a"), prdHash("b"));
  assert.match(prdHash("x"), /^H[A-Z0-9]{7}$/);
});

test("freeze stamp is emitted only with meta.freeze and round-trips", () => {
  const plain = renderHandoff(ready, { date: "01 Jul 2026" });
  assert.ok(!/PRD-Hash:/.test(plain));                       // off by default

  const frozen = renderHandoff(ready, { date: "01 Jul 2026", freeze: true, source: { type: "confluence", id: "2434269252", version: "12" } });
  assert.match(frozen, /Source: confluence 2434269252 v12/);
  assert.match(frozen, /PRD-Hash: H/);
  const p = parseHandoff(frozen);
  assert.equal(p.source.version, "12");
  assert.equal(p.prdHash, prdHash(renderPrd(ready)));
  assert.equal(verifyGateCode(p.code, { title: p.title, items: p.items }), "valid");  // gate code unaffected
});

test("verifyFreeze detects source, design, and content drift", () => {
  const p = { source: { version: "12" }, designVersion: "9981", prdHash: "HABC1234" };
  assert.equal(verifyFreeze(p, { version: "12", designVersion: "9981", prdHash: "HABC1234" }), "valid");
  assert.equal(verifyFreeze(p, { version: "13" }), "stale-source");                       // page edited
  assert.equal(verifyFreeze(p, { version: "12", designVersion: "9990" }), "stale-design"); // design changed
  assert.equal(verifyFreeze(p, { version: "12", designVersion: "9981", prdHash: "HZZZ9999" }), "stale-content");
  assert.equal(verifyFreeze({}, {}), "valid");                                            // nothing to compare
});

test("Design-Version round-trips through the hand-off + freeze stamp", () => {
  const frozen = renderHandoff(ready, { freeze: true, source: { type: "confluence", id: "24", version: "12" }, design: { version: "9981" } });
  assert.match(frozen, /Design-Version: 9981/);
  const p = parseHandoff(frozen);
  assert.equal(p.designVersion, "9981");
  assert.equal(verifyFreeze(p, { version: "12", designVersion: "9990" }), "stale-design");
});

test("djb2 is stable (pins the cross-port algorithm)", () => {
  assert.equal(djb2("abc"), 193485963);
  assert.equal(djb2(""), 5381);
});

// ── PM accountability ledger ──
const H = 3.6e6;
const ledEvents = [
  { by: "dev", at: "2026-07-01T00:00:00Z" }, // dev holds 2h
  { by: "pm",  at: "2026-07-01T02:00:00Z" }, // dev→pm bounce; pm holds 3h
  { by: "dev", at: "2026-07-01T05:00:00Z" }, // dev holds final 1h to `now`
];
const ledNow = new Date("2026-07-01T06:00:00Z").getTime();

test("ballLedger: dev/pm time, bounces, holder", () => {
  const l = ballLedger(ledEvents, ledNow);
  assert.equal(l.devMs, 3 * H);          // 2h + 1h
  assert.equal(l.blockedOnPmMs, 3 * H);  // pm held 3h
  assert.equal(l.bounces, 1);            // one dev→pm handoff
  assert.equal(l.holder, "dev");
});

test("ballLedger: empty → dev holds, nothing blocked", () => {
  const l = ballLedger([], ledNow);
  assert.equal(l.holder, "dev");
  assert.equal(l.blockedOnPmMs, 0);
  assert.equal(l.bounces, 0);
});

test("effectiveSla pauses while blocked on PM", () => {
  // 8h SLA, started 00:00, now 06:00 → 6h elapsed, 3h with PM → dev charged 3h.
  const e = effectiveSla(8 * H, "2026-07-01T00:00:00Z", ledEvents, ledNow);
  assert.equal(e.devElapsed, 3 * H);
  assert.equal(e.blockedOnPmMs, 3 * H);
  assert.equal(e.remainingMs, 5 * H);
  assert.equal(e.overdue, false);
});

test("effectiveSla: without the pause the dev would be overdue", () => {
  // Same clock, but if PM-blocked time counted, 6h elapsed > 5h SLA = overdue.
  const naiveElapsed = ledNow - new Date("2026-07-01T00:00:00Z").getTime();
  assert.ok(naiveElapsed > 5 * H);                       // naive: overdue
  const e = effectiveSla(5 * H, "2026-07-01T00:00:00Z", ledEvents, ledNow);
  assert.equal(e.overdue, false);                        // paused: still on time (3h dev < 5h)
});

// ── Epic rollup (multi-person feature) ──
// A (BE, landed) → B (FE, in flight) and C (FE, ready) both depend on A →
// D (FE, blocked) depends on B + C.
const epicKids = [
  { id: "SC-a", owner: "be1", repo: "backend", size: "M", landed: true, dependsOn: [] },
  { id: "SC-b", owner: "fe1", repo: "web", size: "M", status: "promoted", dependsOn: ["SC-a"] },
  { id: "SC-c", owner: "fe2", repo: "web", size: "S", status: "planned", dependsOn: ["SC-a"] },
  { id: "SC-d", owner: "fe1", repo: "web", size: "S", status: "planned", dependsOn: ["SC-b", "SC-c"] },
];

test("epicRollup: per-child state", () => {
  const r = epicRollup(epicKids);
  const s = (id) => r.rows.find((x) => x.id === id).state;
  assert.equal(s("SC-a"), "landed");
  assert.equal(s("SC-b"), "promoted");                   // deps met (A landed), in flight
  assert.equal(s("SC-c"), "ready");                      // deps met, not started
  assert.equal(s("SC-d"), "blocked");                    // B + C not landed
  assert.deepEqual(r.rows.find((x) => x.id === "SC-d").blockedBy, ["SC-b", "SC-c"]);
});

test("epicRollup: critical path + feature-landed", () => {
  const r = epicRollup(epicKids);
  assert.equal(r.total, 4);
  assert.equal(r.done, 1);
  assert.equal(r.landed, false);                         // not all children landed
  assert.equal(r.criticalPath.length, 3);               // A → (B|C) → D
  assert.equal(r.criticalPath[0], "SC-a");
  assert.equal(r.criticalPath[r.criticalPath.length - 1], "SC-d");
});

test("epicRollup: feature landed only when all children landed", () => {
  const allDone = epicKids.map((c) => ({ ...c, landed: true }));
  assert.equal(epicRollup(allDone).landed, true);
});
