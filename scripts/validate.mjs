#!/usr/bin/env node
// Shipline deterministic validator.
//
// This is the DETERMINISTIC layer. Everything mechanically checkable
// runs here as code — not as an LLM prompt — so it's 100% reproducible,
// free (no tokens), and unit-testable. The LLM critics run AFTER this
// and only handle genuine judgment.
//
// Usage:
//   node validate.mjs <path-to-contract.md>            # run deterministic checks
//   node validate.mjs --check-findings <findings.json> # validate critic output schema
//
// Requires: js-yaml  (npm install js-yaml)
//
// Output: JSON to stdout — { findings: [...], sizing, readiness, contractHash }
// Exit code: 0 if no blockers, 1 if blockers present, 2 on input error.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import yaml from "js-yaml";

const SEVERITIES = new Set(["blocker", "warning", "info"]);
const REQUIRED_COMMS = ["empty", "loading", "success", "error"];
const PROTOCOL_VERSION = 1;

// ─── Contract parsing ────────────────────────────────────────────────

function parseContract(md) {
  // Frontmatter
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) throw new Error("No YAML frontmatter found");
  const frontmatter = yaml.load(fmMatch[1]) || {};
  const body = fmMatch[2];

  // Behaviors: each `### B<n>. <title>` block runs until the next
  // ### or ## heading (or end of body). We find the heading positions,
  // then slice between them — robust, no fragile end-anchors.
  const behaviors = [];
  const headingRe = /^###\s+(B\d+)\.\s+(.+)$/gm;
  const heads = [];
  let h;
  while ((h = headingRe.exec(body)) !== null) {
    heads.push({ id: h[1], title: h[2].trim(), bodyStart: h.index + h[0].length });
  }
  for (let i = 0; i < heads.length; i++) {
    const rest = body.slice(heads[i].bodyStart);
    const nextHeading = rest.match(/\n(?=###\s|##\s)/);
    const block = nextHeading ? rest.slice(0, nextHeading.index) : rest;
    // Top-level items look like `- key:`; strip the "- " so the block
    // parses as a YAML map. Nested fields keep their deeper indent.
    const yamlText = block
      .split("\n")
      .filter((l) => l.trim().length)
      .map((l) => l.replace(/^- /, "  "))
      .join("\n");
    let fields = {};
    try { fields = yaml.load(yamlText) || {}; } catch { fields = {}; }
    behaviors.push({ id: heads[i].id, title: heads[i].title, ...fields });
  }

  // Acceptance criteria section: slice from its ## heading to the next
  // ## heading (or end of body).
  const acs = [];
  const acHead = body.match(/^##\s+Acceptance criteria\s*$/m);
  if (acHead) {
    const after = body.slice(acHead.index + acHead[0].length);
    const nextH2 = after.match(/\n(?=##\s)/);
    const section = nextH2 ? after.slice(0, nextH2.index) : after;
    // Each AC entry: `- AC1 (B1, B2): text...` until the next AC entry
    // or end of section. No `m` flag here so `$` means true end-of-string.
    const acRe = /(?:^|\n)[-*]\s*(AC\d+)\s*(?:[([]([^)\]]*)[)\]])?\s*:([\s\S]*?)(?=\n[-*]\s*AC\d+\b|$)/g;
    let a;
    while ((a = acRe.exec(section)) !== null) {
      const explicitRefs = a[2] ? (a[2].match(/B\d+/g) || []) : [];
      const text = a[3];
      const textRefs = [...text.matchAll(/\bB\d+\b/g)].map((x) => x[0]);
      const refs = explicitRefs.length ? explicitRefs : textRefs;
      acs.push({ id: a[1], text: text.trim(), behaviorRefs: refs });
    }
  }

  return { frontmatter, behaviors, acs, raw: md };
}

// ─── Deterministic checks ────────────────────────────────────────────

function checkContract(contract) {
  const findings = [];
  const { frontmatter, behaviors, acs } = contract;
  const contractPlatforms = new Set(frontmatter.platforms || []);

  const add = (critic, idNum, severity, message, suggestion, fragmentRef) =>
    findings.push({
      id: `${idNum}`,
      critic,
      severity,
      message,
      suggestion,
      fragmentRef,
      references: [],
      source: "contract-only",
      status: "open",
    });

  let n = { INS: 0, PERF: 0, COMMS: 0, PP: 0, AC: 0 };

  if (behaviors.length === 0) {
    add("instrumentation", "INS-000", "blocker",
      "Contract has no behaviors (### B<n> sections).",
      "Add at least one behavior with instrumentation, perfBudget, commsStates, and an AC.",
      "Behaviors");
    return findings;
  }

  // Map behavior -> has at least one AC
  const behaviorsWithAc = new Set();
  for (const ac of acs) for (const ref of ac.behaviorRefs) behaviorsWithAc.add(ref);

  for (const b of behaviors) {
    // 1. instrumentation present
    if (!b.instrumentation) {
      add("instrumentation", `INS-${String(++n.INS).padStart(3, "0")}`, "blocker",
        `${b.id} has no instrumentation block.`,
        "Add an instrumentation block (eventName + properties + expectedRatePerDay, or a server-log/database/sentry/manual source).",
        b.id);
    }
    // 2. perfBudget present with numeric fields
    if (!b.perfBudget) {
      add("perf-budget", `PERF-${String(++n.PERF).padStart(3, "0")}`, "blocker",
        `${b.id} has no perfBudget.`,
        "Add perfBudget with numeric ttiMs, p95LatencyMs, errorRatePct.",
        b.id);
    } else {
      for (const f of ["ttiMs", "p95LatencyMs", "errorRatePct"]) {
        if (typeof b.perfBudget[f] !== "number") {
          add("perf-budget", `PERF-${String(++n.PERF).padStart(3, "0")}`, "blocker",
            `${b.id} perfBudget.${f} is missing or not a number.`,
            `Set ${f} to a concrete number.`, b.id);
        }
      }
    }
    // 3. commsStates present with all four
    if (!b.commsStates) {
      add("comms-completeness", `COMMS-${String(++n.COMMS).padStart(3, "0")}`, "blocker",
        `${b.id} has no commsStates.`,
        "Add commsStates with empty, loading, success, error.", b.id);
    } else {
      for (const f of REQUIRED_COMMS) {
        if (!b.commsStates[f] || String(b.commsStates[f]).trim() === "") {
          add("comms-completeness", `COMMS-${String(++n.COMMS).padStart(3, "0")}`, "blocker",
            `${b.id} commsStates.${f} is missing.`,
            `Add ${f} state copy for ${b.id}.`, b.id);
        }
      }
    }
    // 4. platforms subset of contract platforms
    const bp = b.platforms || [];
    if (bp.length === 0) {
      add("platform-parity", `PP-${String(++n.PP).padStart(3, "0")}`, "blocker",
        `${b.id} declares no platforms.`,
        `Add a platforms list (subset of contract platforms: ${[...contractPlatforms].join(", ")}).`, b.id);
    } else {
      for (const p of bp) {
        if (!contractPlatforms.has(p)) {
          add("platform-parity", `PP-${String(++n.PP).padStart(3, "0")}`, "warning",
            `${b.id} declares platform "${p}" not in contract.platforms.`,
            `Either add "${p}" to contract.platforms or remove it from ${b.id}.`, b.id);
        }
      }
    }
    // 5. at least one AC
    if (!behaviorsWithAc.has(b.id)) {
      add("instrumentation", `AC-${String(++n.AC).padStart(3, "0")}`, "blocker",
        `${b.id} has no acceptance criterion referencing it.`,
        `Add at least one AC that references ${b.id}.`, b.id);
    }
  }

  return findings;
}

// ─── Sizing (fully deterministic) ────────────────────────────────────

function computeSizing(contract, judgmentFindings = []) {
  const { frontmatter, behaviors } = contract;
  const platforms = frontmatter.platforms || [];
  const reasons = [];
  let bucket = "small";

  const escalate = (to, why) => {
    const order = { small: 0, medium: 1, large: 2 };
    if (order[to] > order[bucket]) bucket = to;
    reasons.push(why);
  };

  if (platforms.length > 1) escalate("medium", `${platforms.length} platforms in scope`);
  if (behaviors.length > 3) escalate("medium", `${behaviors.length} behaviors`);
  if (behaviors.length > 8) escalate("large", `${behaviors.length} behaviors (>8)`);
  if (platforms.length >= 3) escalate("large", "3+ platforms");

  // Risk override flags from frontmatter
  if (frontmatter.riskOverride === "high") escalate("large", "riskOverride: high");
  if (frontmatter.touchesAuth) escalate("large", "touches auth");
  if (frontmatter.touchesBilling) escalate("large", "touches billing/payments");
  if (frontmatter.schemaMigration) escalate("large", "schema migration");

  // Any security blocker from the judgment layer bumps to at least medium
  const hasSecurityBlocker = judgmentFindings.some(
    (f) => f.critic === "security" && f.severity === "blocker"
  );
  if (hasSecurityBlocker) escalate("medium", "open security blocker");

  return { complexity: bucket, reasons };
}

// ─── Readiness (fully deterministic) ─────────────────────────────────

function computeReadiness(contract, allFindings) {
  const open = allFindings.filter((f) => f.status === "open");
  const openBlockers = open.filter((f) => f.severity === "blocker").length;
  const openWarnings = open.filter((f) => f.severity === "warning").length;
  const confidence = contract.frontmatter.confidenceScore ?? 0;

  const reasons = [];
  if (openBlockers > 0) reasons.push(`${openBlockers} open blocker(s)`);
  if (openWarnings > 0) reasons.push(`${openWarnings} open warning(s)`);
  if (confidence < 0.8) reasons.push(`confidence ${Math.round(confidence * 100)}% (<80%)`);

  let readiness;
  if (openBlockers > 0) readiness = "not_ready";
  else if (openWarnings > 0 || confidence < 0.8) readiness = "review_needed";
  else readiness = "verified";

  return { readiness, reasons, openBlockers, openWarnings };
}

// ─── Findings schema validation (for critic output) ──────────────────

function validateFindings(findings) {
  const errors = [];
  if (!Array.isArray(findings)) return ["findings is not an array"];
  findings.forEach((f, i) => {
    if (!f || typeof f !== "object") { errors.push(`[${i}] not an object`); return; }
    if (!SEVERITIES.has(f.severity))
      errors.push(`[${i}] invalid severity "${f.severity}" — must be blocker|warning|info`);
    for (const k of ["id", "critic", "message", "suggestion", "fragmentRef"])
      if (typeof f[k] !== "string" || !f[k])
        errors.push(`[${i}] missing/invalid "${k}"`);
    if (f.status !== "open" && f.status !== "resolved" && f.status !== "dismissed")
      errors.push(`[${i}] invalid status "${f.status}"`);
  });
  return errors;
}

// Exports for the eval harness / unit tests.
export {
  parseContract,
  checkContract,
  computeSizing,
  computeReadiness,
  validateFindings,
  SEVERITIES,
  PROTOCOL_VERSION,
};

// ─── CLI ─────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--check-findings") {
    const findings = JSON.parse(readFileSync(args[1], "utf8"));
    const errors = validateFindings(findings);
    if (errors.length) {
      console.error(JSON.stringify({ valid: false, errors }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ valid: true, count: findings.length }, null, 2));
    process.exit(0);
  }

  const path = args[0];
  if (!path) { console.error("Usage: validate.mjs <contract.md>"); process.exit(2); }

  let md;
  try { md = readFileSync(path, "utf8"); }
  catch (e) { console.error(`Cannot read ${path}: ${e.message}`); process.exit(2); }

  let contract;
  try { contract = parseContract(md); }
  catch (e) { console.error(`Parse error: ${e.message}`); process.exit(2); }

  const findings = checkContract(contract);
  const sizing = computeSizing(contract);
  const readiness = computeReadiness(contract, findings);
  const contractHash =
    "sha256:" + createHash("sha256").update(md).digest("hex").slice(0, 16);

  const out = {
    protocolVersion: PROTOCOL_VERSION,
    contractHash,
    deterministicFindings: findings,
    sizing,
    readiness,
    note: "Deterministic layer only. Run LLM judgment critics for edge-cases, security reasoning, regression, copy quality, and platform UX specifics.",
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(readiness.openBlockers > 0 ? 1 : 0);
}

// Only run the CLI when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
