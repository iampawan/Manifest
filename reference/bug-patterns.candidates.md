# Bug-pattern candidates — staging (NOT active)

Patterns proposed by postmortems land here first. **Nothing in this file is
enforced** — the `code-review` critic only reads `BUG-PATTERNS.md`. A human
reviews each candidate and, if it's a real, generalizable, diff-detectable
class of bug, promotes it into `BUG-PATTERNS.md` (see "Accepting a candidate"
in that file). This human-accept gate is deliberate: auto-activating a check
on every PR risks false-positive blockers across the whole team.

Each candidate uses the same entry format as the active catalog, plus two
extra fields the promoter resolves:

- `**Severity**:` — `warning` by default for machine-proposed patterns
  (promote to `blocker` only once it's proven precise).
- `**Status**:` — `provisional` while in this file.

Validate this file's structure any time with:

```
node scripts/validate.mjs --check-patterns reference/BUG-PATTERNS.md reference/bug-patterns.candidates.md
```

---

## Candidates

<!-- Postmortems append candidate entries below this line. Empty for now. -->
