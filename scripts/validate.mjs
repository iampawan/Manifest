#!/usr/bin/env node
// Manifest deterministic validator.
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
// Output: JSON to stdout — { findings: [...], sizing, modelPlan, readiness, contractHash }
// Exit code: 0 if no blockers, 1 if blockers present, 2 on input error.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

const SEVERITIES = new Set(["blocker", "warning", "info"]);
// Finding lifecycle. Only "open" findings count toward the gate.
//   resolved     — fixed in the contract
//   dismissed    — the finding was wrong (with a reason)
//   acknowledged — reviewed and accepted as-is (a human signed off); a
//                  warning put to rest this way never re-litigates
const FINDING_STATUSES = new Set(["open", "resolved", "dismissed", "acknowledged"]);
const REQUIRED_COMMS = ["empty", "loading", "success", "error"];
// v2: findings provenance records a per-tier model MAP (verifiedWith.models)
// instead of a single model scalar, because critics now run on different
// models (see computeModelPlan). Bumping this invalidates v1 caches, which is
// correct — a v1 findings file can't describe which model produced each finding.
const PROTOCOL_VERSION = 2;

// commsStates is a UI concern — only required for user-facing behaviors.
// A behavior is "server-only" when every platform it declares is one of
// these; such behaviors skip the commsStates requirement and the UI-only
// perf field (ttiMs) is not expected of them.
const SERVER_PLATFORMS = new Set(["server", "backend"]);
// perfBudget gating policy: "required" = missing/incomplete is a blocker
// (the old behavior); "warn" = a warning (default — visible but doesn't
// block readiness); "off" = not checked at all. Set per repo via
// conventions.perfBudget, or per contract via frontmatter perfBudgetPolicy.
const PERF_POLICIES = new Set(["required", "warn", "off"]);
const DEFAULT_PERF_POLICY = "warn";
const PERF_FIELDS = ["ttiMs", "p95LatencyMs", "errorRatePct"];

// PR-stage code-review findings (distinct from contract critics): they
// operate on a diff and propose code changes. They share the severity
// enum but carry a category + file/line instead of a fragmentRef.
const REVIEW_CATEGORIES = new Set([
  "security", "correctness", "performance", "maintainability", "style",
]);
// rollback-guard verdicts. The guard NEVER executes — it recommends.
const GUARD_VERDICTS = new Set(["proceed", "hold", "recommend-rollback"]);

const hashOf = (md) =>
  "sha256:" + createHash("sha256").update(md).digest("hex").slice(0, 16);

const readFrontmatter = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  return m ? yaml.load(m[1]) || {} : {};
};

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

function checkContract(contract, options = {}) {
  const findings = [];
  const { frontmatter, behaviors, acs } = contract;
  const contractPlatforms = new Set(frontmatter.platforms || []);

  // Resolve the perfBudget policy: per-contract frontmatter wins, then the
  // caller-supplied repo convention, then the default ("warn"). Anything
  // unrecognized falls back to the default rather than erroring.
  let perfPolicy = frontmatter.perfBudgetPolicy || options.perfBudgetPolicy || DEFAULT_PERF_POLICY;
  if (!PERF_POLICIES.has(perfPolicy)) perfPolicy = DEFAULT_PERF_POLICY;
  const perfSeverity = perfPolicy === "required" ? "blocker" : "warning";

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

  // An epic (a decomposed Large contract) delegates its behaviors to
  // child contracts and isn't implemented directly — skip behavior
  // checks for it. Its children are validated as normal contracts.
  if (frontmatter.type === "epic") {
    return findings; // no behavior-level findings for an epic
  }

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
        `Under ${b.id}, add:\n    instrumentation:\n      eventName: <snake_case_event>\n      properties: [<prop>]\n      expectedRatePerDay: <n>\n  — or, if nothing should be tracked (e.g. a bug fix), write \`instrumentation: none\`.`,
        b.id);
    }
    // Is this behavior user-facing? (Server-only behaviors skip the UI
    // requirements: commsStates entirely, and the UI-only perf field.)
    const bp = b.platforms || [];
    const serverOnly = bp.length > 0 && bp.every((p) => SERVER_PLATFORMS.has(p));
    const userFacing = !serverOnly;

    // 2. perfBudget — governed by policy. Relaxed from "all three fields"
    //    to "at least one numeric field that's relevant" so a behavior
    //    with no network call needn't invent a p95 (fill what applies).
    if (perfPolicy !== "off") {
      if (!b.perfBudget) {
        add("perf-budget", `PERF-${String(++n.PERF).padStart(3, "0")}`, perfSeverity,
          `${b.id} has no perfBudget.`,
          "Add perfBudget with at least one numeric field relevant to this behavior (ttiMs for UI responsiveness, p95LatencyMs for a network call, errorRatePct).",
          b.id);
      } else {
        // The fields that make sense here: ttiMs only for user-facing.
        const relevant = userFacing ? PERF_FIELDS : PERF_FIELDS.filter((f) => f !== "ttiMs");
        const numericCount = relevant.filter((f) => typeof b.perfBudget[f] === "number").length;
        if (numericCount === 0) {
          add("perf-budget", `PERF-${String(++n.PERF).padStart(3, "0")}`, perfSeverity,
            `${b.id} perfBudget has no numeric budget field.`,
            `Set at least one of ${relevant.join(" / ")} to a concrete number.`, b.id);
        }
        // A field that's present but non-numeric (e.g. "TBD") is a gap at
        // the policy severity — it means "I haven't decided yet."
        for (const f of PERF_FIELDS) {
          if (f in b.perfBudget && typeof b.perfBudget[f] !== "number") {
            add("perf-budget", `PERF-${String(++n.PERF).padStart(3, "0")}`, perfSeverity,
              `${b.id} perfBudget.${f} is "${b.perfBudget[f]}", not a number.`,
              `Set ${f} to a concrete number or remove it.`, b.id);
          }
        }
      }
    }
    // 3. commsStates — required only for user-facing behaviors.
    if (userFacing) {
      if (!b.commsStates) {
        add("comms-completeness", `COMMS-${String(++n.COMMS).padStart(3, "0")}`, "blocker",
          `${b.id} has no commsStates.`,
          `Under ${b.id}, add the user-facing copy for each state:\n    commsStates:\n      empty: "<what shows when there's nothing yet>"\n      loading: "<in-progress text>"\n      success: "<confirmation>"\n      error: "<actionable error — say what to do, not just 'failed'>"`,
          b.id);
      } else {
        for (const f of REQUIRED_COMMS) {
          if (!b.commsStates[f] || String(b.commsStates[f]).trim() === "") {
            add("comms-completeness", `COMMS-${String(++n.COMMS).padStart(3, "0")}`, "blocker",
              `${b.id} is missing the "${f}" state copy.`,
              `Add \`${f}: "<copy for the ${f} state>"\` under ${b.id}'s commsStates.`, b.id);
          }
        }
      }
    }
    // 4. platforms subset of contract platforms
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
        `Under "## Acceptance criteria", add a line like:\n    - AC<n> (${b.id}): Given <starting state>, when <user action>, then <expected result>.`,
        b.id);
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

