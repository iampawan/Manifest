#!/usr/bin/env node
// Manifest answer watcher.
//
// Polls PM channels (JIRA comments, Slack thread replies, Notion page
// comments, Google Doc suggestions) for answers to open questions posted
// during the pickup flow. On a detected answer, surfaces it to the agent
// for AC-edit application — this script does the *detection* half; the
// actual answer-application step is invoked by handing the detected
// answers off to the contract-pickup skill in apply-mode.
//
// Mental model:
//   - This is a stateless detector. It reads each contract's frontmatter
//     `pickup.openQuestions[]`, asks the right MCP / API "any new replies
//     since lastChecked?", and emits a JSON report of detected answers.
//   - The detector does NOT edit contracts. The pickup skill (running in
//     Claude Code or Cowork) consumes this report and applies the AC
//     edits + provenance comments + qa.md sidecar updates per the skill
//     spec. Keeping the heavy lifting in the skill means we don't
//     re-implement contract-edit logic in JS.
//
// Usage:
//   node answer-watcher.mjs                    # scan all open questions
//   node answer-watcher.mjs --contracts <dir>  # custom contracts dir
//   node answer-watcher.mjs --since <ISO>      # only replies after this time
//   node answer-watcher.mjs --emit <path>      # write report JSON to this file
//                                              # (default: stdout)
//   node answer-watcher.mjs --notify-stale     # surface questions older than
//                                              # 7 days that still have no answer
//   node answer-watcher.mjs --dry-run          # detect, print, write nothing
//
// Designed to run on a 15-minute cron (workflows/answer-watch.yml) OR
// on-demand when a dev re-runs /contract pickup after their PM answered.
//
// MCP requirements (whatever the question's channel is):
//   - jira     → Atlassian MCP (read comments)
//   - slack    → Slack MCP (read thread replies)
//   - notion   → Notion MCP (read page comments)
//   - gdoc     → Google Drive MCP (read suggestions / comments)
// If the required MCP isn't available in the env this script runs in,
// the relevant questions are skipped with `status: "mcp-unavailable"` in
// the report — never blocked, never crashed.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, relative, resolve } from "node:path";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- CLI ----------

function parseArgs(argv) {
  const args = {
    contracts: ".manifest/contracts",
    since: null,
    emit: null,
    notifyStale: false,
    dryRun: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--contracts") args.contracts = argv[++i];
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--emit") args.emit = argv[++i];
    else if (a === "--notify-stale") args.notifyStale = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node answer-watcher.mjs [--contracts <dir>] [--since <ISO>] [--emit <path>] [--notify-stale] [--dry-run] [--verbose]"
      );
      process.exit(0);
    }
  }
  return args;
}

function log(args, ...msgs) {
  if (args.verbose) console.error(...msgs);
}

// ---------- read contracts with open questions ----------

function loadOpenQuestions(contractsDir, args) {
  if (!existsSync(contractsDir)) {
    throw new Error(
      `contracts dir not found: ${contractsDir} — run from a directory with .manifest/contracts/, or pass --contracts <path>`
    );
  }
  const entries = readdirSync(contractsDir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    // skip sidecars + revisions
    if (/\.(findings|qa|implementation-plan|launch-report-day\d+|deploy-qa|guard|bug-log|postmortem|pr-review|r\d+)\.md$/.test(e.name)) continue;
    const path = join(contractsDir, e.name);
    const src = readFileSync(path, "utf8");
    const fm = parseFrontmatter(src);
    if (!fm) continue;
    const pickup = fm.pickup || {};
    const openQs = (pickup.openQuestions || []).filter(
      (q) => q && q.status !== "answered" && q.status !== "stale"
    );
    if (openQs.length === 0) continue;
    out.push({
      contractId: fm.contractId || basename(e.name, ".md"),
      contractPath: path,
      pmChannel: pickup.pmChannel || "jira",
      pmIdentifier: pickup.pmIdentifier,
      sourceUrl: pickup.source,
      openQuestions: openQs,
    });
  }
  log(args, `found ${out.length} contracts with open questions`);
  return out;
}

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try { return yaml.load(m[1]); } catch { return null; }
}

// ---------- channel adapters ----------
//
// Each adapter returns either:
//   { status: "answered", text: "<PM's reply>", at: "<ISO>", by: "<PM>" }
//   { status: "no-reply" }
//   { status: "mcp-unavailable", note: "<which MCP is missing>" }
//   { status: "error", note: "<message>" }
//
// In this v1, adapters are STUBS that emit a deterministic "no-reply" for
// every check (so the script is safe to run anywhere immediately). The
// production behavior — calling MCPs from a Node script — needs either
// (a) running this from inside Claude Code / Cowork via a skill that has
// MCP access, or (b) a thin REST proxy on the MCP host. The skill path is
// the path of least resistance for v0.18; a follow-up wires the REST proxy.
//
// To make the contract observable, each adapter logs what it WOULD call
// when run with --verbose; the report tells the dev which channel needs an
// MCP-enabled re-run.

function checkJira(question, contract, args) {
  log(args, `  jira: would read comments on ${contract.sourceUrl || contract.pmIdentifier} after Q-${question.id} at ${question.askedAt}`);
  return { status: "mcp-unavailable", note: "Run via Claude Code with Atlassian MCP, or wire the REST proxy." };
}

