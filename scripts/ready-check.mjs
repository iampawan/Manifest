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
// Stack-neutral by design: every item reads sensibly for a frontend, backend,
// API, data, or infra PRD. `skippable` items still require a *stated reason* to
// clear (see isSatisfied) — N/A is never a free pass. For a backend/API PRD the
// answer is the backend equivalent (interface/contract spec, response & failure
// states), not a skip.
export const RUBRIC = [
  { id: "goal",    req: true,  name: "What problem are we solving?",                   critic: "minimality" },
  { id: "metric",  req: true,  name: "How will we know it worked?",                    critic: "minimality" },
  { id: "design",  req: true,  name: "Where's the design or interface spec? (Figma/mock link, or API/contract spec)", skippable: "no-interface" },
  { id: "scope",   req: true,  name: "Which platforms or services — and what's NOT included?", critic: "platform-parity" },
  { id: "oldbeh",  req: true,  name: "What happens today?",            skippable: "new-feature", critic: "regression" },
  { id: "flows",   req: true,  name: "Which screens, endpoints, or flows does it touch?", critic: "regression", cache: "surface_index" },
  { id: "edge",    req: true,  name: "What could go wrong? (edge & error cases)",      critic: "edge-cases" },
  { id: "states",  req: true,  name: "What does the user or caller see: nothing / loading / success / error?", skippable: "no-observable-output", critic: "comms-completeness", cache: "i18n" },
  { id: "l10n",    req: true,  name: "Is the wording or response format final?",       cache: "i18n" },
  { id: "writer",  req: true,  name: "Does this affect writers, creators, or downstream consumers?", skippable: "no-downstream-impact" },
  { id: "events",  req: true,  name: "What should we track? (analytics / telemetry)",  critic: "instrumentation", cache: "events" },
  { id: "deps",    req: false, name: "Does it depend on another team or API?" },
  { id: "rollout", req: false, name: "How will it roll out?" },
];

const byId = Object.fromEntries(RUBRIC.map((r) => [r.id, r]));
const MIN_DETAIL = 3;

