// Unit tests for auditDocument — the design-readiness heuristics.
// Run: node tools/figma-rest-mcp/audit.test.mjs
import { auditDocument } from "./index.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗", m); } };

const frame = (name, w, h, kids = []) => ({ type: "FRAME", name, absoluteBoundingBox: { width: w, height: h }, children: kids });
const text = (chars) => ({ type: "TEXT", characters: chars });
const page = (name, kids) => ({ type: "CANVAS", name, children: kids });
const file = (pages, extra = {}) => ({ name: "T", version: "1", document: { type: "DOCUMENT", children: pages }, ...extra });

// 1. Platform inference by width
{
  const a = auditDocument(file([page("P", [frame("Home Desktop", 1440, 900), frame("Home Mobile", 390, 844), frame("Tab", 768, 1024)])]));
  ok(a.platforms.desktop === 1, "desktop count");
  ok(a.platforms.mobile === 1, "mobile count");
  ok(a.platforms.tablet === 1, "tablet count");
  ok(a.screenCount === 3, "screen count");
}

// 2. Web-only → flags missing mobile
{
  const a = auditDocument(file([page("Web", [frame("Home", 1440, 900), frame("Detail", 1440, 900)])]));
  ok(a.platforms.mobile === 0, "no mobile");
  ok(a.findings.some((f) => f.area === "scope"), "flags missing mobile as scope finding");
}

// 3. State screens detected by name
{
  const a = auditDocument(file([page("P", [frame("Checkout Error", 390, 844), frame("Checkout Empty", 390, 844), frame("Checkout Loading", 390, 844), frame("Checkout Success", 390, 844)])]));
  ok(a.states.error && a.states.empty && a.states.loading && a.states.success, "all states detected");
  ok(!a.findings.some((f) => f.area === "states"), "no missing-state findings when all present");
}

// 4. Missing states flagged
{
  const a = auditDocument(file([page("P", [frame("Checkout", 390, 844)])]));
  ok(!a.states.error && !a.states.empty && !a.states.loading, "states absent");
  ok(a.findings.filter((f) => f.area === "states").length >= 3, "flags each missing state");
}

// 5. Placeholder copy detected
{
  const a = auditDocument(file([page("P", [frame("Home", 390, 844, [text("Lorem ipsum dolor sit amet"), text("Real heading")])])]));
  ok(a.placeholders.length === 1, "one placeholder hit");
  ok(a.findings.some((f) => f.area === "design" && f.severity === "blocker"), "placeholder is a blocker finding");
}

// 6. Clean, complete file → no findings
{
  const a = auditDocument(file([
    page("Mobile", [frame("Home Error", 390, 844), frame("Home Empty", 390, 844), frame("Home Loading", 390, 844, [text("Final copy")])]),
  ]));
  ok(a.findings.length === 0, "no findings for a complete mobile design");
}

// 7. Empty / malformed input doesn't throw
{
  ok(auditDocument({}).screenCount === 0, "empty file → 0 screens");
  ok(auditDocument().screenCount === 0, "undefined file → 0 screens");
}

console.log(`\naudit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