// ─── Model routing (fully deterministic) ─────────────────────────────
// People shouldn't have to know which model to use — the system picks.
// The model for each critic is a deterministic function of (a) a fixed
// baseline tier per critic and (b) the contract's sizing complexity,
// which we already computed above for free. Heavy critics escalate to
// the strong model only on large/risky contracts; everything else stays
// on the fast tier. Because the choice is pure code over an
// already-deterministic input, it's reproducible — which is what keeps
// findings reproducible-by-reference (see reference/CRITIC-PROTOCOL.md).
// This is deliberately NOT an LLM classifier: that would cost a token
// call and reintroduce non-determinism into the verdict path.

const MODEL_TIERS = { light: "haiku", default: "sonnet", strong: "opus" };

// Baseline tier per critic. "heavy" critics escalate by complexity.
const CRITIC_BASELINE = {
  minimality: "light",
  "comms-completeness": "light",
  "edge-cases": "default",
  instrumentation: "default",
  "perf-budget": "default",
  "platform-parity": "default",
  regression: "heavy",
  security: "heavy",
  scalability: "heavy",
};

// Returns { complexity, heavyModel, models: {critic: modelAlias}, note }.
// `conventions.criticModels` (from .manifest/repos.yml) overrides any
// critic's model explicitly; the override always wins.
function computeModelPlan(contract, sizing, conventions = {}) {
  const sz = sizing || computeSizing(contract);
  const override = (conventions && conventions.criticModels) || {};
  // Heavy critics go strong only when the contract is genuinely big or
  // risky (large = 8+ behaviors, 3+ platforms, or an auth/billing/
  // migration risk flag). small/medium hold on the fast tier.
  const heavyModel =
    sz.complexity === "large" ? MODEL_TIERS.strong : MODEL_TIERS.default;

  const models = {};
  for (const [critic, baseline] of Object.entries(CRITIC_BASELINE)) {
    let model;
    if (baseline === "light") model = MODEL_TIERS.light;
    else if (baseline === "heavy") model = heavyModel;
    else model = MODEL_TIERS.default;
    if (override[critic]) model = override[critic]; // repos.yml wins
    models[critic] = model;
  }

  return {
    complexity: sz.complexity,
    heavyModel,
    models,
    note:
      `Heavy critics (regression/security/scalability) → ${heavyModel} ` +
      `for a ${sz.complexity} contract; light critics ` +
      `(minimality/comms-completeness) → ${MODEL_TIERS.light}; the rest → ` +
      `${MODEL_TIERS.default}. Override per-critic with ` +
      `conventions.criticModels in .manifest/repos.yml.`,
  };
}

// ─── Cost observability (deterministic GIVEN recorded usage) ─────────
// Token usage is non-deterministic, so it is NEVER a gate input and never
// part of reproducible provenance — it's recorded as observability only
// (same rule as the advisor). But turning recorded usage into a dollar
// figure IS deterministic code given a pricing table, and that's what
// closes the loop on model routing: you can measure whether tiering and
// the advisor actually saved money, instead of assuming they did.

// Normalize a model alias or full ID (claude-sonnet-4-6) to a pricing key.
function normalizeModel(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  for (const fam of ["haiku", "sonnet", "opus", "fable"]) {
    if (m === fam || m.includes(fam)) return fam;
  }
  return null;
}

// Cost of one usage entry { model, inputTokens, outputTokens } given a
// pricing table (per-million-token). Unpriced models cost 0 and are
// flagged priced:false so the rollup can warn rather than hide them.
function entryCost(entry, pricing) {
  const fam = normalizeModel(entry && entry.model);
  const rate = fam && pricing && pricing.models && pricing.models[fam];
  const inT = Number(entry && entry.inputTokens) || 0;
  const outT = Number(entry && entry.outputTokens) || 0;
  if (!rate) {
    return { model: entry && entry.model, family: fam, priced: false,
             inputTokens: inT, outputTokens: outT, cost: 0 };
  }
  const inputCost = (inT / 1e6) * rate.input;
  const outputCost = (outT / 1e6) * rate.output;
  return {
    model: entry.model, family: fam, priced: true,
    inputTokens: inT, outputTokens: outT,
    inputCost, outputCost, cost: inputCost + outputCost,
  };
}

