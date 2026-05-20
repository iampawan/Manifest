#!/usr/bin/env node
// Shipline deterministic stack detector.
//
// Reads marker files from a repo and reports its framework, languages,
// event SDK, and test framework — deterministically, in code. The
// setup-init wizard uses this so detection is reproducible and depends
// on NO external code-index/navigator MCP. (Same philosophy as
// validate.mjs: mechanical questions get code answers.)
//
// Usage:
//   node detect.mjs <repo-path> [<repo-path> ...]
// Output: JSON array, one object per repo.
//
// For remote repos, fetch the marker files via the GitHub MCP and call
// detectFromFiles({ "package.json": "...", ... }) — the same core logic.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const readSafe = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const ls = (d) => { try { return readdirSync(d); } catch { return []; } };

// ─── Core detection from a map of {filename: content} ────────────────
// Pure-ish: takes the marker-file contents (+ a dir listing for
// extension/dir checks) and returns the detection. Usable for both
// local repos and GitHub-fetched content.

function detectFromFiles(files, listing = []) {
  const pkg = files["package.json"] ? safeJson(files["package.json"]) : null;
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const has = (d) => Object.prototype.hasOwnProperty.call(deps, d);

  let framework = "unknown";
  let languages = [];

  if (pkg) {
    if (has("next")) { framework = "nextjs"; languages = ["typescript", "tsx"]; }
    else if (has("react-native")) { framework = "react-native"; languages = ["typescript"]; }
    else if (has("@angular/core")) { framework = "angular"; languages = ["typescript"]; }
    else if (has("vue")) { framework = "vue"; languages = ["typescript"]; }
    else if (has("svelte")) { framework = "svelte"; languages = ["typescript"]; }
    else if (has("@nestjs/core")) { framework = "nestjs"; languages = ["typescript"]; }
    else if (has("fastify")) { framework = "fastify"; languages = ["typescript"]; }
    else if (has("express")) { framework = "express"; languages = ["typescript"]; }
    else if (has("react")) { framework = "react"; languages = ["typescript", "tsx"]; }
  }

  if (framework === "unknown" && files["pubspec.yaml"]) { framework = "flutter"; languages = ["dart"]; }
  if (framework === "unknown" && (files["Package.swift"] || listing.some((f) => f.endsWith(".xcodeproj"))))
    { framework = "ios-native"; languages = ["swift"]; }
  if (framework === "unknown" && (files["build.gradle"] || files["build.gradle.kts"])) {
    const g = (files["build.gradle"] || files["build.gradle.kts"] || "");
    framework = /spring/i.test(g) ? "spring" : "android-native";
    languages = framework === "spring" ? ["kotlin", "java"] : ["kotlin"];
  }
  if (framework === "unknown" && (files["pyproject.toml"] || files["requirements.txt"])) {
    const t = (files["pyproject.toml"] || "") + (files["requirements.txt"] || "");
    framework = /fastapi/i.test(t) ? "fastapi" : /django/i.test(t) ? "django" : /flask/i.test(t) ? "flask" : "python";
    languages = ["python"];
  }
  if (framework === "unknown" && files["go.mod"]) {
    const m = files["go.mod"];
    framework = /gin-gonic/.test(m) ? "gin" : /labstack\/echo/.test(m) ? "echo" : "go";
    languages = ["go"];
  }
  if (framework === "unknown" && files["Gemfile"] && /rails/.test(files["Gemfile"])) {
    framework = "rails"; languages = ["ruby"];
  }

  // Event SDK — scan deps + pubspec + a couple of source markers
  const blob = Object.keys(deps).join(" ") + " " + (files["pubspec.yaml"] || "");
  let eventSdk = null;
  const backendFw = ["express", "nestjs", "fastify", "fastapi", "django", "flask", "gin", "echo", "go", "rails", "spring"];
  if (/amplitude/i.test(blob)) eventSdk = backendFw.includes(framework) ? "amplitude-node" : "amplitude";
  else if (/firebase[_-]?analytics|FirebaseAnalytics|@react-native-firebase\/analytics/i.test(blob)) eventSdk = "firebase";
  else if (/mixpanel/i.test(blob)) eventSdk = "mixpanel";
  else if (/@segment\/analytics|analytics-node/i.test(blob)) eventSdk = "segment";

  // Test framework
  let testFramework = null, testPattern = null;
  if (has("@playwright/test") || has("playwright")) { testFramework = "playwright"; testPattern = "**/*.spec.ts"; }
  else if (has("cypress")) { testFramework = "cypress"; testPattern = "cypress/e2e/**/*.cy.ts"; }
  else if (has("vitest")) { testFramework = "vitest"; testPattern = "**/*.test.ts"; }
  else if (has("jest")) { testFramework = "jest"; testPattern = "**/*.test.{ts,tsx}"; }
  else if (framework === "flutter" || listing.includes("integration_test")) { testFramework = "flutter_test"; testPattern = "integration_test/**/*_test.dart"; }
  else if (["fastapi", "django", "flask", "python"].includes(framework)) { testFramework = "pytest"; testPattern = "tests/**/*.py"; }
  else if (["go", "gin", "echo"].includes(framework)) { testFramework = "go-testing"; testPattern = "**/*_test.go"; }
  else if (framework === "ios-native") { testFramework = "xctest"; testPattern = "**/*Tests*"; }
  else if (framework === "android-native") { testFramework = "junit-espresso"; testPattern = "**/androidTest/**"; }

  // Confidence: high if a marker file decided it, low if we fell back.
  const confidence = framework === "unknown" ? "low" : (eventSdk ? "high" : "medium");

  return { framework, languages, eventSdk, testFramework, testPattern, confidence };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ─── Local-path wrapper: read the marker files, then detect ──────────

const MARKERS = [
  "package.json", "pubspec.yaml", "Package.swift", "build.gradle",
  "build.gradle.kts", "pyproject.toml", "requirements.txt", "go.mod", "Gemfile",
];

function detectRepo(repoPath) {
  const files = {};
  for (const m of MARKERS) {
    const content = readSafe(join(repoPath, m));
    if (content !== null) files[m] = content;
  }
  const listing = ls(repoPath);
  const det = detectFromFiles(files, listing);
  return { name: basename(repoPath), path: repoPath, ...det };
}

// ─── CLI ─────────────────────────────────────────────────────────────

function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) { console.error("Usage: detect.mjs <repo-path> [...]"); process.exit(2); }
  const results = paths.map((p) => (existsSync(p) ? detectRepo(p) : { path: p, error: "path not found" }));
  console.log(JSON.stringify(results, null, 2));
}

export { detectFromFiles, detectRepo };

if (import.meta.url === `file://${process.argv[1]}`) main();
