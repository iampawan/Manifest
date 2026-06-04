#!/usr/bin/env node
// Manifest code-context cache builder.
//
// Builds the precomputed answer-source for critic-code-context, which feeds
// Bucket A (auto-fill from code/history) and Bucket B (dev decides) in the
// pickup flow. Without this cache, the first pickup on a repo has to run all
// the scans live (~30s); with it, lookups are sub-second.
//
// What goes in the cache:
//   - events.catalog       — analytics event names + payload shapes
//   - events.naming        — detected casing/verb-noun convention
//   - i18n                 — all known translation keys (en/default locale)
//   - stack_defaults       — perf budgets + required comms states by platform
//   - similar_contracts    — index of past contracts by surface area
//   - surface_index        — surface → file paths it touches
//   - dependencies         — flags, shared modules, endpoint budgets
//   - history              — rolled-back / partial contracts with file culprits
//
// Usage:
//   node build-code-context.mjs                  # uses .manifest/repos.yml
//   node build-code-context.mjs --repos <path>   # custom repos.yml
//   node build-code-context.mjs --out <dir>      # custom output dir
//   node build-code-context.mjs --dry-run        # print summary, don't write
//   node build-code-context.mjs --verbose        # log each scan step
//
// Output: .manifest/.cache/code-context.json (rebuilt atomically)
// Exit: 0 success, 1 config error, 2 scan error.
//
// Designed to run nightly (cron / GitHub Actions) AND on-demand when
// critic-code-context detects the cache is stale or missing.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, extname, basename } from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- CLI ----------

function parseArgs(argv) {
  const args = {
    repos: ".manifest/repos.yml",
    out: ".manifest/.cache",
    dryRun: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repos") args.repos = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  console.log(
    "Usage: node build-code-context.mjs [--repos <path>] [--out <dir>] [--dry-run] [--verbose]"
  );
}

function log(args, ...msgs) {
  if (args.verbose) console.error(...msgs);
}

// ---------- config ----------

function loadRepos(reposPath) {
  if (!existsSync(reposPath)) {
    throw new Error(
      `repos.yml not found at ${reposPath} — run from a directory with .manifest/repos.yml, or pass --repos <path>`
    );
  }
  const raw = readFileSync(reposPath, "utf8");
  const cfg = yaml.load(raw) || {};
  if (!Array.isArray(cfg.repos)) {
    throw new Error(`repos.yml must contain a top-level 'repos:' array`);
  }
  return cfg;
}

// ---------- helpers ----------

function walkDir(dir, fileFilter, maxFiles = 50000, skipDirs = new Set([
  "node_modules", ".git", "build", "dist", ".next", ".turbo", "coverage",
  ".cache", "out", "target", ".gradle", "Pods", "DerivedData",
])) {
  const out = [];
  function recur(d) {
    if (out.length >= maxFiles) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".") && e.name !== ".manifest") {
        // skip hidden dirs except .manifest
        if (e.isDirectory()) continue;
      }
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        recur(full);
      } else if (e.isFile() && fileFilter(full, e.name)) {
        out.push(full);
      }
    }
  }
  recur(dir);
  return out;
}

function safeRead(p) {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}

// ---------- 1. events catalog ----------
//
// Look for files that look like an event catalog. Heuristics:
//   - filename matches /events?\.(t|j)sx?$/ or /analytics.*\.(t|j)sx?$/
//   - file under a path containing /analytics/ or /events/
//
// Extract names with regex against common patterns. This is best-effort —
// the goal is to surface candidate names so the critic can propose them;
// the dev verifies before accepting.

