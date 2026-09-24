import { type Role } from "@langfuse/shared/src/db";

export const orderedRoles: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  // ACME: between MEMBER and ADMIN so only ADMIN/OWNER can grant it. Not a
  // superset of MEMBER (it has guardrail access, but no trace content).
  SECURITY: 2.5,
  // ACME (ADR-0011): like SECURITY, above MEMBER so only ADMIN/OWNER can
  // grant them; neither is a superset of MEMBER (no content).
  ANALYST: 2.3,
  AUDITOR: 2.6,
  MEMBER: 2,
  VIEWER: 1,
  NONE: 0,
};
