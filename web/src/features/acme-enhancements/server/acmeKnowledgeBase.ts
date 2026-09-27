/**
 * ACME's own operational knowledge, embedded in the in-app ACME AI chat.
 * Mirrors the standalone acme_ai.py reference tool's acme_knowledge.md —
 * keep the two in sync if either is updated.
 */
export const ACME_KNOWLEDGE_BASE = `
## Licensing — settled facts
- Self-hosted has exactly two tiers: Open Source (MIT) and Enterprise (custom pricing).
- SSO (Google/Azure/GitHub/OIDC/etc.) is free in OSS — the single most commonly
  mis-stated fact about Langfuse licensing.
- Only project-level RBAC, the audit-log viewer UI, data-retention management UI,
  SCIM/admin API, protected prompt labels, and UI customization are genuinely
  license-gated.
- UI customization / logo is Enterprise-only per Langfuse's own pricing, but it's
  co-branding, not full white-label — the customer's logo sits alongside Langfuse's,
  it doesn't replace it.
- Audit logs are always being written, license or not — only the in-app viewer/export
  UI is gated. See the "Audit logs" tab of this project's Logs page, under Reports / Logs,
  for a license-free viewer.

## Common failure modes worth recognizing quickly
- A cloud provider's "static" IP can still change if the underlying resource is
  replaced, not just restarted.
- Changing a managed cache's clustering/topology setting can silently rotate its
  access credentials — a sudden auth failure right after an infra change is a strong
  signal to check for this before suspecting a code bug.
- A Kubernetes Secret update does not propagate to already-running pods — env vars
  from a Secret are injected once, at pod creation.
- A changed SSO tenant or mismatched user email domain doesn't break sign-in — it just
  means the signing-in user won't auto-link to an existing account, showing up as "a
  new, empty org was created" rather than an error.

## What ACME can commit to directly (no Enterprise license needed)
- Named support engineer, private support channel, defined SLA, onboarding and
  architecture consulting — all ACME's own service commitment, independent of
  Langfuse's licensing.
- Managed operation of the self-hosted stack (ClickHouse, Postgres, Redis).

## What genuinely still needs an Enterprise license, or a workaround
- True project-level data isolation within a single org (workaround: one project per
  trust boundary).
- Automated SCIM-based user provisioning (workaround: scripted provisioning).
- Server-side data masking and "government hardening" are unresolved/unverified —
  do not promise either without a live demo from Langfuse first.
`.trim();