// Aggregate a usage object { byCritic: {name: entry}, advisor: entry|null }
// into a cost breakdown. Pure + deterministic given (usage, pricing).
function computeCost(usage, pricing) {
  const byCritic = {};
  let inputTokens = 0, outputTokens = 0, total = 0, unpriced = 0;
  const add = (label, entry) => {
    if (!entry) return;
    const c = entryCost(entry, pricing);
    byCritic[label] = c;
    inputTokens += c.inputTokens || 0;
    outputTokens += c.outputTokens || 0;
    total += c.cost || 0;
    if (!c.priced) unpriced += 1;
  };
  const critics = (usage && usage.byCritic) || {};
  for (const [name, entry] of Object.entries(critics)) add(name, entry);
  if (usage && usage.advisor) add("advisor", usage.advisor);
  return {
    currency: (pricing && pricing.currency) || "USD",
    inputTokens, outputTokens,
    total: Number(total.toFixed(6)),
    unpricedEntries: unpriced,
    byCritic,
  };
}

// ─── Bug-pattern catalog (deterministic structure checks) ────────────
// The learning loop: a postmortem proposes a candidate bug pattern, a
// human accepts it into reference/BUG-PATTERNS.md, and code-review then
// enforces it forever. These pure functions guard that loop — a malformed
// or duplicate-numbered machine-proposed entry fails loudly instead of
// silently corrupting the catalog. Next-ID assignment is deterministic so
// two promotions never collide.

const BP_REQUIRED_FIELDS = [
  "Where it bites", "The shape", "Why it slips past basic review",
  "The fix", "Where first observed",
];

