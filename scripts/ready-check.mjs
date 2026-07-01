#!/usr/bin/env node
// Manifest Ready Check — the deterministic engine behind the PM-side gate.
//
// This is the DETERMINISTIC layer (mirrors validate.mjs for contracts).
// Everything mechanically checkable about PRD readiness lives here so the
// gate verdict, the gate code, and the hand-off are reproducible and
// tamper-evident — NOT a free-form LLM judgement. The judgement layer
// (edge-case / instrumentation / clarity blockers) is the ready-check
// SKILL, which runs on top of this.
//
// The SAME rubric + gate-code algorithm runs in three places:
//   1. /ready-check in Claude Code or Cowork  (this script, via the skill)
//   2. the offline web page  (gate/prd-readiness-gate.html, JS port)
//   3. dev-side enforcement  (verifyGateCode below, called by promote/pickup)
// so a code minted anywhere verifies everywhere. Keep the three in sync;
// eval/ready-check.test.mjs pins the algorithm.
//
// Usage:
//   node ready-check.mjs --check   <answers.json>            # verdict (exit 1 if not ready)
//   node ready-check.mjs --code    <answers.json>            # print the gate code (must be ready)
//   node ready-check.mjs --handoff <answers.json>            # print the dev hand-off block
//   node ready-check.mjs --verify  <handoff.txt|answers.json># validate a code vs its content
//   node ready-check.mjs --cache-check <answers.json> <code-context.json>  # code-aware notes
//   node ready-check.mjs --rubric                            # print the Definition of Ready
//
// answers.json shape: { "title": "...", "items": { "goal": {"detail":"..."},
//   "design": {"na": true}, ... } }   (na only honoured for skippable items)
//
// Exit: 0 ready / valid, 1 not-ready / invalid-or-stale, 2 input error.

import { readFileSync } from "node:fs";

// ─── Definition of Ready — the canonical machine rubric ──────────────
// Human doc: reference/READY-CHECK-RUBRIC.md (keep in sync).
// `skippable` items may be marked N/A with a stated reason; everything
// else must have a real answer. `critic` = the dev-side judgement critic
// that goes deeper on the same concern; `cache` = the code-context field
// that can make this check code-aware.
export const RUBRIC = [
  { id: "goal",    req: true,  name: "What problem are we solving?",                   critic: "minimality" },
  { id: "metric",  req: true,  name: "How will we know it worked?",                    critic: "minimality" },
  { id: "design",  req: true,  name: "Where is the design?",           skippable: "no-ui" },
  { id: "scope",   req: true,  name: "Which platforms — and what's NOT included?",     critic: "platform-parity" },
  { id: "oldbeh",  req: true,  name: "What happens today?",            skippable: "new-feature", critic: "regression" },
  { id: "flows",   req: true,  name: "Which screens or flows does it touch?",          critic: "regression", cache: "surface_index" },
  { id: "edge",    req: true,  name: "What could go wrong?",                           critic: "edge-cases" },
  { id: "states",  req: true,  name: "What does the user see (nothing/loading/done/error)?", skippable: "not-user-facing", critic: "comms-completeness", cache: "i18n" },
  { id: "l10n",    req: true,  name: "Is the wording final and translated?",           cache: "i18n" },
  { id: "writer",  req: true,  name: "Does this affect writers or creators?",          skippable: "no-writer-impact" },
  { id: "events",  req: true,  name: "What should we track?",                          critic: "instrumentation", cache: "events" },
  { id: "deps",    req: false, name: "Does it depend on another team or API?" },
  { id: "rollout", req: false, name: "How will it roll out?" },
];

const byId = Object.fromEntries(RUBRIC.map((r) => [r.id, r]));
const MIN_DETAIL = 3;

// ─── Satisfaction + verdict ──────────────────────────────────────────
export function isSatisfied(item, ans = {}) {
  if (!ans) return false;
  if (item.skippable && ans.na === true) return true;
  return typeof ans.detail === "string" && ans.detail.trim().length >= MIN_DETAIL;
}

export function checkReadiness(answers = {}) {
  const items = answers.items || {};
  const required = RUBRIC.filter((r) => r.req);
  const optional = RUBRIC.filter((r) => !r.req);
  const met = required.filter((r) => isSatisfied(r, items[r.id]));
  const missing = required
    .filter((r) => !isSatisfied(r, items[r.id]))
    .map((r) => ({ id: r.id, name: r.name }));
  const optionalMissing = optional
    .filter((r) => !isSatisfied(r, items[r.id]))
    .map((r) => ({ id: r.id, name: r.name }));
  const cleared = missing.length === 0;
  return {
    cleared,
    met: met.length,
    total: required.length,
    pct: Math.round((met.length / required.length) * 100),
    missing,
    optionalMissing,
  };
}

