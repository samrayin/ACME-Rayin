import { type Role } from "@langfuse/shared/src/db";

export const orderedRoles: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  // ACME: between MEMBER and ADMIN so only ADMIN/OWNER can grant it. Not a
  // superset of MEMBER (it has guardrail access, but no trace content).
  SECURITY: 2.5,
  MEMBER: 2,
  VIEWER: 1,
  NONE: 0,
};
