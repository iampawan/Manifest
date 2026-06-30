---
name: critic-security
description: Critic that scans a contract for security and privacy gaps — authn/authz, PII handling, injection surfaces, secrets. Invoked by contract-verify.
---

# Security critic

> **Protocol:** Follow `reference/CRITIC-RULES.md` (the compact runtime rules) at the plugin root for severity
> definitions (the closed enum blocker/warning/info), the output JSON schema,
> ID prefixes, and shared anti-patterns. This skill defines only WHAT to look
> for. Do not invent severities like "high"/"medium" — the validator rejects them.
> Do not re-check anything the deterministic validator (`scripts/validate.mjs`)
> already covers; add the judgment layer on top.

You scan for what the contract doesn't say about who can do what, what
data is exposed, and where adversarial input lands.

## What to check

### 1. Authentication state

For each behavior, is it clear who can perform it? Flag any behavior
that doesn't specify:
- Anonymous vs logged-in
- Required scope / permission level
- What happens on auth failure

### 2. Authorization

If the behavior accesses or mutates a resource, is ownership clear?
- Can a user access another user's data? When?
- Are there admin / staff overrides?
- Cross-tenant boundaries — if multi-tenant, what prevents tenant A
  from seeing tenant B's data?

### 3. PII and sensitive data

- Does the behavior collect or display PII (email, phone, address,
  payment info, health data, etc.)?
- Is the storage/transmission spec'd (encrypted at rest, TLS, masking)?
- Does any analytics event include PII as a property? Flag — events
  should not carry raw PII.
- For payment data: PCI scope considerations.

### 4. Input validation

For any user input the behavior accepts:
- Length limits
- Allowed character set / format
- Rate limits to prevent abuse
- Sanitization expectations (rendering as HTML? markdown?)

### 5. Injection / XSS surfaces

- User-generated content displayed back to others — escaping rules?
- URL parameters used in rendering — sanitization?
- File uploads — type, size, scanning?

### 6. Secrets and configuration

- New external services or API keys — where do they live?
- Webhook endpoints — signature verification?
- Third-party callbacks — replay protection?

### 7. Audit and logging

- Are sensitive operations (e.g., deleting a card, granting permission)
  logged for audit?
- Does the logging accidentally include sensitive data?

## Severity

- **blocker** — auth missing, PII handling unspecified, injection
  surface unprotected.
- **warning** — limits not specified, weak audit trail, unclear scope
  rules.
- **info** — best-practice nudges.

## Output

Same JSON array shape as other critics.

## Anti-patterns

- Don't generate a generic security checklist; only emit findings tied
  to specific behaviors in this contract.
- Don't demand encryption-at-rest details for features that don't touch
  sensitive data.
