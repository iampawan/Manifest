#!/usr/bin/env node
// Deterministic contract migrator.
//
// Brings an existing contract's frontmatter to the v0.15 author-friendly
// layout WITHOUT losing anything: it parses the frontmatter, re-emits it
// in labelled groups (YOU AUTHOR / MANIFEST MANAGES / OPTIONAL / OTHER),
// adds `changeType: feature` only if absent, and leaves the body 100%
// untouched. Every field is preserved — including managed state
// (timestamps, status, landed, bugFollowups) and any keys this tool
// doesn't recognize (they go to OTHER). Pure reformat, no value changes.
//
// Usage:
//   node migrate-contract.mjs <contract.md>            # print migrated to stdout
//   node migrate-contract.mjs <contract.md> --write    # rewrite in place
//
// Safety: refuses a frozen revision snapshot (<ID>.r<N>.md) — those are
// immutable and read by the running pipeline.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import yaml from "js-yaml";

// Canonical grouping + order. Anything not listed is preserved under OTHER.
const AUTHOR = ["id", "title", "changeType", "platforms", "createdBy", "source", "dependsOn"];
const MANAGED = [
  "status", "complexity", "revision",
  "createdAt", "verifiedAt", "promotedAt", "slaDeadline", "prOpenedAt",
  "prMergedAt", "qaDeployedAt", "canaryStartedAt", "prodRollout100At",
  "landedAt", "landed", "slaHit", "landingTrack",
  "fixIterations", "verifyFixIterations", "maxFixIterations",
  "guardVerdict", "guardCheckedAt", "currentRolloutPercent", "rolledBackAt",
  "bugFollowups",
];
const OPTIONAL = ["perfBudgetPolicy", "rollbackTriggers", "rolloutPlan"];

const emit = (key, val) =>
  yaml.dump({ [key]: val }, { lineWidth: -1, noRefs: true, quotingType: '"' }).replace(/\n+$/, "");

function group(label, keys, fm, seen) {
  const present = keys.filter((k) => k in fm && !seen.has(k));
  if (present.length === 0) return "";
  present.forEach((k) => seen.add(k));
  return `# ── ${label} ──\n` + present.map((k) => emit(k, fm[k])).join("\n") + "\n";
}

// Pure, testable: take full contract markdown → migrated markdown.
export function migrateFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("No YAML frontmatter found");
  // JSON_SCHEMA so ISO timestamps stay verbatim STRINGS — the default
  // schema parses them into Date objects and re-emits "...000Z",
  // silently rewriting every timestamp. We must preserve values exactly.
  const fm = yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) || {};
  const body = m[2];

  if (!("changeType" in fm)) fm.changeType = "feature"; // default; never override

  const seen = new Set();
  let out = "---\n";
  out += group("YOU AUTHOR (edit these)", AUTHOR, fm, seen);
  out += group("MANIFEST MANAGES — don't edit by hand", MANAGED, fm, seen);
  out += group("OPTIONAL (delete blocks you don't need)", OPTIONAL, fm, seen);
  // Anything left is unknown to this tool — preserve it, never drop it.
  const otherKeys = Object.keys(fm).filter((k) => !seen.has(k));
  out += group("OTHER (preserved)", otherKeys, fm, seen);
  out += "---\n" + body;
  return out;
}

function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error("usage: migrate-contract.mjs <contract.md> [--write]");
    process.exit(1);
  }
  if (/\.r\d+\.md$/.test(basename(file))) {
    console.error(`Refusing: ${basename(file)} is a frozen revision snapshot. Migrate the live <ID>.md only.`);
    process.exit(2);
  }
  const migrated = migrateFrontmatter(readFileSync(file, "utf8"));
  if (flags.includes("--write")) {
    writeFileSync(file, migrated);
    console.error(`Migrated ${basename(file)} in place (frontmatter regrouped; values + body unchanged).`);
  } else {
    process.stdout.write(migrated);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
