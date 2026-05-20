# Shipline MVP & Demo Plan

The plan for getting from zero to "team sees this and approves the
permissions for full rollout." Three phases, each with explicit
permission requirements, so you can show value before asking for power.

---

## The core insight

You can demo the most compelling part of Shipline — multi-repo
edge-case detection during PRD review — using **only permissions you
already have personally**. No org-level GitHub App. No new service
accounts. No shared secrets.

This works because the demo reads target repos **live from GitHub via
the GitHub MCP** (always current with the default branch — no clone
management). The critics are markdown files invoked by your local
Claude Code / Cowork. The findings stay in files. Nothing is automated
yet — that comes in Phase 2 once you've earned trust.

---

## Phase 0 — The 2-hour MVP (you can do this today)

### What you need

- Your laptop with Claude Code or Cowork installed (your existing
  Claude Code Enterprise / Pro / Team subscription covers the auth
  for interactive use — no separate API key needed)
- The GitHub MCP connected with read access to your team's repos
  (your personal GitHub account is enough; you already have read
  access)

### What you don't need

- Org admin approval
- A GitHub App
- Sentry / Amplitude / JIRA tokens (Phase 0 doesn't need post-launch
  data)
- A Slack bot
- Approval to install workflows in target repos
- Local clones of repos (the regression critic reads via GitHub MCP)
- A separate Anthropic API key (your Claude Code subscription is the
  auth path for interactive use)

### Setup steps

1. **Install the Shipline plugin** in your Claude Code / Cowork.

2. **Confirm the GitHub MCP is connected** in your client's MCP
   settings. Test by running a `search_code` query — if it returns
   results, you're set.

3. **Pick a directory for contracts.** Either:
   - A new throwaway repo just for this demo, or
   - The Pocket folder you already have
   - Doesn't matter — it just needs a `.shipline/contracts/` folder

4. **Create `.shipline/repos.yml`** in the contract directory, copying
   from `shipline/examples/repos.yml.example` and filling in the
   `github: your-org/repo-name` for each of your stacks (Flutter,
   Web, Backend). Skip the `path:` field entirely.

5. **You're done with setup.** Total time: 5 minutes.

### What you can demo right now

Three things, in order of impressiveness:

1. **Author a contract live.** Run `/contract new "<a real feature>"`
   in front of the team. Show the structured intake, the typed
   output, the time-to-draft (~10 minutes).

2. **Run the critics.** Show the 9 critics fanning out, the findings
   landing in a single file with severity flags. Walk through 3-4
   specific findings. Especially the cross-repo regression findings
   — "look, it found that our Flutter `OtpService` doesn't handle
   the rate-limit response that the backend will return."

3. **Show the readiness gate.** Show that the contract status stays
   `not_ready` until the blockers are resolved. Make the point: this
   is *enforced*, not policy.

This is enough to make the case. But there's a better move.

---

## The killer demo move: retrospective comparison

Don't demo on a hypothetical feature. Demo on a feature your team
**already shipped that had bugs in production**.

### How to do it

1. Pick a feature from the last 2-3 months that had at least one P1
   or P2 production bug that surfaced after launch. Bonus if it had
   a postmortem.

2. Find the original PRD (Notion, Confluence, Linear, wherever).

3. Open Claude Code. Run `/contract new` and paste the PRD as the
   input. The intake skill will parse it into the contract format.

4. Run `/contract verify`.

5. **For each production bug that actually happened**, find the
   corresponding finding the critics would have raised. Specifically:
   - Functionality bug → did the edge-cases critic flag the missing
     scenario?
   - "Users didn't know the action succeeded" → did the
     comms-completeness critic flag the missing success state?
   - "Slow on iOS" → did the perf-budget critic flag the absent
     budget?
   - "Conflicted with existing X" → did the regression critic find
     the related code?

6. Build a side-by-side table:

   | Bug (actually happened) | Shipline finding (would have caught) |
   |---|---|
   | OTP timer didn't reset on app background | EC-007: "What happens if app backgrounds during countdown?" — blocker |
   | iOS users saw old layout | PP-003: "B2 doesn't specify iOS UI affordances" — blocker |
   | `payment_method_used` double-counted | INS-005: "Existing `track('otp_requested')` already uses overloaded eventName" — warning |

If even 50-60% of past bugs map to a finding Shipline would have
raised, the case is unstoppable. You're not pitching a future
hypothetical; you're showing prevention of pain everyone remembers.

### What this gets you

- Permission to install workflows in one pilot repo (Phase 1)
- Stakeholder buy-in for the GitHub App permissions later

### What it doesn't get you

- Org-wide rollout. Don't ask yet. One repo, one feature, prove it
  works in CI, then ask.

---

## Phase 1 — The single-repo pilot (1-2 weeks after MVP buy-in)

### What you need to get approved

- Install workflows in **one** target repo (your most permissive one,
  probably one you own)