// ─── Gate code — deterministic + tamper-evident ──────────────────────
// djb2 (identical in the JS port) over the normalized satisfied answers.
// Same feature + same answers → same code. Change any answer after
// clearing and the code no longer verifies → dev sees it's stale.
export function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

function normalize(answers = {}) {
  const items = answers.items || {};
  const title = String(answers.title || "").trim().toLowerCase().replace(/\s+/g, " ");
  const lines = [`title:${title}`];
  for (const r of RUBRIC) {
    const a = items[r.id];
    if (!isSatisfied(r, a)) continue;
    let val;
    if (r.skippable && a.na === true) val = "na";
    else if (r.id === "design") val = firstUrl(a.detail) || "present"; // link shown separately; hash a stable token so the hand-off round-trips
    else val = a.detail.trim().toLowerCase().replace(/\s+/g, " ");
    lines.push(`${r.id}:${val}`);
  }
  return lines.join("\n");
}

function prefix(title = "") {
  const p = String(title).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  return (p + "XXX").slice(0, 3);
}

export function gateCode(answers = {}) {
  const { cleared } = checkReadiness(answers);
  if (!cleared) return null;
  const h = djb2(normalize(answers)).toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `RC-${prefix(answers.title)}-${h}`;
}

export const CODE_RE = /^RC-[A-Z]{3}-[A-Z0-9]{6}$/;

// Returns "valid" | "stale" | "invalid" | "not-ready".
export function verifyGateCode(code, answers = {}) {
  if (typeof code !== "string" || !CODE_RE.test(code.trim())) return "invalid";
  const expected = gateCode(answers);
  if (expected === null) return "not-ready";
  return expected === code.trim() ? "valid" : "stale";
}

// ─── Hand-off block — render + parse (round-trips) ───────────────────
const HANDOFF_MARK = "Ready-Check:";
export function renderHandoff(answers = {}, meta = {}) {
  const v = checkReadiness(answers);
  const items = answers.items || {};
  const code = gateCode(answers);
  const design = items.design && items.design.na ? "(no UI)"
    : (items.design && items.design.detail ? firstUrl(items.design.detail) || items.design.detail.trim() : "⚠ add link");
  const out = [];
  out.push(v.cleared ? `✅ READY CHECK PASSED` : `⛔ NOT READY (${v.met}/${v.total})`);
  out.push(`${HANDOFF_MARK} ${code || "—"}`);
  out.push(`Feature: ${answers.title || "Untitled feature"}`);
  out.push(`Platforms: ${items.scope && items.scope.detail ? items.scope.detail.trim() : "—"}`);
  out.push(`Design: ${design}`);
  if (meta.date) out.push(`Cleared: ${meta.date}`);
  out.push("");
  if (v.cleared) {
    out.push("The basics, answered:");
    for (const r of RUBRIC) {
      const a = items[r.id];
      if (!isSatisfied(r, a)) continue;
      if (r.id === "design") continue;
      const val = r.skippable && a.na ? "N/A" : a.detail.trim();
      out.push(`• [${r.id}] ${r.name} | ${val}`);
    }
    out.push("");
    out.push("Grooming can start. (Dev: verify this code before pickup.)");
  } else {
    out.push("Missing, still to add:");
    v.missing.forEach((m) => out.push(`• ${m.name}`));
  }
  return out.join("\n");
}

// Parse a rendered hand-off back into { title, items, code } so a pasted
// block can be re-verified. Tolerant of surrounding chatter.
export function parseHandoff(text = "") {
  const items = {};
  let title = "", code = "";
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Ready-Check:\s*(\S+)/))) code = m[1];
    else if ((m = line.match(/^Feature:\s*(.+)/))) title = m[1].trim();
    else if ((m = line.match(/^Platforms:\s*(.+)/))) items.scope = { detail: m[1].trim() };
    else if ((m = line.match(/^Design:\s*(.+)/))) {
      const d = m[1].trim();
      items.design = d === "(no UI)" ? { na: true } : { detail: d };
    } else if ((m = line.match(/^[•*-]\s*\[(\w+)\][^|]*\|\s*(.+)/))) {
      const id = m[1], val = m[2].trim();
      if (byId[id]) items[id] = val === "N/A" ? { na: true } : { detail: val };
    }
  }
  return { title, items, code };
}

