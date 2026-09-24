/**
 * ACME project access policy (ADR-0011 section 5, CHG-2026-059 part c).
 *
 * Per person and project, an organisation admin may set a CEILING role. The
 * ceiling can only narrow what the person already has: it is accepted only
 * when every scope of the ceiling role is also a scope of the person's
 * organisation role. NONE is always accepted and hides the project.
 *
 * "Narrower" is defined by scopes, not by rank, because the roles are not a
 * ladder (SECURITY and AUDITOR sit sideways from MEMBER).
 *
 * This is ACME's own feature, clean-room. It does not write upstream
 * ProjectMembership rows and does not touch the Enterprise entitlement that
 * gates Langfuse's project-level roles.
 */
import { Role } from "@langfuse/shared/src/db";
import { projectRoleAccessRights } from "@langfuse/shared";

function scopesOf(role: Role): readonly string[] {
  return projectRoleAccessRights[role] ?? [];
}

/** True when every scope of `narrower` is also a scope of `wider`. */
export function isScopeSubset(narrower: Role, wider: Role): boolean {
  const allowed = new Set(scopesOf(wider));
  return scopesOf(narrower).every((scope) => allowed.has(scope));
}

/** True when `ceiling` may be set for a person whose organisation role is `orgRole`. */
export function isValidCeiling(orgRole: Role, ceiling: Role): boolean {
  return ceiling === Role.NONE || isScopeSubset(ceiling, orgRole);
}

/** The ceilings an admin may offer for a person with `orgRole`, NONE first. */
export function validCeilingsFor(orgRole: Role): Role[] {
  return [
    Role.NONE,
    ...Object.values(Role).filter(
      (role) => role !== Role.NONE && isValidCeiling(orgRole, role),
    ),
  ];
}

/**
 * The person's effective role in one project.
 *
 * - No ceiling: the role upstream resolved, unchanged.
 * - A ceiling within both the organisation role and the resolved role: the
 *   ceiling.
 * - Otherwise NONE. This fails closed: a ceiling that is no longer valid
 *   (for example because the organisation role has since changed) hides the
 *   project instead of silently granting more than the admin intended. The
 *   Project access screen flags such rows for review.
 */
export function applyProjectAccessCeiling(p: {
  resolvedRole: Role;
  orgRole: Role;
  ceiling: Role | undefined;
}): Role {
  if (p.ceiling === undefined) return p.resolvedRole;
  if (p.ceiling === Role.NONE) return Role.NONE;
  if (
    isScopeSubset(p.ceiling, p.orgRole) &&
    isScopeSubset(p.ceiling, p.resolvedRole)
  )
    return p.ceiling;
  return Role.NONE;
}