function scanEvents(repoRoot, args) {
  const candidates = walkDir(repoRoot, (full, name) => {
    if (!/\.(tsx?|jsx?|dart|py|kt|swift)$/.test(name)) return false;
    if (/events?\.(tsx?|jsx?|dart|py|kt|swift)$/i.test(name)) return true;
    if (/analytics.*\.(tsx?|jsx?|dart|py|kt|swift)$/i.test(name)) return true;
    const p = full.toLowerCase();
    return p.includes("/analytics/") || p.includes("/events/") || p.includes("/tracking/");
  });

  const catalog = [];
  // patterns that often define event names:
  //   "filter_applied"
  //   filter_applied:
  //   FILTER_APPLIED =
  //   AnalyticsEvent.filterApplied
  //   trackEvent('filter_applied'
  const patterns = [
    /['"]([a-z][a-z0-9_]{2,60})['"]\s*[:,]/gi,        // string keys
    /\b([A-Z][A-Z0-9_]{2,60})\s*=/g,                  // SCREAMING_SNAKE constants
    /trackEvent\(['"]([a-z][a-z0-9_]{2,60})['"]/gi,   // tracker calls
    /logEvent\(['"]([a-z][a-z0-9_]{2,60})['"]/gi,     // firebase-style
    /\.track\(['"]([a-z][a-z0-9_]{2,60})['"]/gi,      // amplitude-style
  ];

  for (const file of candidates) {
    const src = safeRead(file);
    if (!src) continue;
    for (const pat of patterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(src))) {
        const name = m[1];
        // skip obvious non-events
        if (/^(true|false|null|undefined|return|const|let|var|type|interface|import|from|of|in|if|else|class)$/i.test(name)) continue;
        if (name.length < 4 || name.length > 60) continue;
        catalog.push({
          name,
          file: relative(repoRoot, file),
          line: src.slice(0, m.index).split("\n").length,
        });
      }
    }
  }

  // dedupe by name, keep the first sighting
  const seen = new Set();
  const deduped = [];
  for (const e of catalog) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    deduped.push(e);
  }
  log(args, `  events: ${deduped.length} candidates from ${candidates.length} files`);

  // detect naming convention
  const snake = deduped.filter((e) => /^[a-z][a-z0-9_]*$/.test(e.name)).length;
  const camel = deduped.filter((e) => /^[a-z][a-zA-Z0-9]*$/.test(e.name)).length;
  const screaming = deduped.filter((e) => /^[A-Z][A-Z0-9_]*$/.test(e.name)).length;
  let convention = "unknown";
  if (snake >= camel && snake >= screaming) convention = "snake_case";
  else if (camel > snake) convention = "camelCase";
  else if (screaming > snake) convention = "SCREAMING_SNAKE";

  return {
    catalog: deduped.slice(0, 500),  // cap to keep cache small
    naming_patterns: {
      convention,
      examples: deduped.slice(0, 8).map((e) => e.name),
    },
  };
}

// ---------- 2. i18n keys ----------
//
// Look for translation files: i18n/*.json, locales/*.json, strings.xml,
// Localizable.strings, ARB files. Default locale is the one most often
// labeled en/default. Extract key paths.

function scanI18n(repoRoot, args) {
  const candidates = walkDir(repoRoot, (full, name) => {
    const p = full.toLowerCase();
    if (!(p.includes("/i18n/") || p.includes("/locales/") || p.includes("/strings/") || p.includes("/l10n/"))) {
      return /^(en|default|en[_-]US)\.(json|arb|yaml|yml)$/i.test(name);
    }
    return /\.(json|arb|yaml|yml|xml|strings)$/i.test(name);
  });

  const keys = [];

  function flatten(obj, prefix, file) {
    if (obj == null) return;
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        flatten(v, path, file);
      } else if (typeof v === "string") {
        keys.push({ key: path, file: relative(repoRoot, file), value: v.length > 120 ? v.slice(0, 117) + "..." : v });
      }
    }
  }

  for (const file of candidates) {
    const src = safeRead(file);
    if (!src) continue;
    if (file.endsWith(".json") || file.endsWith(".arb")) {
      try { flatten(JSON.parse(src), "", file); } catch { /* skip malformed */ }
    } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      try { flatten(yaml.load(src), "", file); } catch { /* skip */ }
    } else if (file.endsWith(".strings")) {
      // Apple .strings: "key" = "value";
      const re = /"([^"]+)"\s*=\s*"([^"]*)"/g;
      let m;
      while ((m = re.exec(src))) keys.push({ key: m[1], file: relative(repoRoot, file), value: m[2] });
    } else if (file.endsWith(".xml")) {
      // Android strings.xml: <string name="foo">value</string>
      const re = /<string\s+name="([^"]+)"[^>]*>([^<]*)<\/string>/g;
      let m;
      while ((m = re.exec(src))) keys.push({ key: m[1], file: relative(repoRoot, file), value: m[2] });
    }
  }

  // dedupe by key, keep first sighting
  const seen = new Set();
  const deduped = [];
  for (const k of keys) {
    if (seen.has(k.key)) continue;
    seen.add(k.key);
    deduped.push(k);
  }
  log(args, `  i18n: ${deduped.length} keys from ${candidates.length} files`);
  return deduped.slice(0, 2000);
}

// ---------- 3. stack defaults ----------
//
// From the plugin's STACK-PROFILES.md (already shipped). We don't re-parse;
// we record the platforms in scope so the critic can pick the right defaults
// at lookup time.

