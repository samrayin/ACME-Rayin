import { prisma, type Role } from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";

/**
 * ACME (ADR-0011): whether the project access policy is applied. On unless
 * CAIRO_PROJECT_ACCESS_POLICY_ENABLED=false, which is the rollback switch.
 * With no policy rows it changes nothing either way.
 */
export function isProjectAccessPolicyEnabled(): boolean {
  return env.CAIRO_PROJECT_ACCESS_POLICY_ENABLED !== "false";
}

/** The person's ceilings, keyed by project id. Empty when the policy is off. */
export async function loadProjectAccessCeilings(
  userId: string,
): Promise<Map<string, Role>> {
  if (!isProjectAccessPolicyEnabled()) return new Map();
  const rows = await prisma.acmeProjectAccess.findMany({
    where: { userId },
    select: { projectId: true, ceilingRole: true },
  });
  return new Map(rows.map((row) => [row.projectId, row.ceilingRole]));
}