function firstUrl(s = "") { const m = String(s).match(/https?:\/\/\S+/); return m ? m[0] : null; }

// ─── Code-aware notes — the "smart, no-repo" layer ───────────────────
// Reads the published code-context cache (build-code-context.mjs output)
// and flags convention mismatches the PM can fix themselves — WITHOUT
// touching source. Returns [] when there's no cache. Never blocks the
// gate (info/warning only) — the deep code-grounded critics run dev-side.
export function cacheChecks(answers = {}, cache = null) {
  if (!cache || typeof cache !== "object") return [];
  const items = answers.items || {};
  const notes = [];

  // events → naming convention
  const conv = cache.events && cache.events.naming_patterns && cache.events.naming_patterns.convention;
  const ev = items.events && items.events.detail;
  if (conv && ev) {
    const names = ev.match(/\b[a-z][a-z0-9]*(?:[_A-Z][a-zA-Z0-9]*)+\b/g) || [];
    const bad = names.filter((n) => conv === "snake_case" ? /[A-Z]/.test(n) : !/[A-Z]/.test(n));
    if (bad.length) {
      notes.push({ id: "events", severity: "warning",
        message: `Event name(s) don't match the app convention (${conv}): ${[...new Set(bad)].join(", ")}.`,
        suggestion: `Rename to ${conv} (e.g. ${conv === "snake_case" ? "card_saved" : "cardSaved"}).` });
    }
  }

  // flows → surface index awareness
  const idx = cache.surface_index;
  const flows = items.flows && items.flows.detail && items.flows.detail.toLowerCase();
  if (idx && flows) {
    for (const [surface, files] of Object.entries(idx)) {
      const key = surface.split(/[._]/).pop();
      if (key && flows.includes(key)) {
        notes.push({ id: "flows", severity: "info",
          message: `"${surface}" touches ${Array.isArray(files) ? files.length : "several"} file(s) — confirm all are in scope.`,
          suggestion: `Cross-check against ${Array.isArray(files) ? files.slice(0, 3).join(", ") : "the surface's files"}.` });
      }
    }
  }
  return notes.slice(0, 12);
}

// ─── CLI ─────────────────────────────────────────────────────────────
function loadJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function fail(msg) { console.error(msg); process.exit(2); }

function main() {
  const [mode, a1, a2] = process.argv.slice(2);
  if (!mode || mode === "--help" || mode === "-h") {
    console.log("ready-check — Manifest PM-side gate engine\n" +
      "  --check <answers.json>          verdict (exit 1 if not ready)\n" +
      "  --code <answers.json>           print gate code\n" +
      "  --handoff <answers.json>        print dev hand-off block\n" +
      "  --verify <handoff.txt|json>     validate a code vs its content\n" +
      "  --cache-check <answers.json> <code-context.json>\n" +
      "  --rubric                        print the Definition of Ready");
    return;
  }
  if (mode === "--rubric") {
    for (const r of RUBRIC)
      console.log(`${r.req ? "•" : "◦"} ${r.id.padEnd(8)} ${r.name}${r.skippable ? `  (skippable: ${r.skippable})` : ""}`);
    return;
  }
  try {
    if (mode === "--check") {
      const v = checkReadiness(loadJson(a1));
      console.log(JSON.stringify(v, null, 2));
      process.exit(v.cleared ? 0 : 1);
    } else if (mode === "--code") {
      const c = gateCode(loadJson(a1));
      if (!c) { console.error("NOT READY — no code minted."); process.exit(1); }
      console.log(c);
    } else if (mode === "--handoff") {
      console.log(renderHandoff(loadJson(a1), { date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }));
    } else if (mode === "--verify") {
      let answers, code;
      const raw = readFileSync(a1, "utf8");
      if (a1.endsWith(".json")) { answers = JSON.parse(raw); code = answers.code || (answers.gateCode); }
      else { const p = parseHandoff(raw); answers = { title: p.title, items: p.items }; code = p.code; }
      const verdict = verifyGateCode(code, answers);
      console.log(`${code || "(no code)"} → ${verdict.toUpperCase()}`);
      process.exit(verdict === "valid" ? 0 : 1);
    } else if (mode === "--cache-check") {
      console.log(JSON.stringify(cacheChecks(loadJson(a1), loadJson(a2)), null, 2));
    } else {
      fail(`unknown mode: ${mode}`);
    }
  } catch (e) { fail(`error: ${e.message}`); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