function scanStackDefaults(repoConfig) {
  return {
    platforms: Array.from(new Set(repoConfig.repos.flatMap((r) => r.platforms || []))),
    perf_budget_ms_hint: {
      web: 50,
      flutter: 80,
      ios: 80,
      android: 80,
      server: 200,
    },
    comms_states_required_hint: ["idle", "loading", "success", "error", "empty"],
    note: "Authoritative source is reference/STACK-PROFILES.md — these are pre-resolved hints.",
  };
}

// ---------- 4. similar contracts + history ----------
//
// Read .manifest/contracts/ and .manifest/archive/ for past contracts.
// Extract: id, surface area (from frontmatter or filename), landed verdict,
// behaviors list. The critic uses this to propose ACs adapted from similar
// landed contracts and to surface rolled-back lessons.

function scanContracts(manifestRoot, args) {
  const out = { similar: [], history: [], by_surface: {} };

  function collect(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      // skip sidecars and revisions
      if (/\.(findings|qa|implementation-plan|launch-report-day\d+|deploy-qa|guard|bug-log|postmortem|pr-review|r\d+)\.md$/.test(entry.name)) continue;
      const src = safeRead(full);
      if (!src) continue;
      const fm = parseFrontmatter(src);
      if (!fm) continue;
      const id = fm.contractId || basename(entry.name, ".md");
      const surface = fm.surface || fm.feature || guessSurfaceFromBody(src);
      const landed = fm.landed || (full.includes("/archive/") ? "landed" : null);
      const behaviors = (fm.behaviors || []).map((b) => ({
        id: b.id || b.code,
        title: b.title || b.name,
      })).filter((b) => b.id);

      const rec = {
        id,
        path: relative(manifestRoot, full),
        surface,
        landed,
        title: fm.title,
        behaviors,
      };
      out.similar.push(rec);
      if (surface) {
        out.by_surface[surface] = out.by_surface[surface] || [];
        out.by_surface[surface].push(id);
      }
      if (landed === "rolled-back" || landed === "partial") {
        out.history.push({
          id,
          landed,
          reason: fm.rollbackReason || fm.postmortem?.cause || "see postmortem",
          path: relative(manifestRoot, full),
        });
      }
    }
  }

  collect(join(manifestRoot, "contracts"));
  collect(join(manifestRoot, "archive"));
  log(args, `  contracts: ${out.similar.length} indexed, ${out.history.length} rolled-back/partial`);
  return out;
}

function guessSurfaceFromBody(src) {
  // pull the first heading after "Goal" as a best-effort surface name
  const m = src.match(/^#\s+(.+)$/m);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") : null;
}

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try { return yaml.load(m[1]); } catch { return null; }
}

// ---------- 5. surface index + dependencies ----------
//
// For each repo, scan for feature-flag references and known shared modules.
// This is lighter than a full dependency graph — just enough to flag
// touchpoints.