// ─── Satisfaction + verdict ──────────────────────────────────────────
function reasonOk(ans = {}) {
  return typeof ans.reason === "string" && ans.reason.trim().length >= MIN_DETAIL;
}
// N/A is NOT a free pass. A skippable item marked N/A only clears when the PM
// states WHY it doesn't apply (e.g. "pure infra service, no caller-facing
// output"). That reason rides in the hand-off so dev can accept or push back —
// closing the "just tick N/A and move on" escape route.
function isReasonedSkip(item, ans = {}) {
  return !!item.skippable && ans.na === true && reasonOk(ans);
}
export function isSatisfied(item, ans = {}) {
  if (!ans) return false;
  if (isReasonedSkip(item, ans)) return true;
  if (hasDetail(ans)) return true;
  // Waiver: the PM can proceed without answering, but MUST justify it. The
  // waiver is recorded and surfaced in the hand-off for the dev to accept.
  if (ans.waived === true && reasonOk(ans)) return true;
  return false;
}
function hasDetail(ans = {}) {
  return typeof ans.detail === "string" && ans.detail.trim().length >= MIN_DETAIL;
}
function isWaived(item, ans = {}) {
  return isSatisfied(item, ans) && ans.waived === true && !hasDetail(ans) && !(item.skippable && ans.na === true);
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
  const waivers = RUBRIC
    .filter((r) => isWaived(r, items[r.id]))
    .map((r) => ({ id: r.id, name: r.name, reason: (items[r.id].reason || "").trim() }));
  const skips = RUBRIC
    .filter((r) => isReasonedSkip(r, items[r.id]))
    .map((r) => ({ id: r.id, name: r.name, reason: (items[r.id].reason || "").trim() }));
  const cleared = missing.length === 0;
  return {
    cleared,
    met: met.length,
    total: required.length,
    pct: Math.round((met.length / required.length) * 100),
    missing,
    optionalMissing,
    waivers,
    skips,
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
    else if (isWaived(r, a)) val = "waived:" + a.reason.trim().toLowerCase().replace(/\s+/g, " ");
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

// ─── Freeze: detect PRD/source drift after hand-off (v0.22) ──────────
// prdHash freezes the document body; source.version freezes the live doc
// (Confluence version.number / JIRA updated ts). Verified at pickup.
export function prdHash(text = "") {
  const norm = String(text).replace(/\s+/g, " ").trim().toLowerCase();
  return "H" + djb2(norm).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

// parsed = { source?:{version}, designVersion?, prdHash? } from the hand-off;
// current = { version?, designVersion?, prdHash? } freshly fetched at pickup.
export function verifyFreeze(parsed = {}, current = {}) {
  if (parsed.source && current.version != null &&
      String(current.version) !== String(parsed.source.version)) return "stale-source";
  if (parsed.designVersion && current.designVersion != null &&
      String(current.designVersion) !== String(parsed.designVersion)) return "stale-design";
  if (parsed.prdHash && current.prdHash && parsed.prdHash !== current.prdHash) return "stale-content";
  return "valid";
}

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
  const design = items.design && items.design.na ? `(no interface: ${(items.design.reason || "").trim()})`
    : (items.design && items.design.detail ? firstUrl(items.design.detail) || items.design.detail.trim() : "⚠ add link/spec");
  const out = [];
  const nWaive = v.waivers ? v.waivers.length : 0;
  out.push(v.cleared
    ? `✅ READY CHECK PASSED${nWaive ? ` (${nWaive} waiver(s), dev to accept)` : ""}`
    : `⛔ NOT READY (${v.met}/${v.total})`);
  out.push(`${HANDOFF_MARK} ${code || "(none)"}`);
  if (meta.freeze) {                                   // v0.22 freeze stamp
    if (meta.source) out.push(`Source: ${meta.source.type} ${meta.source.id} v${meta.source.version}`);
    if (meta.design && meta.design.version) out.push(`Design-Version: ${meta.design.version}`);
    out.push(`PRD-Hash: ${prdHash(renderPrd(answers))}`);
  }
  out.push(`Feature: ${answers.title || "Untitled feature"}`);
  out.push(`Platforms: ${items.scope && items.scope.detail ? items.scope.detail.trim() : "not set"}`);
  out.push(`Design: ${design}`);
  if (meta.date) out.push(`Cleared: ${meta.date}`);
  out.push("");
  if (v.cleared) {
    out.push("The basics, answered:");
    for (const r of RUBRIC) {
      const a = items[r.id];
      if (!isSatisfied(r, a)) continue;
      if (r.id === "design") continue;
      if (isWaived(r, a)) continue; // listed in the waivers block below
      const val = r.skippable && a.na ? `N/A — ${(a.reason || "").trim()}` : a.detail.trim();
      out.push(`• [${r.id}] ${r.name} | ${val}`);
    }
    if (nWaive) {
      out.push("");
      out.push("Waivers (dev to accept or push back):");
      v.waivers.forEach((w) => out.push(`• [${w.id}] ${w.name} | reason: ${w.reason}`));
    }
    out.push("");
    out.push("Grooming can start. (Dev: verify this code before pickup.)");
  } else {
    out.push("Missing, still to add:");
    v.missing.forEach((m) => out.push(`• ${m.name}`));
  }
  return out.join("\n");
}

// ─── PRD generation — compose a clean 11-section PRD from the answers ─
// The "right format" a PM can publish straight to JIRA. Deterministic, so
// the panel (JS port) and Claude Code (this CLI) produce the same document.
const PRD_SECTIONS = [
  ["goal",   "1. Problem & goal"],
  ["metric", "2. Success metric"],
  ["design", "3. Design / interface spec"],
  ["scope",  "4. Scope & platforms / services"],
  ["oldbeh", "5. What happens today"],
  ["flows",  "6. Impacted flows, surfaces & endpoints"],
  ["edge",   "7. Edge cases & error handling"],
  ["states", "8. States (empty / loading / success / error)"],
  ["l10n",   "9. Localized copy / response format"],
  ["writer", "10. Writer / creator / consumer impact"],
  ["events", "11. Instrumentation / telemetry"],
];

export function prdTitle(answers = {}) { return String(answers.title || "Untitled feature").trim(); }

export function renderPrd(answers = {}, meta = {}) {
  const items = answers.items || {};
  const v = checkReadiness(answers);
  const code = gateCode(answers);
  const val = (id) => {
    const r = byId[id], a = items[id] || {};
    if (isReasonedSkip(r, a)) return `_N/A (dev to accept): ${a.reason.trim()}_`;
    if (isWaived(r, a)) return `_Waived (dev to accept): ${a.reason.trim()}_`;
    const d = (a.detail || "").trim();
    return d || "_(not provided)_";
  };
  const out = [];
  out.push(`# PRD — ${prdTitle(answers)}`);
  out.push("");
  out.push(`> Ready Check: **${code || "not yet ready"}**` +
    (meta.date ? ` · ${meta.date}` : "") +
    (v.cleared ? "" : ` · ⚠ ${v.missing.length} required item(s) still missing`));
  out.push("");
  for (const [id, heading] of PRD_SECTIONS) { out.push(`## ${heading}`); out.push(val(id)); out.push(""); }
  const deps = val("deps"), rollout = val("rollout");
  out.push("## Dependencies"); out.push(deps === "_(not provided)_" ? "None noted." : deps); out.push("");
  out.push("## Rollout"); out.push(rollout === "_(not provided)_" ? "Standard release." : rollout); out.push("");
  if (v.waivers && v.waivers.length) {
    out.push("## Waivers (dev to accept)");
    v.waivers.forEach((w) => out.push(`- **${w.name}**: ${w.reason}`));
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

// Parse a rendered hand-off back into { title, items, code } so a pasted
// block can be re-verified. Tolerant of surrounding chatter.
export function parseHandoff(text = "") {
  const items = {};
  let title = "", code = "", source = null, hash = null, designVersion = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Ready-Check:\s*(\S+)/))) code = m[1];
    else if ((m = line.match(/^Source:\s*(\S+)\s+(\S+)\s+v(\S+)/))) source = { type: m[1], id: m[2], version: m[3] };
    else if ((m = line.match(/^Design-Version:\s*(\S+)/))) designVersion = m[1];
    else if ((m = line.match(/^PRD-Hash:\s*(\S+)/))) hash = m[1];
    else if ((m = line.match(/^Feature:\s*(.+)/))) title = m[1].trim();
    else if ((m = line.match(/^Platforms:\s*(.+)/))) items.scope = { detail: m[1].trim() };
    else if ((m = line.match(/^Design:\s*(.+)/))) {
      const d = m[1].trim();
      let na;
      if ((na = d.match(/^\(no interface:\s*(.*)\)$/i))) items.design = { na: true, reason: na[1].trim() };
      else if (d === "(no UI)" || d === "(no interface)") items.design = { na: true }; // legacy hand-offs
      else items.design = { detail: d };
    } else if ((m = line.match(/^[•*-]\s*\[(\w+)\][^|]*\|\s*(.+)/))) {
      const id = m[1], val = m[2].trim();
      if (byId[id]) {
        let na;
        if (/^reason:\s*/i.test(val)) items[id] = { waived: true, reason: val.replace(/^reason:\s*/i, "") };
        else if ((na = val.match(/^N\/A\s*[—-]\s*(.+)/))) items[id] = { na: true, reason: na[1].trim() };
        else if (val === "N/A") items[id] = { na: true }; // legacy hand-offs (no reason captured)
        else items[id] = { detail: val };
      }
    }
  }
  return { title, items, code, source, designVersion, prdHash: hash };
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
          message: `"${surface}" touches ${Array.isArray(files) ? files.length : "several"} file(s); confirm all are in scope.`,
          suggestion: `Cross-check against ${Array.isArray(files) ? files.slice(0, 3).join(", ") : "the surface's files"}.` });
      }
    }
  }
  return notes.slice(0, 12);
}

