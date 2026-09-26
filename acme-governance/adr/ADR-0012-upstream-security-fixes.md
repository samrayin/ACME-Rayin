# ADR-0012: Adopting upstream Langfuse security fixes ahead of a full version sync

| | |
|---|---|
| **Change ID** | CHG-2026-076 · Tier 1 (authentication) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The next console release after merge (`acme-v4.38.0.N`) |
| **Status** | Proposed: awaiting the owner's review |
| **Type** | Forward |
| **Date** | 2026-09-26 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner reviews and merges; no self-approval (N-47/N-48) |
| **Commits / tag** | Upstream `24c949d8` and `e6d58f6d`, cherry-picked unchanged with `-x` · tag at release |

## 1. Purpose

CAIRO is on Langfuse v4.38.0. Upstream has since shipped two authentication fixes that
matter to a governed platform. Neither came with a security advisory.

- **API-key revocation** (langfuse/langfuse#17651, released in v4.40.0). The API-key cache
  was evicted *before* the database row was deleted, and cache reads refreshed the entry's
  TTL. A request racing a deletion could re-cache a key that was being revoked, and a key in
  regular use kept extending its cache life. So a revoked key could keep authenticating for
  longer than intended. The fix evicts after the delete, reads without refreshing, and
  lowers the default TTL from 300 s to 60 s. CAIRO's credential rotation depends on
  revocation taking effect quickly.
- **SCIM organization scoping** (langfuse/langfuse#17828, released in v4.43.0).
  `GET /api/public/scim/Users/{id}` checked that the user belongs to the caller's
  organization, but `PUT` and `DELETE` didn't. The fix applies the same check to all three,
  with a carve-out for provisioning a user who isn't a member yet (`active: true`).

## 2. Scope

**In:** the two upstream commits, cherry-picked unchanged, including upstream's tests (the
updated API-auth tests and 5 new cross-organization SCIM tests).

**Out:** any other upstream change; the full version sync (register GOV-10); any change to
ACME code.

## 3. Decision

Cherry-pick both fixes now, unchanged, rather than waiting for the next full upstream sync.

- *Rejected: wait for a full sync to v4.46.* That is 12 releases and about 229 commits. It's
  the right regular cadence, but it shouldn't hold back two authentication fixes.
- *Rejected: re-implement them in ACME code.* An unchanged cherry-pick is easier to review,
  keeps upstream's tests, and is recognised as already applied at the next sync.

**SCIM in CAIRO today.** The SCIM endpoints sit behind the `admin-api` entitlement, which
CAIRO's plan doesn't grant, so they return 403 in CAIRO today. The SCIM fix is defence in
depth, and it is in place before SCIM is ever switched on.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | API-key auth cache: evict after delete, no TTL refresh on read. SCIM `Users/{id}` `PUT` and `DELETE` now check organization membership |
| Worker | None |
| Configuration | `LANGFUSE_CACHE_API_KEY_TTL_SECONDS` default 300 → 60. Dev sets no override, so the new default applies. The same TTL also bounds the policy-core authorization context cache |
| Infra / Terraform / Helm | None |
| Integrations (LiteLLM, NeMo, promptfoo) | None |

## 5. Database change

None.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| More API-key lookups reach the database, because the TTL is shorter and reads no longer refresh it | Medium | Low | Watch after deploy. The TTL stays tunable through its environment setting |
| Conflict with ACME's own edits to `scim/Users/[id].ts` (CHG-2026-058, CHG-2026-059 b) | Low | Low | Checked 2026-09-25 and 2026-09-26: the fix touches different functions, and both commits applied cleanly |
| Conflict at the next full upstream sync | Low | Low | The commits are identical to upstream's |

## 7. Compatibility

- **Backward compatible:** yes. No schema or API contract change. SCIM callers working inside
  their own organization see no difference, and provisioning (`active: true`) still works.
- **Upstream merge risk:** minimal (see §6).
- **Feature flag:** not needed. The change restores upstream's intended behaviour and ships
  with upstream's tests. The TTL remains an environment setting.

## 8. Client-facing notes

A revoked API key stops working within about 60 seconds. Once SCIM is enabled, a caller can
read or change only users in its own organization.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | Pending | CI runs upstream's tests (`api-auth.servertest.ts`, `scim-api.servertest.ts`). They can't run locally: the build workstation has no container runtime |
| B: staging | `Staging: not available.` | No database change, so no migration rehearsal. Rollback is a `git revert` of the two commits |
| C: post-deploy (dev, after an owner-approved deploy) | Pending | Revoke a key and confirm it's rejected within 60 s. SCIM is gated off in CAIRO, so the cross-organization case is covered by upstream's tests, not a live check |

## 10. Rollback

Revert the two cherry-pick commits and redeploy the previous image. There is no data or
schema to undo.

## 11. Assumptions and open questions

- The owner approves a dev deploy for Gate C.
- Whether to adopt further upstream fixes the same way before the next full sync is part of
  the upstream intake policy (register GOV-10).