function scanDependencies(repoRoot, args) {
  const flags = new Set();
  const sharedModules = new Set();

  const files = walkDir(repoRoot, (full, name) => /\.(tsx?|jsx?|dart|py|kt|swift)$/.test(name));

  const flagPatterns = [
    /featureFlag\.([a-zA-Z0-9_]+)/g,
    /useFlag\(['"]([a-zA-Z0-9_.]+)['"]/g,
    /experiments?\.([a-zA-Z0-9_]+)/g,
    /flags?\.([a-zA-Z0-9_]+)/gi,
    /GrowthBook\.[a-z]+\(['"]([a-zA-Z0-9_-]+)['"]/g,
    /LaunchDarkly[^(]*\(['"]([a-zA-Z0-9_-]+)['"]/g,
  ];

  for (const file of files.slice(0, 5000)) {
    const src = safeRead(file);
    if (!src) continue;
    for (const pat of flagPatterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(src))) {
        const name = m[1];
        if (name && name.length >= 3 && name.length <= 60) flags.add(name);
      }
    }
    // shared modules: look for imports from common shared paths
    const importRe = /(?:from|import)\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(src))) {
      const path = m[1];
      if (/(?:shared|common|lib)\//i.test(path)) sharedModules.add(path);
    }
  }

  log(args, `  deps: ${flags.size} flags, ${sharedModules.size} shared modules`);
  return {
    flags: Array.from(flags).sort().slice(0, 500),
    shared_modules: Array.from(sharedModules).sort().slice(0, 500),
  };
}

// ---------- main ----------

function build(args) {
  const reposCfg = loadRepos(args.repos);
  const manifestRoot = dirname(resolve(args.repos)); // .manifest/
  const cache = {
    version: 1,
    builtAt: new Date().toISOString(),
    builtBy: "scripts/build-code-context.mjs",
    repos: reposCfg.repos.map((r) => ({ name: r.name, github: r.github, platforms: r.platforms })),
    events: { catalog: [], naming_patterns: { convention: "unknown", examples: [] } },
    i18n: [],
    stack_defaults: scanStackDefaults(reposCfg),
    similar_contracts: [],
    by_surface: {},
    history: [],
    dependencies: { flags: [], shared_modules: [] },
  };

  // Per-repo scans (events, i18n, deps) — uses local `path` if present;
  // GitHub-only repos are skipped with a note (a future patch can pull
  // via the GitHub MCP — out of scope for the local builder).
  for (const repo of reposCfg.repos) {
    if (!repo.path) {
      log(args, `[${repo.name}] no local path — skipping (GitHub-only scans not yet supported by builder)`);
      continue;
    }
    const root = resolve(repo.path.replace(/^~/, process.env.HOME || ""));
    if (!existsSync(root)) {
      log(args, `[${repo.name}] path ${root} not found — skipping`);
      continue;
    }
    log(args, `[${repo.name}] scanning ${root}`);
    const ev = scanEvents(root, args);
    cache.events.catalog.push(...ev.catalog.map((e) => ({ ...e, repo: repo.name })));
    // last repo wins for naming convention (cheap heuristic)
    if (ev.naming_patterns.convention !== "unknown") {
      cache.events.naming_patterns = ev.naming_patterns;
    }
    const i18n = scanI18n(root, args);
    cache.i18n.push(...i18n.map((k) => ({ ...k, repo: repo.name })));
    const deps = scanDependencies(root, args);
    cache.dependencies.flags.push(...deps.flags);
    cache.dependencies.shared_modules.push(...deps.shared_modules);
  }
  cache.dependencies.flags = Array.from(new Set(cache.dependencies.flags)).sort();
  cache.dependencies.shared_modules = Array.from(new Set(cache.dependencies.shared_modules)).sort();

  // Contract index — always runs from the manifest root regardless of repos
  log(args, `contracts: scanning ${manifestRoot}`);
  const c = scanContracts(manifestRoot, args);
  cache.similar_contracts = c.similar;
  cache.by_surface = c.by_surface;
  cache.history = c.history;

  // Cache hash for staleness checks
  const body = JSON.stringify(cache);
  cache.cacheHash = createHash("sha256").update(body).digest("hex").slice(0, 16);

  if (args.dryRun) {
    console.log(JSON.stringify({
      summary: {
        events: cache.events.catalog.length,
        i18n: cache.i18n.length,
        similar_contracts: cache.similar_contracts.length,
        history_entries: cache.history.length,
        flags: cache.dependencies.flags.length,
        shared_modules: cache.dependencies.shared_modules.length,
        cacheHash: cache.cacheHash,
      },
    }, null, 2));
    return 0;
  }

  // Atomic write — write to .tmp then rename so a concurrent reader never
  // sees a half-written cache.
  if (!existsSync(args.out)) mkdirSync(args.out, { recursive: true });
  const outPath = join(args.out, "code-context.json");
  const tmpPath = outPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(cache, null, 2));
  renameSync(tmpPath, outPath);

  log(args, `wrote ${outPath} (hash ${cache.cacheHash})`);
  console.log(JSON.stringify({
    ok: true,
    outPath,
    cacheHash: cache.cacheHash,
    summary: {
      events: cache.events.catalog.length,
      i18n: cache.i18n.length,
      similar_contracts: cache.similar_contracts.length,
      history_entries: cache.history.length,
      flags: cache.dependencies.flags.length,
      shared_modules: cache.dependencies.shared_modules.length,
    },
  }, null, 2));
  return 0;
}

// Entry
if (process.argv[1] === __filename || process.argv[1].endsWith("build-code-context.mjs")) {
  const args = parseArgs(process.argv.slice(2));
  try {
    process.exit(build(args));
  } catch (err) {
    console.error(`build-code-context: ${err.message}`);
    if (args.verbose && err.stack) console.error(err.stack);
    process.exit(err.code === "ENOENT" ? 1 : 2);
  }
}

export { build, scanEvents, scanI18n, scanContracts, scanDependencies };
