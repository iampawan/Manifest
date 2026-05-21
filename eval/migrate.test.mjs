// Unit tests for the deterministic contract migrator (scripts/migrate-contract.mjs).
// It must regroup frontmatter WITHOUT losing or changing any value.

import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "../scripts/node_modules/js-yaml/dist/js-yaml.mjs";

import { migrateFrontmatter } from "../scripts/migrate-contract.mjs";

const OLD = `---
id: SC-9
title: Old-style contract
status: promoted
complexity: small
platforms: [web]
createdBy: pawan@example.com
revision: 3
createdAt: 2026-05-01T00:00:00Z
promotedAt: 2026-05-02T00:00:00Z
landed: partial
bugFollowups: [{ ticket: BUG-1, route: fix, status: open }]
confidenceScore: 0.7
source: https://jira/PROD-1
rollbackTriggers:
  crashFreeFloor: 99.0
---

## Goal

Keep this body EXACTLY as-is.

### B1. x
- platforms: [web]
`;

test("migrate: body is preserved byte-for-byte", () => {
  const out = migrateFrontmatter(OLD);
  const body = out.split(/\n---\n/).slice(1).join("\n---\n");
  assert.ok(body.includes("## Goal\n\nKeep this body EXACTLY as-is."));
  assert.ok(body.includes("### B1. x\n- platforms: [web]"));
});

test("migrate: every original field survives with its value", () => {
  const out = migrateFrontmatter(OLD);
  const fm = yaml.load(out.match(/^---\n([\s\S]*?)\n---\n/)[1], { schema: yaml.JSON_SCHEMA });
  assert.equal(fm.id, "SC-9");
  assert.equal(fm.status, "promoted");      // managed state preserved
  assert.equal(fm.revision, 3);
  assert.equal(fm.landed, "partial");
  assert.equal(fm.promotedAt, "2026-05-02T00:00:00Z");
  assert.equal(fm.confidenceScore, 0.7);    // unknown key preserved (OTHER)
  assert.equal(fm.source, "https://jira/PROD-1");
  assert.equal(fm.rollbackTriggers.crashFreeFloor, 99.0);
  assert.equal(fm.bugFollowups[0].ticket, "BUG-1");
});

test("migrate: adds changeType=feature when absent, doesn't override", () => {
  const out = migrateFrontmatter(OLD);
  assert.equal(yaml.load(out.match(/^---\n([\s\S]*?)\n---\n/)[1], { schema: yaml.JSON_SCHEMA }).changeType, "feature");

  const withBug = OLD.replace("id: SC-9", "id: SC-9\nchangeType: bug-fix");
  const out2 = migrateFrontmatter(withBug);
  assert.equal(yaml.load(out2.match(/^---\n([\s\S]*?)\n---\n/)[1]).changeType, "bug-fix");
});

test("migrate: emits the labelled group dividers", () => {
  const out = migrateFrontmatter(OLD);
  assert.ok(out.includes("# ── YOU AUTHOR (edit these) ──"));
  assert.ok(out.includes("# ── MANIFEST MANAGES"));
  assert.ok(out.includes("# ── OTHER (preserved) ──")); // confidenceScore lands here
});

test("migrate: is idempotent (running twice changes nothing further)", () => {
  const once = migrateFrontmatter(OLD);
  const twice = migrateFrontmatter(once);
  assert.equal(twice, once);
});

test("migrate: output still parses as a valid contract", () => {
  const out = migrateFrontmatter(OLD);
  const fm = yaml.load(out.match(/^---\n([\s\S]*?)\n---\n/)[1], { schema: yaml.JSON_SCHEMA });
  assert.ok(fm.id && fm.changeType && Array.isArray(fm.platforms));
});