// All BP ids in document order (includes struck-through ~~BP-007~~).
function parseBugPatternIds(md) {
  const ids = [];
  for (const line of String(md).split("\n")) {
    const m = line.match(/^###\s+~{0,2}(BP-\d+)/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// The next monotonic id to assign. Deterministic — no collisions.
function nextBugPatternId(md) {
  const nums = parseBugPatternIds(md).map((id) => Number(id.split("-")[1]));
  const max = nums.length ? Math.max(...nums) : 0;
  return `BP-${String(max + 1).padStart(3, "0")}`;
}

// Validate ONE entry block (from its ### header to the next ###).
function validateBugPatternEntry(text) {
  const errors = [];
  const header = String(text).split("\n").find((l) => l.startsWith("### "));
  if (!header || !/^###\s+BP-\d+\s+—\s+.+/.test(header)) {
    errors.push("header must match '### BP-NNN — <name>'");
  }
  for (const field of BP_REQUIRED_FIELDS) {
    const re = new RegExp(`\\*\\*${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*\\s*:`);
    if (!re.test(text)) errors.push(`missing required field "${field}"`);
  }
  return errors;
}

// Validate the whole catalog: every active entry well-formed, ids unique
// and monotonically increasing. Struck-through (~~BP-NNN~~) entries keep
// their number but skip field checks.
function validateBugPatternsDoc(md) {
  const errors = [];
  const blocks = [];
  let cur = null;
  for (const line of String(md).split("\n")) {
    if (/^###\s/.test(line)) { if (cur !== null) blocks.push(cur); cur = line + "\n"; }
    else if (cur !== null) cur += line + "\n";
  }
  if (cur !== null) blocks.push(cur);

  const bpBlocks = blocks.filter((b) => /^###\s+~{0,2}BP-\d+/.test(b));
  const seen = new Set();
  let prev = 0;
  for (const b of bpBlocks) {
    const idm = b.match(/BP-(\d+)/);
    const struck = /^###\s+~~/.test(b);
    const id = idm ? `BP-${idm[1]}` : "?";
    if (idm) {
      if (seen.has(id)) errors.push(`duplicate ${id}`);
      seen.add(id);
      const n = Number(idm[1]);
      if (n <= prev) errors.push(`${id} not monotonically increasing (followed ${prev})`);
      prev = n;
    }
    if (!struck) {
      for (const e of validateBugPatternEntry(b)) errors.push(`${id}: ${e}`);
    }
  }
  return { valid: errors.length === 0, count: bpBlocks.length, errors };
}

// ─── Implementer working state (context-compaction resilience) ───────
// Long Implementer runs overflow the context window and the runtime
// auto-summarizes — lossily. So the Implementer must NOT trust its
// in-context memory of the plan/ACs/progress; it externalizes them to a
// durable state file and re-reads them as ground truth. This compact,
// deterministic status read lets the agent (or a resumed run) recover
// exactly what's done and what's left in ~100 tokens, instead of
// re-deriving it from a summarized transcript.

const AC_STATES = new Set(["pending", "in_progress", "done"]);

function validateImplementState(state) {
  const errors = [];
  if (!state || typeof state !== "object" || Array.isArray(state))
    return ["implement-state is not an object"];
  if (typeof state.contractId !== "string" || !state.contractId)
    errors.push(`missing/invalid "contractId"`);
  const ac = state.acStatus;
  if (!ac || typeof ac !== "object" || Array.isArray(ac)) {
    errors.push(`"acStatus" must be an object map of acId → { status }`);
  } else {
    for (const [id, v] of Object.entries(ac)) {
      if (!v || typeof v !== "object" || !AC_STATES.has(v.status))
        errors.push(`acStatus["${id}"].status must be one of pending|in_progress|done`);
    }
  }
  if (state.filesTouched != null && !Array.isArray(state.filesTouched))
    errors.push(`"filesTouched" must be an array`);
  return errors;
}

// Compact progress summary derived purely from the state file.
function computeImplementStatus(state) {
  const ac = (state && state.acStatus) || {};
  const ids = Object.keys(ac);
  const bucket = { pending: [], in_progress: [], done: [] };
  for (const id of ids) {
    const s = ac[id] && ac[id].status;
    if (bucket[s]) bucket[s].push(id);
  }
  return {
    contractId: (state && state.contractId) || null,
    iteration: (state && state.iteration) || 0,
    totalAcs: ids.length,
    done: bucket.done.length,
    remaining: bucket.pending.length + bucket.in_progress.length,
    pending: bucket.pending,
    inProgress: bucket.in_progress,
    doneIds: bucket.done,
    filesTouched: (state && Array.isArray(state.filesTouched) ? state.filesTouched.length : 0),
    complete: ids.length > 0 && bucket.done.length === ids.length,
  };
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

  // The ONLY hard gate is blockers. Warnings/info are advisory — they
  // refine `readiness` for signal, but they never stop a dev from
  // promoting. This is what keeps verify from feeling endless: drive the
  // finite, stable set of blockers to zero and you're promotable; you
  // don't have to chase run-to-run-variable warnings to zero. A warning
  // marked `acknowledged` (or `dismissed`) is no longer "open" and drops
  // out of these counts, so it can't re-litigate forever.
  const promotable = openBlockers === 0;

  return { readiness, promotable, reasons, openBlockers, openWarnings };
}

// ─── SLA status (deterministic given deadline + now) ─────────────────

function fmtDuration(ms) {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Format an instant in BOTH IST and UTC. IST has no DST — fixed +5:30.
// e.g. "2026-05-21 13:30 IST / 08:00 UTC"
function fmtBothZones(isoOrMs) {
  const d = new Date(isoOrMs);
  if (isNaN(d.getTime())) return String(isoOrMs);
  const utc = d.toISOString().slice(0, 16).replace("T", " ");
  const ist = new Date(d.getTime() + 5.5 * 3_600_000)
    .toISOString().slice(0, 16).replace("T", " ");
  return `${ist} IST / ${utc} UTC`;
}

// Returns a one-line SLA label + structured state. Every status update
// during the build/ship phases should lead with `label`.
function slaStatus(frontmatter, now = Date.now()) {
  const deadline = frontmatter.slaDeadline;
  if (!deadline) {
    return { hasSla: false, state: "none", remainingMs: null, deadline: null,
      label: "SLA: not started (promote to start the timer)" };
  }
  const deadlineMs = Date.parse(deadline);
  const remainingMs = deadlineMs - now;
  const due = fmtBothZones(deadline);
  if (remainingMs < 0) {
    return { hasSla: true, state: "overdue", remainingMs, deadline,
      label: `⚠️ SLA OVERDUE by ${fmtDuration(remainingMs)} (was due ${due})` };
  }
  // warning if < 20% of the window remains
  const promotedAt = frontmatter.promotedAt ? Date.parse(frontmatter.promotedAt) : null;
  const totalMs = promotedAt ? deadlineMs - promotedAt : null;
  const pctLeft = totalMs && totalMs > 0 ? remainingMs / totalMs : 1;
  const warning = pctLeft < 0.2;
  return {
    hasSla: true,
    state: warning ? "warning" : "ok",
    remainingMs,
    deadline,
    label: `${warning ? "⏳⚠️" : "⏳"} SLA: ${fmtDuration(remainingMs)} left (due ${due})`,
  };
}

// ─── Phase + next action (deterministic from frontmatter) ────────────

function derivePhase(fm) {
  if (fm.landed === true) return { phase: "Landed ✅", next: "Done. Final verdict committed." };
  if (fm.landed === "partial") return { phase: "Landed (partial)", next: "Review the day-28 report; consider a follow-up." };
  if (fm.landed === false || fm.landed === "not-landed") return { phase: "Not landed", next: "Read the launch report; file a follow-up contract." };
  if (fm.landed === "rolled-back") return { phase: "Rolled back", next: "Read what was learned; fix and re-run the cycle." };

  if (fm.status === "draft") return { phase: "① Drafting", next: `/contract verify ${fm.id}` };
  if (fm.status === "verifying") return { phase: "① Verifying", next: "wait for critics, then resolve findings" };
  if (fm.status === "verified") {
    if (fm.complexity === "large") return { phase: "① Verified (Large)", next: `/contract decompose ${fm.id}` };
    return { phase: "① Verified", next: `/contract promote ${fm.id}` };
  }
  if (fm.status === "promoted") {
    if (fm.prodRollout100At) return { phase: "④ Landing window", next: "launch reports run day 1/7/14/28" };
    if (fm.canaryStartedAt) return { phase: "③ Canary rollout", next: "watch telemetry; approve next stage" };
    if (fm.qaDeployedAt) return { phase: "③ QA verified", next: "approve canary" };
    if (fm.prMergedAt) return { phase: "③ Deploying", next: "verify-deploy runs on deploy" };
    if (fm.prOpenedAt) return { phase: "② In review", next: "review the PR and merge" };
    return { phase: "② Building", next: `comment @claude /implement ${fm.id} on a PR` };
  }
  return { phase: fm.status || "unknown", next: "—" };
}

// ─── Content-hash cache ──────────────────────────────────────────────

// Is the existing findings file still valid for the current contract?
// Valid (cached) means: same content hash + same plugin version + same
// protocol version → the verify can be skipped and prior findings
// reused. Model is recorded for provenance but NOT part of the cache
// key (the eval suite, not the cache, defends against model drift).
function cacheStatus(currentHash, pluginVersion, protocolVersion, findingsFm) {
  if (!findingsFm || Object.keys(findingsFm).length === 0)
    return { cached: false, reason: "no prior findings — run a full verify" };
  const w = findingsFm.verifiedWith || {};
  if (w.contractHash !== currentHash)
    return { cached: false, reason: "contract content changed since last verify" };
  if (String(w.pluginVersion) !== String(pluginVersion))
    return { cached: false, reason: `plugin version changed (${w.pluginVersion} → ${pluginVersion})` };
  if (Number(w.protocolVersion) !== Number(protocolVersion))
    return { cached: false, reason: `protocol version changed (${w.protocolVersion} → ${protocolVersion})` };
  return { cached: true, reason: `unchanged since ${findingsFm.verifiedAt || "last verify"}` };
}

// ─── Incremental re-verify (fragment hashing) ────────────────────────
// The cache (cacheStatus) is all-or-nothing on the whole contract. For
// re-verify after an edit, we want finer grain: hash each behavior (+ its
// ACs) and a "global" bucket of contract-wide context, so localized
// critics (comms, perf-budget, platform-parity, instrumentation) only
// re-run over the behaviors that actually changed, and the cross-cutting
// critics + regression scan can be reused when nothing relevant moved.

function sectionText(raw, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$`, "m");
  const m = raw.match(re);
  if (!m) return "";
  const after = raw.slice(m.index + m[0].length);
  const next = after.match(/\n(?=##\s)/);
  return (next ? after.slice(0, next.index) : after).trim();
}

function fragmentHashes(contract) {
  const { frontmatter, behaviors, acs, raw } = contract;
  const acsByBehavior = {};
  for (const ac of acs)
    for (const ref of ac.behaviorRefs) (acsByBehavior[ref] ||= []).push(ac.text);
  const behaviorHashes = {};
  for (const b of behaviors) {
    const payload = JSON.stringify({ b, acs: (acsByBehavior[b.id] || []).slice().sort() });
    behaviorHashes[b.id] = hashOf(payload);
  }
  const global = hashOf(JSON.stringify({
    platforms: (frontmatter.platforms || []).slice().sort(),
    behaviorIds: behaviors.map((b) => b.id).sort(),
    goal: sectionText(raw, "Goal"),
    successMetrics: sectionText(raw, "Success metrics"),
    outOfScope: sectionText(raw, "Out of scope"),
    openQuestions: sectionText(raw, "Open questions"),
  }));
  return { global, behaviors: behaviorHashes };
}

function changedFragments(prev, curr) {
  prev = prev || { global: null, behaviors: {} };
  const prevB = prev.behaviors || {};
  const currB = curr.behaviors || {};
  const changed = [], added = [], removed = [];
  for (const id of Object.keys(currB)) {
    if (!(id in prevB)) added.push(id);
    else if (prevB[id] !== currB[id]) changed.push(id);
  }
  for (const id of Object.keys(prevB)) if (!(id in currB)) removed.push(id);
  return { globalChanged: prev.global !== curr.global, changed, added, removed };
}

// What regression cares about: the cross-repo API surface. If this is
// unchanged, regression can reuse its prior (expensive) repo scan.
function apiSurfaceHash(contract) {
  const { frontmatter, behaviors } = contract;
  const surface = behaviors.map((b) => ({
    id: b.id,
    platforms: (b.platforms || []).slice().sort(),
    event: (b.instrumentation && b.instrumentation.eventName) || null,
  }));
  return hashOf(JSON.stringify({
    platforms: (frontmatter.platforms || []).slice().sort(),
    surface,
  }));
}

// Translate a fragment diff into a concrete re-run plan the verify
// orchestrator follows. Conservative on correctness: any structural
// change re-runs the cross-cutting critics; only localized critics are
// scoped to changed behaviors.
function rerunPlan(prevFindingsFm, contract) {
  const prevFh = prevFindingsFm && prevFindingsFm.fragmentHashes;
  const currFh = fragmentHashes(contract);
  const diff = changedFragments(prevFh, currFh);
  const anyChange =
    diff.globalChanged || diff.changed.length || diff.added.length || diff.removed.length;
  const currApi = apiSurfaceHash(contract);
  const prevApi = prevFindingsFm && prevFindingsFm.apiSurfaceHash;
  const apiChanged = prevApi !== currApi;
  const firstVerify = !prevFh;
  return {
    firstVerify,
    diff,
    // comms-completeness, perf-budget, platform-parity, instrumentation
    localizedBehaviors: [...new Set([...diff.changed, ...diff.added])],
    // edge-cases, security, scalability
    rerunCrossCutting: firstVerify || !!anyChange,
    // regression: full repo scan / reuse scan but re-reason / reuse findings
    regression: firstVerify || apiChanged ? "rescan" : anyChange ? "reason-only" : "reuse",
    currFragmentHashes: currFh,
    currApiSurfaceHash: currApi,
  };
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
    if (!FINDING_STATUSES.has(f.status))
      errors.push(`[${i}] invalid status "${f.status}"`);
    // Advisor escalation is restricted to advisory findings. The advisor
    // is non-deterministic, and blockers are the gate — so an
    // advisor-influenced finding may NEVER be a blocker. This keeps the
    // promotability verdict (zero open blockers) fully deterministic even
    // when critics consult the advisor on borderline soft findings.
    if (f.metadata && f.metadata.advisorConsulted && f.severity === "blocker")
      errors.push(`[${i}] advisor-influenced finding may not be a blocker — advisor escalation is restricted to warning|info`);
  });
  return errors;
}

// ─── PR-stage code-review schema validation ──────────────────────────
// Code-review findings reuse the closed severity enum but operate on a
// diff: they carry a `category`, a `file`, and an optional `line`. IDs
// use the CR- prefix. Out-of-schema output is a bug, not a finding.

function validateReviewFindings(findings) {
  const errors = [];
  if (!Array.isArray(findings)) return ["review findings is not an array"];
  findings.forEach((f, i) => {
    if (!f || typeof f !== "object") { errors.push(`[${i}] not an object`); return; }
    if (!SEVERITIES.has(f.severity))
      errors.push(`[${i}] invalid severity "${f.severity}" — must be blocker|warning|info`);
    if (!REVIEW_CATEGORIES.has(f.category))
      errors.push(`[${i}] invalid category "${f.category}" — must be one of ${[...REVIEW_CATEGORIES].join("|")}`);
    for (const k of ["id", "message", "suggestion", "file"])
      if (typeof f[k] !== "string" || !f[k])
        errors.push(`[${i}] missing/invalid "${k}"`);
    if (typeof f.id === "string" && !f.id.startsWith("CR-"))
      errors.push(`[${i}] id "${f.id}" must use the CR- prefix`);
    if (f.line != null && typeof f.line !== "number")
      errors.push(`[${i}] "line" must be a number or null`);
    if (!FINDING_STATUSES.has(f.status))
      errors.push(`[${i}] invalid status "${f.status}"`);
  });
  return errors;
}

// ─── rollback-guard verdict validation ───────────────────────────────
// The guard recommends; it does not act. A verdict is a single object,
// not an array, with a closed verdict enum and grounded signals.

function validateGuardVerdict(v) {
  const errors = [];
  if (!v || typeof v !== "object" || Array.isArray(v))
    return ["guard verdict is not an object"];
  if (!GUARD_VERDICTS.has(v.verdict))
    errors.push(`invalid verdict "${v.verdict}" — must be ${[...GUARD_VERDICTS].join("|")}`);
  if (typeof v.reason !== "string" || !v.reason)
    errors.push(`missing/invalid "reason"`);
  if (!Array.isArray(v.signals))
    errors.push(`"signals" must be an array`);
  else
    v.signals.forEach((s, i) => {
      if (!s || typeof s !== "object") { errors.push(`signal[${i}] not an object`); return; }
      for (const k of ["name", "observed", "budget", "status"])
        if (!(k in s)) errors.push(`signal[${i}] missing "${k}"`);
      if (s.status && !["ok", "warning", "breach"].includes(s.status))
        errors.push(`signal[${i}] invalid status "${s.status}" — must be ok|warning|breach`);
    });
  return errors;
}

// Exports for the eval harness / unit tests.
export {
  parseContract,
  checkContract,
  computeSizing,
  computeModelPlan,
  computeCost,
  normalizeModel,
  parseBugPatternIds,
  nextBugPatternId,
  validateBugPatternEntry,
  validateBugPatternsDoc,
  validateImplementState,
  computeImplementStatus,
  computeReadiness,
  validateFindings,
  validateReviewFindings,
  validateGuardVerdict,
  fragmentHashes,
  changedFragments,
  apiSurfaceHash,
  rerunPlan,
  slaStatus,
  derivePhase,
  fmtBothZones,
  cacheStatus,
  hashOf,
  readFrontmatter,
  SEVERITIES,
  FINDING_STATUSES,
  REVIEW_CATEGORIES,
  GUARD_VERDICTS,
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

  if (args[0] === "--check-review") {
    // Validate code-review skill output (CR- findings on a diff).
    const findings = JSON.parse(readFileSync(args[1], "utf8"));
    const errors = validateReviewFindings(findings);
    if (errors.length) {
      console.error(JSON.stringify({ valid: false, errors }, null, 2));
      process.exit(1);
    }
    const blockers = findings.filter((f) => f.severity === "blocker" && f.status === "open").length;
    console.log(JSON.stringify({ valid: true, count: findings.length, openBlockers: blockers }, null, 2));
    // Non-zero exit when open blockers exist so CI can gate the merge.
    process.exit(blockers > 0 ? 2 : 0);
  }

  if (args[0] === "--changed") {
    // Incremental re-verify plan: which critics to re-run given the prior
    // findings. Usage: --changed <contract.md> <prev-findings.json>
    const md = readFileSync(args[1], "utf8");
    const contract = parseContract(md);
    let prevFm = {};
    if (args[2]) {
      try { prevFm = JSON.parse(readFileSync(args[2], "utf8")); } catch { prevFm = {}; }
    }
    const plan = rerunPlan(prevFm, contract);
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }

  if (args[0] === "--check-guard") {
    // Validate rollback-guard verdict output.
    const verdict = JSON.parse(readFileSync(args[1], "utf8"));
    const errors = validateGuardVerdict(verdict);
    if (errors.length) {
      console.error(JSON.stringify({ valid: false, errors }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ valid: true, verdict: verdict.verdict }, null, 2));
    process.exit(verdict.verdict === "recommend-rollback" ? 3 : 0);
  }

  if (args[0] === "--sla") {
    // Print the one-line SLA label for a contract. Skills prepend this
    // to every status update during the build/ship phases.
    const md = readFileSync(args[1], "utf8");
    const { frontmatter } = parseContract(md);
    const sla = slaStatus(frontmatter);
    console.log(sla.label);
    process.exit(sla.state === "overdue" ? 1 : 0);
  }

  if (args[0] === "--cache-check") {
    // Is the existing findings file still valid for this contract?
    // Exit 0 = cached (skip verify), 1 = stale (run verify).
    const contractPath = args[1];
    const md = readFileSync(contractPath, "utf8");
    const currentHash = hashOf(md);
    const findingsPath = contractPath.replace(/\.md$/, ".findings.md");
    const findingsFm = existsSync(findingsPath)
      ? readFrontmatter(readFileSync(findingsPath, "utf8"))
      : {};
    // plugin version from <plugin>/.claude-plugin/plugin.json
    let pv = "unknown";
    try {
      const pj = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");
      pv = JSON.parse(readFileSync(pj, "utf8")).version;
    } catch { /* leave unknown */ }
    const cs = cacheStatus(currentHash, pv, PROTOCOL_VERSION, findingsFm);
    console.log(JSON.stringify({ ...cs, currentHash, pluginVersion: pv }, null, 2));
    process.exit(cs.cached ? 0 : 1);
  }

  if (args[0] === "--cost") {
    // Cost rollup across verified contracts. Scans <dir> (default
    // .manifest/contracts) for *.findings.json that carry a `usage` block,
    // computes cost from reference/model-pricing.json, and reports totals
    // by complexity, by critic, and by model. Powers `/manifest cost`.
    // Usage: validate.mjs --cost [dir] [--json]
    const dir = args[1] && !args[1].startsWith("--") ? args[1] : ".manifest/contracts";
    const asJson = args.includes("--json");
    const here = dirname(fileURLToPath(import.meta.url));
    let pricing = { currency: "USD", models: {} };
    try {
      pricing = JSON.parse(readFileSync(join(here, "..", "reference", "model-pricing.json"), "utf8"));
    } catch { /* no pricing file → costs render as 0, tokens still sum */ }

    let files = [];
    // findings.json carries critic usage; implement.json carries Implementer
    // (+ its advisor) usage — the token-heaviest step. Roll up both.
    try {
      files = readdirSync(dir).filter(
        (f) => f.endsWith(".findings.json") || f.endsWith(".implement.json")
      );
    } catch { console.error(`Cannot read directory: ${dir}`); process.exit(2); }

    const byComplexity = {}, byCritic = {}, byModel = {};
    let grandTotal = 0, grandIn = 0, grandOut = 0, contractsWithUsage = 0, unpriced = 0;
    const rows = [];

    for (const f of files) {
      let doc;
      try { doc = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
      const usage = doc.usage;
      if (!usage || !usage.byCritic) continue;
      contractsWithUsage += 1;
      let complexity = (doc.verifiedWith && doc.verifiedWith.complexity) || null;
      // An implement.json has no sizing of its own — borrow it from the
      // sibling findings.json so the by-complexity view stays accurate.
      if (!complexity && f.endsWith(".implement.json")) {
        const sib = join(dir, f.replace(/\.implement\.json$/, ".findings.json"));
        try { complexity = JSON.parse(readFileSync(sib, "utf8")).verifiedWith?.complexity; } catch { /* none */ }
      }
      complexity = complexity || "unknown";
      const cost = computeCost(usage, pricing);
      unpriced += cost.unpricedEntries || 0;
      grandTotal += cost.total; grandIn += cost.inputTokens; grandOut += cost.outputTokens;
      byComplexity[complexity] = (byComplexity[complexity] || 0) + cost.total;
      for (const [name, c] of Object.entries(cost.byCritic)) {
        byCritic[name] = (byCritic[name] || 0) + c.cost;
        if (c.family) byModel[c.family] = (byModel[c.family] || 0) + c.cost;
      }
      const name = f.replace(/\.(findings|implement)\.json$/, "");
      const step = f.endsWith(".implement.json") ? "implement" : "verify";
      rows.push({ contract: name, step, complexity, cost: Number(cost.total.toFixed(4)) });
    }

    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v.toFixed(4))]));
    const result = {
      currency: pricing.currency || "USD",
      pricingLastUpdated: pricing.lastUpdated || "unknown",
      contractsWithUsage,
      totalCost: Number(grandTotal.toFixed(4)),
      totalInputTokens: grandIn, totalOutputTokens: grandOut,
      byComplexity: round(byComplexity), byCritic: round(byCritic), byModel: round(byModel),
      unpricedEntries: unpriced,
      perContract: rows.sort((a, b) => b.cost - a.cost),
    };

    if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

    const cur = result.currency;
    const fmtMoney = (n) => `${cur} ${n.toFixed(4)}`;
    if (contractsWithUsage === 0) {
      console.log(`No usage data found in ${dir}. Verify a contract after enabling usage recording (findings.json \`usage\` block).`);
      process.exit(0);
    }
    console.log(`Cost rollup — ${contractsWithUsage} contract(s) with usage · prices as of ${result.pricingLastUpdated} (estimates)\n`);
    console.log(`Total: ${fmtMoney(result.totalCost)}  (${grandIn.toLocaleString()} in / ${grandOut.toLocaleString()} out tokens)\n`);
    console.log("By complexity:");
    for (const [k, v] of Object.entries(result.byComplexity)) console.log(`  ${k.padEnd(8)} ${fmtMoney(v)}`);
    console.log("\nBy model tier:");
    for (const [k, v] of Object.entries(result.byModel)) console.log(`  ${k.padEnd(8)} ${fmtMoney(v)}`);
    console.log("\nBy critic:");
    for (const [k, v] of Object.entries(result.byCritic).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${fmtMoney(v)}`);
    if (unpriced > 0) console.log(`\n⚠ ${unpriced} usage entr(y/ies) had an unpriced model — update reference/model-pricing.json.`);
    process.exit(0);
  }

  if (args[0] === "--check-patterns") {
    // Structurally validate the bug-pattern catalog (+ optional candidates
    // file). Fails loudly on a malformed or duplicate-numbered entry so a
    // machine-proposed pattern can't silently corrupt the catalog.
    // Usage: validate.mjs --check-patterns [BUG-PATTERNS.md] [candidates.md]
    const here = dirname(fileURLToPath(import.meta.url));
    const paths = args.slice(1).filter((a) => !a.startsWith("--"));
    if (paths.length === 0) paths.push(join(here, "..", "reference", "BUG-PATTERNS.md"));
    let allOk = true;
    for (const p of paths) {
      let md;
      try { md = readFileSync(p, "utf8"); }
      catch { console.error(`Cannot read ${p}`); process.exit(2); }
      const r = validateBugPatternsDoc(md);
      console.log(JSON.stringify({ file: p, ...r }, null, 2));
      if (!r.valid) allOk = false;
    }
    process.exit(allOk ? 0 : 1);
  }

  if (args[0] === "--next-pattern-id") {
    // Print the next BP-NNN to assign. Deterministic — used when promoting
    // a candidate so two promotions never collide on a number.
    const here = dirname(fileURLToPath(import.meta.url));
    const p = (args[1] && !args[1].startsWith("--")) ? args[1]
      : join(here, "..", "reference", "BUG-PATTERNS.md");
    console.log(nextBugPatternId(readFileSync(p, "utf8")));
    process.exit(0);
  }

  if (args[0] === "--implement-status") {
    // Compact, authoritative progress read for a long Implementer run —
    // what's done, what's left — straight from the durable state file, so
    // the agent recovers ground truth after a context summarization instead
    // of trusting a lossy transcript. Usage: --implement-status <ID|path> [--json]
    const id = args[1];
    if (!id || id.startsWith("--")) { console.error("usage: validate.mjs --implement-status <ID> [--json]"); process.exit(2); }
    const path = id.endsWith(".json") ? id : `.manifest/contracts/${id}.implement-state.json`;
    if (!existsSync(path)) {
      console.log(`No working state at ${path} — treat as a fresh run (build from the plan + revision ACs).`);
      process.exit(0);
    }
    let state;
    try { state = JSON.parse(readFileSync(path, "utf8")); }
    catch (e) { console.error(`Cannot parse ${path}: ${e.message}`); process.exit(2); }
    const errors = validateImplementState(state);
    const status = computeImplementStatus(state);
    if (args.includes("--json")) { console.log(JSON.stringify({ ...status, schemaErrors: errors }, null, 2)); process.exit(errors.length ? 1 : 0); }
    if (errors.length) { console.error("Invalid implement-state:\n  " + errors.join("\n  ")); process.exit(1); }
    console.log(
      `${status.contractId} — iteration ${status.iteration}\n` +
      `  ACs:   ${status.done}/${status.totalAcs} done` +
        (status.remaining ? ` · ${status.remaining} remaining` : "") + `\n` +
      (status.pending.length ? `  todo:  ${status.pending.join(", ")}\n` : "") +
      (status.inProgress.length ? `  wip:   ${status.inProgress.join(", ")}\n` : "") +
      `  files: ${status.filesTouched} touched\n` +
      `  ${status.complete ? "✅ all ACs done — finish, self-review, push." : "↻ resume from todo/wip above. Re-read the plan + revision; don't rely on memory."}`
    );
    process.exit(0);
  }

  if (args[0] === "--status") {
    // A compact status block for a contract: phase, SLA, readiness,
    // next action. Deterministic. Powers the /status command.
    const md = readFileSync(args[1], "utf8");
    const c = parseContract(md);
    const fm = c.frontmatter;
    const { phase, next } = derivePhase(fm);
    const sla = slaStatus(fm);
    const findings = fm.type === "epic" ? [] : checkContract(c);
    const readiness = computeReadiness(c, findings);
    console.log(
      `${fm.id} — ${fm.title}\n` +
      `  phase:     ${phase}\n` +
      `  ${sla.label}\n` +
      `  readiness: ${readiness.readiness}` +
        (readiness.reasons.length ? ` (${readiness.reasons.join("; ")})` : "") + `\n` +
      `  next:      ${next}`
    );
    process.exit(sla.state === "overdue" ? 1 : 0);
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
  const contractHash = hashOf(md);

  // Best-effort: pick up per-critic model overrides from repos.yml if it
  // exists. Routing falls back to the deterministic defaults otherwise.
  let conventions = {};
  try {
    if (existsSync(".manifest/repos.yml")) {
      const ry = yaml.load(readFileSync(".manifest/repos.yml", "utf8")) || {};
      conventions = ry.conventions || {};
    }
  } catch { /* malformed repos.yml → use default routing */ }
  const modelPlan = computeModelPlan(contract, sizing, conventions);

  const out = {
    protocolVersion: PROTOCOL_VERSION,
    contractHash,
    changeType: contract.frontmatter.changeType || "feature",
    deterministicFindings: findings,
    sizing,
    modelPlan,
    readiness,
    note: "Deterministic layer only. Run LLM judgment critics for edge-cases, security reasoning, regression, copy quality, and platform UX specifics. For changeType: bug-fix, run the LEAN set (minimality + scoped edge-cases + regression + security-if-relevant).",
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(readiness.openBlockers > 0 ? 1 : 0);
}

// Only run the CLI when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
