-- ACME: Security Analyst role -- guardrail events and audit logs, no trace
-- content. Scopes: packages/shared/src/features/rbac/projectAccessRights.ts;
-- server-side allow-list: web/src/features/rbac/server/securityRoleAllowList.ts.
--
-- Additive only: existing memberships keep their roles. ADD VALUE is safe
-- here because nothing in this migration uses the new value (PostgreSQL
-- forbids using an enum value in the same transaction that adds it).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SECURITY';