- One auth secret in that repo for Claude CLI in CI — either:
  - `CLAUDE_CODE_OAUTH_TOKEN` (preferred — ties to your existing
    Claude Code Enterprise subscription, no separate billing line.
    Generate via the Claude Code / Anthropic docs for subscription-
    backed CI auth.)
  - OR `ANTHROPIC_API_KEY` (separate billing on
    console.anthropic.com — only needed if your plan doesn't
    support OAuth-token CI auth)
- A `SLACK_BOT_TOKEN` if you want post-deploy notifications (optional)

That's it. No GitHub App yet — the repo's built-in `GITHUB_TOKEN` is
enough for one-repo flow. The workflows accept both auth modes and
prefer the OAuth token when present.

### What you can do now that you couldn't in Phase 0

- Run `/implement <ID>` from a PR comment — the Implementer agent
  works in CI on a real PR
- `verify-deploy.yml` runs on every QA/preprod deploy
- Slack notifications post when a PR is ready / deploy verified

### What's still missing

- Multi-repo implementation (the agent only writes code in this one
  repo)
- Post-launch reports (no Amplitude/Sentry permissions yet)
- Bug triage (no JIRA permissions yet)

### Demo deliverable from Phase 1

Run one real Small feature through the pipeline. Hit the 24h target.
Document:
- Time saved (hours of human work vs the team's typical baseline)
- Bugs caught at PRD time
- PR review time
- Number of human gates hit

This is your case for Phase 2 — the full org rollout.

---

## Phase 2 — Org rollout (1-2 months after Phase 1 success)

### What you need approved

**The GitHub App** with these permissions org-wide (install on the 3-5
repos in scope, not the whole org):

| Permission | Scope |
|---|---|
| Contents | Read + Write |
| Pull requests | Read + Write |
| Issues | Read + Write |
| Actions | Read |
| Metadata | Read |

**Org-level secrets** for Claude (OAuth token from subscription or
API key), Sentry, Amplitude, Slack, JIRA. Confirm with your Claude
Code account team whether the Enterprise plan supports subscription-
backed CI auth — if yes, skip the separate API key entirely; if no,
the API key becomes a normal secret to provision.

**Slack app** for slash commands (`/shipline new`, `/shipline status`,
`/shipline implement`).

### What you can do now

- Cross-repo Implementer (Flutter + Web + Backend in one promote,
  three linked PRs)
- Launch reports running on cron (day 1/7/14/28)
- Bug Watcher auto-filing to JIRA
- `/shipline` slash commands in Slack

### The pitch for Phase 2

By the time you're asking for Phase 2, you have:
- Phase 0 evidence: bugs caught at PRD time on historical features
- Phase 1 evidence: real cycle time delta, real PR quality delta
- A working system to point at

The conversation becomes "can we expand this to the other repos" —
much easier than "can we install something new."

---

## What to NOT do during MVP/demo

- **Don't propose auto-rollback.** It's a v2 thing. Mentioning it
  triggers a separate (longer) approval conversation.
- **Don't try to demo the launch monitor on real data yet.** You
  don't have telemetry access; demoing on fake data weakens the
  pitch. Save the launch report demo for Phase 2.
- **Don't show all 16 skills in the demo.** Show 3-4: contract-new,
  contract-verify, the regression critic, the readiness gate. Less
  is more.
- **Don't pitch the 24h SLA on day 1.** Pitch "we catch bugs at
  spec time that we currently catch in production." The cycle-time
  claim comes after Phase 1 evidence.

---

## What to ask for, in order

1. **Phase 0 (now):** "Can I have an hour to walk you through what
   I built over the weekend?" — no permissions needed.

2. **Phase 0 follow-up:** "Pick a feature we shipped recently that
   had bugs. Let me run this against its PRD." — no permissions
   needed.

3. **Phase 1:** "Can I install three workflow files in `<your-repo>`
   and add a `CLAUDE_CODE_OAUTH_TOKEN` secret (or `ANTHROPIC_API_KEY`
   if our plan doesn't support OAuth-token CI auth)? Want to run one
   real feature through it." — one repo, one secret.

4. **Phase 1 review:** "Here's the cycle time and PR review delta
   from the pilot. Can we expand to the other repos?" — show data.

5. **Phase 2:** "Install Shipline GitHub App on these 3-5 repos
   with these permissions; add org-level secrets for Sentry,
   Amplitude, Slack, JIRA." — show data, ask big.

Each ask is small and grounded in evidence from the prior phase. The
total permission ask in Phase 2 sounds reasonable because by that
point you have a body of evidence proving it's worth it.

---

## Timeline

| Phase | Wall time | Approval needed | Effort |
|---|---|---|---|
| **0 — MVP** | Today (2h setup + 30min demo) | None (personal use) | You alone |
| **0 — retrospective demo** | This week | None | You + 1 hour with the team |
| **1 — pilot repo** | 2-3 weeks | One repo + one secret | You + workflow install |
| **2 — org rollout** | 6-8 weeks total | GitHub App + multi-service secrets | You + IT/security review |

Don't try to compress this. Each phase earns the next.
