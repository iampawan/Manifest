---
name: verify-deploy
description: Manually verify a deployed environment against a contract — runs Playwright tests against a live URL, samples telemetry from Sentry and analytics, posts a canary-readiness verdict. Normally fires automatically via the verify-deploy.yml workflow on deploys, but invoke this for ad-hoc deployment checks.
---

# /verify-deploy <ID> <URL> [--env qa|preprod|prod]

Invokes the **verify-deployment** skill in live-URL mode against the
given contract and environment.

## Usage

```
/verify-deploy AUTH-1234 https://qa.example.com
/verify-deploy AUTH-1234 https://preprod.example.com --env preprod
/verify-deploy AUTH-1234 https://www.example.com --env prod
```

## When to use it manually

The verify-deployment skill normally fires automatically when the
`verify-deploy.yml` workflow detects a successful deploy. Run it
manually when:

- You deployed via a path that doesn't trigger the workflow
  (e.g., direct push to a static host, manual `vercel deploy`).
- You want to re-verify after fixing something post-deploy without
  doing another full deploy.
- You're piloting Shipline before installing the CI workflows.
- A deploy succeeded but the verifier comment didn't show up and
  you want to manually re-run.

## What it does (vs /verify-pr)

`/verify-pr` runs static verification against a PR diff — it checks
whether the code touches the things the contract says it should,
whether ACs have tests mapped, whether instrumentation is wired.
No live execution. Fast.

`/verify-deploy` runs against a *deployed* environment — it actually
hits the URL with Playwright tests, samples Sentry for errors in
the window, samples analytics for event firing. It tells you
whether the deploy *actually works*, not just whether the diff
looks right. Slower (1–5 min).

You typically run `/verify-pr` during code review and
`/verify-deploy` after deploy.

## Output

`.shipline/contracts/<ID>.deploy-<env>-<timestamp>.md` with:
- Per-AC pass/fail
- Event firing summary (which events fired, at what rate)
- Error rate vs budget
- A verdict: `ready-for-canary | hold | rollback`

Plus a comment posted on the contract's tracking issue and a Slack
ping.

## Anti-patterns

- Don't run this against prod before canary completes — you'll
  measure a partial population. Wait until rollout is at 100% (or
  use `--env prod-canary` if you've stamped the canary tag).
- Don't run this immediately after deploy — wait at least 60s for
  the deploy to start receiving traffic so the telemetry sample is
  meaningful.