function checkSlack(question, contract, args) {
  log(args, `  slack: would read thread replies on ${contract.sourceUrl} after ${question.askedAt}`);
  return { status: "mcp-unavailable", note: "Run via Claude Code with Slack MCP, or wire the REST proxy." };
}

function checkNotion(question, contract, args) {
  log(args, `  notion: would read page comments on ${contract.sourceUrl} after ${question.askedAt}`);
  return { status: "mcp-unavailable", note: "Run via Claude Code with Notion MCP, or wire the REST proxy." };
}

function checkGdoc(question, contract, args) {
  log(args, `  gdoc: would read suggestions / comments on ${contract.sourceUrl} after ${question.askedAt}`);
  return { status: "mcp-unavailable", note: "Run via Claude Code with Google Drive MCP, or wire the REST proxy." };
}

const ADAPTERS = {
  jira: checkJira,
  slack: checkSlack,
  notion: checkNotion,
  gdoc: checkGdoc,
};

// ---------- staleness ----------

const STALE_DAYS = 7;

function isStale(question) {
  if (!question.askedAt) return false;
  const askedMs = Date.parse(question.askedAt);
  if (Number.isNaN(askedMs)) return false;
  const ageMs = Date.now() - askedMs;
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

// ---------- main ----------

function watch(args) {
  const contracts = loadOpenQuestions(args.contracts, args);
  const sinceMs = args.since ? Date.parse(args.since) : 0;

  const report = {
    version: 1,
    watchedAt: new Date().toISOString(),
    contractsChecked: contracts.length,
    openQuestions: 0,
    answered: [],          // ← detected replies; pickup skill applies them
    noReply: [],
    stale: [],             // > 7 days old, still open
    mcpUnavailable: [],    // questions skipped because the MCP isn't accessible here
    errors: [],
  };

  for (const contract of contracts) {
    for (const q of contract.openQuestions) {
      report.openQuestions++;
      if (sinceMs && q.askedAt && Date.parse(q.askedAt) < sinceMs) continue;

      // staleness first — independent of MCP availability
      if (isStale(q)) {
        report.stale.push({
          contractId: contract.contractId,
          questionId: q.id,
          scope: q.scope,
          askedAt: q.askedAt,
          channel: contract.pmChannel,
          text: q.text,
        });
        if (!args.notifyStale) {
          // still continue to check for replies — being stale doesn't preclude a reply
        }
      }

      const adapter = ADAPTERS[contract.pmChannel];
      if (!adapter) {
        report.errors.push({
          contractId: contract.contractId,
          questionId: q.id,
          note: `unknown pmChannel "${contract.pmChannel}"`,
        });
        continue;
      }

      let result;
      try { result = adapter(q, contract, args); }
      catch (err) {
        report.errors.push({
          contractId: contract.contractId,
          questionId: q.id,
          note: err.message,
        });
        continue;
      }

      const entry = {
        contractId: contract.contractId,
        contractPath: relative(process.cwd(), contract.contractPath),
        questionId: q.id,
        scope: q.scope,
        channel: contract.pmChannel,
        sourceUrl: contract.sourceUrl,
        questionText: q.text,
        askedAt: q.askedAt,
        blocking: q.blocking || false,
      };

      if (result.status === "answered") {
        report.answered.push({ ...entry, answer: { text: result.text, at: result.at, by: result.by } });
      } else if (result.status === "no-reply") {
        report.noReply.push(entry);
      } else if (result.status === "mcp-unavailable") {
        report.mcpUnavailable.push({ ...entry, note: result.note });
      } else if (result.status === "error") {
        report.errors.push({ ...entry, note: result.note });
      }
    }
  }

  // What the runner should do with this report
  report.nextSteps = [];
  if (report.answered.length > 0) {
    report.nextSteps.push(`${report.answered.length} answer(s) detected — invoke contract-pickup in apply-mode to merge them into the contracts.`);
  }
  if (report.mcpUnavailable.length > 0) {
    report.nextSteps.push(`${report.mcpUnavailable.length} question(s) couldn't be checked in this environment (no MCP access). Re-run from Claude Code / Cowork, or wire the REST proxy described in scripts/answer-watcher.mjs.`);
  }
  if (report.stale.length > 0) {
    report.nextSteps.push(`${report.stale.length} question(s) older than ${STALE_DAYS} days — consider pinging the PM directly or marking the question stale via the pickup skill.`);
  }
  if (report.nextSteps.length === 0) {
    report.nextSteps.push(`Nothing actionable — all open questions are recent and still unanswered.`);
  }

  const serialized = JSON.stringify(report, null, 2);

  if (args.dryRun) {
    console.log(serialized);
    return 0;
  }

  if (args.emit) {
    writeFileSync(args.emit, serialized);
    log(args, `wrote ${args.emit}`);
  } else {
    console.log(serialized);
  }
  return 0;
}

// Entry
if (process.argv[1] === __filename || process.argv[1].endsWith("answer-watcher.mjs")) {
  const args = parseArgs(process.argv.slice(2));
  try {
    process.exit(watch(args));
  } catch (err) {
    console.error(`answer-watcher: ${err.message}`);
    if (args.verbose && err.stack) console.error(err.stack);
    process.exit(2);
  }
}

export { watch, loadOpenQuestions, isStale, STALE_DAYS };
