-- ACME (CHG-2026-059, ADR-0011): Business Analyst (ANALYST) and Auditor
-- (AUDITOR) organisation roles. Both are content-free: no trace, session or
-- prompt/response content. Scopes: packages/shared/src/features/rbac/
-- projectAccessRights.ts; server-side allow-lists:
-- web/src/features/rbac/server/securityRoleAllowList.ts.
--
-- Additive only: existing memberships keep their roles. ADD VALUE is safe
-- here because nothing in this migration uses the new values (PostgreSQL
-- forbids using an enum value in the same transaction that adds it).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ANALYST';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AUDITOR';
