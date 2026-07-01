# Manifest 0.20.0 — Ready Check (release kit)

Everything is written and tested; only the git commit/tag remain (the sandbox
couldn't remove a stale `.git/*.lock`). Run the commands below on your machine.

## Release notes — v0.20.0: Ready Check

**A PM-side readiness gate before dev grooming — "airport security for PRDs."**
A first, cheap check the PM clears *before* engineering estimates, so dev stops
chasing PMs for basics and stops eating the delay when a half-baked PRD moves
mid-sprint.

Highlights:

- **`/ready-check <source>`** (alias `/ready`) — scores a PRD against an 11-item
  Definition of Ready, surfaces PM-fixable blockers in plain language, and mints
  a clean hand-off. Runs in Claude Code and Cowork.
- **Three surfaces, one gate-code algorithm:** the `/ready-check` skill, an
  offline web page, and a **Cowork live artifact** where Claude reviews edge
  cases in-page via `window.cowork.askClaude` — no backend.
- **Tamper-evident gate code**, verified automatically on `/contract pickup`
  ("no code, no grooming"). Dev runs nothing extra.
- **Edge-case checking at the PM side**, with depth scaling from text-only →
  code-context cache → opt-in read-only repo access.
- **Waivers** — proceed without an item by justifying it; the waiver is hashed
  into the code and surfaced for the dev to accept or push back.
- **Practical extras:** dark mode, Do's & Don'ts, professional flat UI, and two
  annotated example PRDs (good + bad).
- **Self-serve panel:** `/ready-check panel` in Cowork creates/opens the live
  artifact on demand (plugins can't ship artifacts, so it's created per user).
- **Docs:** README pipeline table + QUICKSTART now include Ready Check;
  version badge, CHANGELOG, and manifests all at 0.20.0.

Tests: 147 unit + 42 cross-surface parity checks, all green.

## Post-deploy smoke test (the one untested piece: live askClaude)

Everything deterministic is tested. The only thing that can only be verified in
the real Cowork runtime is the live smart check's response handling. Do this
once after deploy:

1. In Cowork, open the **Ready Check** panel (sidebar), or run `/ready-check panel`.
2. Confirm the header pill reads **"Smart check: live"** (not "open in Cowork").
   If it says the latter, the `window.cowork.askClaude` bridge isn't detected —
   tell me.
3. Click **Load complete example → Auto-fill from PRD → Run smart check (Claude)**.
   Expect within a few seconds either a green "no missing edge cases" note, or a
   short list of finding cards (each: title, a `blocker`/`warning` tag, an issue
   line, a `Fix:` line), with the related questions faintly highlighted.
4. Repeat with **Load rough example** → expect several findings.
5. **If the box instead shows raw JSON, `[object Object]`, or "Smart check
   couldn't run…"** — copy whatever text appears in the "Smart review — by
   Claude" box and send it over. That's the raw `askClaude` payload; I'll tune
   the parser in one pass to match its exact shape.

Nothing else needs manual testing — gate scoring, codes, hand-off, verify, and
cross-surface parity are all covered by the automated suites.

## Ship it

```bash
cd <your-manifest-repo>

# 1. Clear the stale locks left by the sandbox
rm -f .git/HEAD.lock .git/index.lock

# 2. Commit (branch: feat/ready-check-pm-gate)
git add -A
git commit -m "Ready Check 0.20.0 — PM-side PRD readiness gate

/ready-check + engine + web page + Cowork live artifact, waivers,
auto-verify on pickup, dark mode, examples. 147 tests green."

# 3. Open a PR to main, review, merge. Then tag the release on main:
git checkout main && git pull
git merge --no-ff feat/ready-check-pm-gate
git tag -a v0.20.0 -m "Manifest 0.20.0 — Ready Check"
git push origin main --tags
```

If you'd rather tag the branch directly instead of merging first, swap step 3
for `git tag -a v0.20.0 -m "..." && git push origin feat/ready-check-pm-gate v0.20.0`.

Note: `docs/manifest-flow.png` and `docs/manifest-launch.png` were already
present (untracked) before this work — include or drop them as you like.

## PR description (paste into the PR)

**Ready Check — PM-side PRD readiness gate (v0.20.0)**

Fixes the `#fast-track-contract` pain: dev repeatedly chasing PMs for basic PRD
details, then getting blamed for the delay. Adds a first, cheap gate the PM
clears before engineering estimates.

What's in it:
- New `/ready-check` skill + command; deterministic engine `scripts/ready-check.mjs`.
- Three surfaces off one rubric and one gate-code algorithm (skill, offline
  web page, Cowork live artifact with in-page Claude review — no backend).
- Content-bound gate code; `/contract pickup` auto-verifies it (VALID/STALE/INVALID).
- Waivers with justification; edge-case critic pass at the PM side; opt-in repo
  read access for deeper checks.
- Dark mode, Do's & Don'ts, good/bad example PRDs.
- `reference/READY-CHECK-RUBRIC.md`; CHANGELOG + version → 0.20.0.

Testing: `node --test` (147) + cross-surface parity harness (42 checks) — all
pass. Gate codes are identical across the web page, the Cowork artifact, and the
Node engine, and every hand-off round-trips to VALID.
