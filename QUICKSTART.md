# Start here

Manifest is a helper for Claude Code (and Cowork) that turns a rough idea or a
bug into well-checked, shippable work — without you having to remember any
process. You say what you want in plain words; it asks the right questions,
catches the gaps people usually miss, and helps get it built.

You don't need to learn the whole thing. Install it, try one command, and stop
there. Everything else can wait until you actually want it.

## 1. Install it

In Claude Code or Cowork, paste these two lines:

```
/plugin marketplace add https://github.com/iampawan/Manifest
/plugin install manifest@manifest
```

That's the setup. No account, no config files to get started.

## 2. Say hello

```
/manifest
```

It introduces itself, checks your setup, and points you to the first thing worth
trying. If anything's missing, it tells you in plain language.

## 3. Do one real thing

Pick whichever matches what you have right now — describe it like you'd tell a
teammate:

**Fix a small bug:**

```
/fix the Save button stays clickable when the form is empty
```

It works out the cause, writes the fix and a test, and opens a pull request.

**Or shape a new feature:**

```
/contract pickup let people export their data as a CSV
```

It drafts a short spec, then quietly checks it for the things that bite later —
missing edge cases, unclear states, security gaps — and shows you what to tighten
*before* any code is written.

**Or, if you're a PM, check a PRD is ready before handing it to dev:**

```
/ready-check <a JIRA / Notion / Doc / Slack / Figma link, or "a description">
```

It asks a few plain questions (the Definition of Ready), flags the edge cases
you're missing, and — when it's ready — gives you a clean hand-off with a gate
code to drop in the ticket. No jargon. (Also available as a web page and a live
Cowork panel — see `gate/README.md`.)

That's it. You've used Manifest.

## What just happened

It met you where you were — a bug or an idea — and did the easy-to-forget parts
for you: asking the right questions, catching gaps, and writing things down so
nothing slips. Its notes live as plain files inside your project. Nothing to log
into, nothing to maintain.

## When you want more (no rush)

Only reach for these when you feel like it:

- `/status` — what's in flight and what's next.
- `/implement <id>` — have it build a spec you've shaped.
- [GUIDE.md](GUIDE.md) — the full picture, the day you want it.

One command is enough to start. Grow into the rest whenever.

---

*If it ever asks to connect GitHub, that just lets it read your code so its
checks are sharper — say yes when you're ready, or skip it for now. Either way
works.*
