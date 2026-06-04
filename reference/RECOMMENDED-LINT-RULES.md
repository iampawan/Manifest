# Recommended lint rules — catch BUG-PATTERNS mechanically

Most of `reference/BUG-PATTERNS.md` is mechanically detectable by
the right linter rules with the right severity. Turning these on
in your repo's own config means the patterns get caught at "save"
time in the editor — not at PR time by a critic, and definitely
not at review time by Cursor.

**The goal**: by the time the implementer pushes, the linter has
already rejected anything in BUG-PATTERNS. Cursor (and the
code-review critic) have less to find. Fewer iterations.

Copy the block below into your repo's lint config. Keep it; the
maintenance cost is near zero, the value is "no more whack-a-mole."

---

## TypeScript / JavaScript (ESLint)

```js
// .eslintrc.cjs (or eslint.config.js with the flat config)
module.exports = {
  // ... your existing config
  rules: {
    // BP-001: no empty catch (catches the empty-catch-with-side-effects shape
    // before the side-effects question even comes up).
    "no-empty": ["error", { "allowEmptyCatch": false }],

    // BP-001 + BP-003: every catch must do something with the error.
    "@typescript-eslint/no-unused-vars": ["error", {
      "args": "all",
      "argsIgnorePattern": "^_",
      "caughtErrors": "all",
      "caughtErrorsIgnorePattern": "^_"
    }],

    // BP-006: effect dependencies must be exhaustive. ERROR, not WARN —
    // warning-level rules get ignored in CI and the bug ships anyway.
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/rules-of-hooks": "error",

    // BP-003: console.log isn't logging. Use the reporter.
    "no-console": ["error", { "allow": ["warn", "error"] }],

    // BP-005-adjacent: floating promises (.then without .catch, async without
    // await) are silent failure paths.
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",

    // Adjacent good hygiene Cursor catches: unchecked indexed access,
    // unsafe `any`, returning `any` from typed functions.
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-return": "error",

    // BP-002-adjacent: forbid `// eslint-disable-next-line` without a reason.
    // Hidden disables are how the deps-exhaustive rule gets defeated.
    "eslint-comments/require-description": ["error", {
      "ignore": []
    }],
  },
}
```

**TypeScript compiler — `tsconfig.json`:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true
  }
}
```

`noUncheckedIndexedAccess` alone catches a huge class of "thing
might be undefined" bugs the implementer wouldn't otherwise type.

**Install requirements:**

```bash
npm i -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  eslint-plugin-react-hooks eslint-plugin-eslint-comments
```

**CI step:**

```yaml
- run: npx tsc --noEmit
- run: npx eslint . --max-warnings 0   # max-warnings 0 is the gate
- run: npm test
```

`--max-warnings 0` is essential. Warning-level rules that don't fail
the build are how patterns leak through.

---

## Flutter / Dart

```yaml
# analysis_options.yaml
include: package:flutter_lints/flutter.yaml

analyzer:
  errors:
    # BP-001 / BP-003: empty catches and unused exception variables.
    empty_catches: error
    unused_catch_clause: error
    # BP-005: state-after-dispose.
    invalid_use_of_protected_member: error

  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true

linter:
  rules:
    # BP-001: catch shouldn't be empty.
    - empty_catches
    - unused_catch_clause
    - unused_catch_stack

    # BP-003: don't swallow errors with `print`.
    - avoid_print

    # BP-005: cancel timers / subscriptions on dispose.
    - cancel_subscriptions
    - close_sinks

    # BP-006-adjacent (Dart): missing await, async returning non-Future.
    - unawaited_futures
    - await_only_futures

    # Adjacent good hygiene.
    - always_declare_return_types
    - prefer_final_locals
    - prefer_typing_uninitialized_variables
}
```

**CI step:**

```yaml
- run: flutter analyze --fatal-warnings --fatal-infos
- run: flutter test
```

`--fatal-warnings --fatal-infos` is the equivalent of ESLint
`--max-warnings 0` — everything blocks.

---

## Go

```yaml
# .golangci.yml
linters:
  enable:
    - errcheck       # BP-001 / BP-003 — unchecked error returns
    - errorlint      # error wrapping correctness
    - gocritic       # adjacent code smells
    - govet
    - ineffassign
    - staticcheck    # broad static checks Cursor would catch
    - unused
    - bodyclose      # BP-003 adjacent — unclosed response bodies leak
    - sqlclosecheck
    - rowserrcheck
    - contextcheck   # BP-005 adjacent — context not propagated
    - nilerr         # BP-003 — returning nil after assigning err
    - nilnil         # both return values nil — usually a bug

linters-settings:
  errcheck:
    # blank-assignment to err is also banned
    check-blank: true
  govet:
    enable-all: true
```

**CI step:**

```yaml
- run: go vet ./...
- run: golangci-lint run --max-issues-per-linter=0 --max-same-issues=0
- run: go test ./...
```

---

## Python

```toml
# pyproject.toml
[tool.ruff]
select = [
  "E",    # pycodestyle errors
  "F",    # pyflakes
  "B",    # bugbear — BP-equivalents
  "S",    # bandit security
  "BLE",  # BP-001 / BP-003 — blind-except (`except:` or `except Exception:` w/o handling)
  "TRY",  # try-except correctness
  "RET",  # return-from-finally and other return surprises
  "SIM",  # simplifications that often hide bugs
  "ASYNC", # async correctness
]
ignore = []

[tool.ruff.per-file-ignores]
"tests/*" = ["S101"]  # asserts allowed in tests

[tool.mypy]
strict = true
warn_unreachable = true
disallow_any_explicit = true
```

**CI step:**

```yaml
- run: ruff check .
- run: mypy .
- run: pytest
```

---

## How this plugs into Manifest

- The implementer's local-run step (`skills/implement/SKILL.md` step 6)
  runs the repo's resolved lint / typecheck / test commands. These
  fail under the strict configs above, which means the empty-catch /
  race / no-op-error patterns get caught at write time.
- `workflows/pr-verify.yml` has an opt-in static-checks block (see
  the commented-out section); the recommendations above are what to
  put inside it.
- The `code-review` critic still scans for the non-mechanical
  variants of BUG-PATTERNS (the linter catches the obvious shape;
  the critic catches the obfuscated shape — e.g., `err && doNothing(err)`
  instead of `catch {}`).

The two layers complement each other: linter is cheap and mechanical;
critic is reasoning-based. Both reference `BUG-PATTERNS.md` so they
stay in sync.

---

## A note on adoption

You don't need to flip every rule on at once. Recommended sequence
when adopting in an existing repo:

1. **First** — turn on the BP-001 / BP-003 rules (`no-empty`,
   `no-floating-promises`, `no-unused-vars` for catches). These
   catch the highest-volume Cursor findings.
2. **Then** — `react-hooks/exhaustive-deps: error` (this one's
   noisy on legacy code; either fix or `// eslint-disable-next-line`
   with a reason per `eslint-comments/require-description`).
3. **Then** — TypeScript strict mode + `noUncheckedIndexedAccess`.
   Migrate file-by-file with `// @ts-strict-ignore` as the
   short-term escape hatch.
4. **Finally** — `--max-warnings 0` in CI to make all the above
   actually blocking.

Repos that adopt all four usually see Cursor findings per PR drop
by ~70% within a few PRs. The remaining 30% are the genuinely
non-mechanical bugs the critic and the human reviewer earn their
keep on.
