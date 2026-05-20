// Unit tests for the deterministic stack detector.
// Run with: node --test eval/detect.test.mjs
//
// Uses synthetic marker-file maps so the tests are hermetic — no real
// repos needed. detectFromFiles is the pure core both the CLI and the
// GitHub-fetch path use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFromFiles } from "../scripts/detect.mjs";

test("detects Next.js from package.json", () => {
  const d = detectFromFiles({ "package.json": JSON.stringify({ dependencies: { next: "14", react: "18" } }) });
  assert.equal(d.framework, "nextjs");
  assert.ok(d.languages.includes("typescript"));
});

test("detects plain React", () => {
  const d = detectFromFiles({ "package.json": JSON.stringify({ dependencies: { react: "18" }, devDependencies: { vite: "5" } }) });
  assert.equal(d.framework, "react");
});

test("detects Flutter from pubspec.yaml", () => {
  const d = detectFromFiles({ "pubspec.yaml": "name: app\ndependencies:\n  firebase_analytics: ^10" });
  assert.equal(d.framework, "flutter");
  assert.equal(d.eventSdk, "firebase");
  assert.equal(d.testFramework, "flutter_test");
});

test("detects native iOS from .xcodeproj listing", () => {
  const d = detectFromFiles({}, ["MyApp.xcodeproj", "MyApp"]);
  assert.equal(d.framework, "ios-native");
  assert.equal(d.languages[0], "swift");
});

test("detects native iOS from Package.swift", () => {
  const d = detectFromFiles({ "Package.swift": "// swift-tools-version:5.9" });
  assert.equal(d.framework, "ios-native");
});

test("detects native Android from build.gradle (not spring)", () => {
  const d = detectFromFiles({ "build.gradle": "android {\n  compileSdk 34\n}" });
  assert.equal(d.framework, "android-native");
  assert.equal(d.languages[0], "kotlin");
});

test("detects Spring from build.gradle with spring-boot", () => {
  const d = detectFromFiles({ "build.gradle": "plugins { id 'org.springframework.boot' }" });
  assert.equal(d.framework, "spring");
});

test("detects FastAPI from requirements.txt", () => {
  const d = detectFromFiles({ "requirements.txt": "fastapi==0.110\nuvicorn" });
  assert.equal(d.framework, "fastapi");
  assert.equal(d.testFramework, "pytest");
});

test("detects Django", () => {
  const d = detectFromFiles({ "requirements.txt": "Django==5.0" });
  assert.equal(d.framework, "django");
});

test("detects Go + gin", () => {
  const d = detectFromFiles({ "go.mod": "module x\nrequire github.com/gin-gonic/gin v1.9" });
  assert.equal(d.framework, "gin");
  assert.equal(d.testFramework, "go-testing");
});

test("detects plain Go", () => {
  const d = detectFromFiles({ "go.mod": "module x\ngo 1.22" });
  assert.equal(d.framework, "go");
});

test("backend amplitude resolves to amplitude-node", () => {
  const d = detectFromFiles({ "package.json": JSON.stringify({ dependencies: { express: "4", "@amplitude/analytics-node": "1" } }) });
  assert.equal(d.framework, "express");
  assert.equal(d.eventSdk, "amplitude-node");
});

test("web amplitude resolves to amplitude", () => {
  const d = detectFromFiles({ "package.json": JSON.stringify({ dependencies: { next: "14", "@amplitude/analytics-browser": "2" } }) });
  assert.equal(d.eventSdk, "amplitude");
});

test("detects mixpanel", () => {
  const d = detectFromFiles({ "package.json": JSON.stringify({ dependencies: { next: "14", "mixpanel-browser": "2" } }) });
  assert.equal(d.eventSdk, "mixpanel");
});

test("unknown stack is flagged low-confidence, not guessed", () => {
  const d = detectFromFiles({ "README.md": "hello" });
  assert.equal(d.framework, "unknown");
  assert.equal(d.confidence, "low");
});

test("no event SDK leaves eventSdk null (wizard will ask)", () => {
  const d = detectFromFiles({ "package.json": JSON.stringify({ dependencies: { next: "14" } }) });
  assert.equal(d.eventSdk, null);
});