// ─── PM accountability ledger — deterministic "who held the ball" + SLA pause ──
// events: [{ by:'pm'|'dev', at:'ISO', note? }] chronological. Each entry marks who
// TOOK the ball at that moment. The point: time the ball sits with the PM does NOT
// count against the dev's SLA, and the trail shows who caused any delay.
export function ballLedger(events = [], now = Date.now()) {
  const evs = (Array.isArray(events) ? events : [])
    .filter((e) => e && (e.by === "pm" || e.by === "dev") && e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  let pmMs = 0, devMs = 0, bounces = 0;
  for (let i = 0; i < evs.length; i++) {
    const start = new Date(evs[i].at).getTime();
    const end = i + 1 < evs.length ? new Date(evs[i + 1].at).getTime() : now;
    const dur = Math.max(0, end - start);
    if (evs[i].by === "pm") pmMs += dur; else devMs += dur;
    if (i > 0 && evs[i].by === "pm" && evs[i - 1].by === "dev") bounces++;  // dev → PM = a bounce-back
  }
  return { holder: evs.length ? evs[evs.length - 1].by : "dev", pmMs, devMs, blockedOnPmMs: pmMs, bounces, totalMs: pmMs + devMs };
}
// SLA that PAUSES while the ball is with the PM — dev is charged only for time on their side.
export function effectiveSla(slaMs, startedAt, events = [], now = Date.now()) {
  const { blockedOnPmMs } = ballLedger(events, now);
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  const devElapsed = Math.max(0, elapsed - blockedOnPmMs);
  return { devElapsed, blockedOnPmMs, remainingMs: slaMs - devElapsed, overdue: devElapsed > slaMs };
}
const _hms = (ms) => `${Math.floor(ms / 3.6e6)}h ${Math.round((ms % 3.6e6) / 6e4)}m`;

// ─── Epic rollup — one view over a multi-person feature's child contracts ──
// children: [{ id, owner?, repo?, size?, status?, landed?, dependsOn?:[id] }]
// Answers: who's blocked on whom, what's the critical path, is the FEATURE done.
export function epicRollup(children = []) {
  const kids = (Array.isArray(children) ? children : []).filter((c) => c && c.id);
  const byId = {}; kids.forEach((c) => { byId[c.id] = c; });
  const isLanded = (c) => !!(c && (c.landed === true || c.status === "landed"));
  const depsOf = (c) => (Array.isArray(c && c.dependsOn) ? c.dependsOn.filter((d) => byId[d]) : []);

  const rows = kids.map((c) => {
    const blockedBy = depsOf(c).filter((d) => !isLanded(byId[d]));
    let state;
    if (isLanded(c)) state = "landed";
    else if (blockedBy.length) state = "blocked";
    else if (c.status && !["planned", "", undefined, null].includes(c.status)) state = c.status; // in flight
    else state = "ready";
    return { id: c.id, owner: c.owner || null, repo: c.repo || null, size: c.size || null, state, blockedBy };
  });

  // Critical path = longest dependency chain (node count).
  const depth = {};
  const calc = (id, seen = new Set()) => {
    if (id in depth) return depth[id];
    if (seen.has(id)) return 0;                 // cycle guard
    seen.add(id);
    const ds = depsOf(byId[id] || {});
    depth[id] = ds.length ? 1 + Math.max(...ds.map((x) => calc(x, new Set(seen)))) : 1;
    return depth[id];
  };
  kids.forEach((c) => calc(c.id));
  let endId = null, maxD = 0;
  for (const id of Object.keys(depth)) if (depth[id] > maxD) { maxD = depth[id]; endId = id; }
  const path = [];
  for (let cur = endId; cur; ) {
    path.unshift(cur);
    const ds = depsOf(byId[cur] || {});
    cur = ds.length ? ds.reduce((a, b) => ((depth[b] || 0) > (depth[a] || 0) ? b : a)) : null;
  }

  const counts = rows.reduce((m, r) => ((m[r.state] = (m[r.state] || 0) + 1), m), {});
  const done = rows.filter((r) => r.state === "landed").length;
  return {
    total: rows.length, done, pct: rows.length ? Math.round((done / rows.length) * 100) : 0,
    landed: rows.length > 0 && done === rows.length,   // the FEATURE is done only when every child has landed
    counts, criticalPath: path, rows,
    blocked: rows.filter((r) => r.state === "blocked"),
    ready: rows.filter((r) => r.state === "ready"),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function loadJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function fail(msg) { console.error(msg); process.exit(2); }

function main() {
  const [mode, a1, a2, a3] = process.argv.slice(2);
  if (!mode || mode === "--help" || mode === "-h") {
    console.log("ready-check · Manifest PM-side gate engine\n" +
      "  --check <answers.json>          verdict (exit 1 if not ready)\n" +
      "  --code <answers.json>           print gate code\n" +
      "  --handoff <answers.json>        print dev hand-off block\n" +
      "  --prd <answers.json>            print the 11-section PRD (publish-ready)\n" +
      "  --verify <handoff.txt|json>     validate a code vs its content\n" +
      "  --verify-freeze <handoff.txt> <current.json>   PRD/design drift at pickup\n" +
      "  --cache-check <answers.json> <code-context.json>\n" +
      "  --ledger <events.json> [slaHrs] [startedAt]   PM/dev ball ledger + SLA-paused-on-PM\n" +
      "  --rollup <children.json>        epic rollup — states, critical path, feature-landed\n" +
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
      if (!c) { console.error("NOT READY: no code minted."); process.exit(1); }
      console.log(c);
    } else if (mode === "--handoff") {
      console.log(renderHandoff(loadJson(a1), { date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }));
    } else if (mode === "--prd") {
      console.log(renderPrd(loadJson(a1), { date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }));
    } else if (mode === "--verify") {
      let answers, code;
      const raw = readFileSync(a1, "utf8");
      if (a1.endsWith(".json")) { answers = JSON.parse(raw); code = answers.code || (answers.gateCode); }
      else { const p = parseHandoff(raw); answers = { title: p.title, items: p.items }; code = p.code; }
      const verdict = verifyGateCode(code, answers);
      console.log(`${code || "(no code)"} → ${verdict.toUpperCase()}`);
      process.exit(verdict === "valid" ? 0 : 1);
    } else if (mode === "--verify-freeze") {
      const parsed = parseHandoff(readFileSync(a1, "utf8"));   // pinned stamp from the hand-off
      const current = loadJson(a2);                            // {version?, designVersion?, prdHash?} fetched now
      const v = verifyFreeze(parsed, current);
      console.log(v.toUpperCase());
      process.exit(v === "valid" ? 0 : 1);
    } else if (mode === "--cache-check") {
      console.log(JSON.stringify(cacheChecks(loadJson(a1), loadJson(a2)), null, 2));
    } else if (mode === "--ledger") {
      const events = loadJson(a1);
      const led = ballLedger(events);
      const res = { holder: led.holder, blockedOnPM: _hms(led.blockedOnPmMs), devTime: _hms(led.devMs), bounces: led.bounces };
      if (a2 && a3) {
        const e = effectiveSla(Number(a2) * 3.6e6, a3, events);
        res.sla = { devElapsed: _hms(e.devElapsed), pausedForPM: _hms(e.blockedOnPmMs), remaining: _hms(Math.max(0, e.remainingMs)), overdue: e.overdue };
      }
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.sla && res.sla.overdue ? 1 : 0);
    } else if (mode === "--rollup") {
      console.log(JSON.stringify(epicRollup(loadJson(a1)), null, 2));
    } else {
      fail(`unknown mode: ${mode}`);
    }
  } catch (e) { fail(`error: ${e.message}`); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
