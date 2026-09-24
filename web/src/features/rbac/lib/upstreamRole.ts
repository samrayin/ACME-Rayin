/**
 * ACME addition (CHG-2026-058): keep ACME-only roles out of upstream
 * integrations without touching Enterprise-licensed files.
 *
 * ACME adds roles to the shared `Role` enum (e.g. SECURITY). Some upstream
 * code under `ee/` accepts only upstream's own role list. Editing those
 * files would make ACME's change Langfuse's property under the EE licence,
 * so the conversion happens here, on the MIT side, before the call.
 */
import { type Role } from "@langfuse/shared/src/db";
import { getSfdcService } from "@/src/ee/features/sfdc-sync/server";

/** Roles that exist only in CAIRO. Upstream integrations never see them. */
export const ACME_ONLY_ROLES = [
  "SECURITY",
  "ANALYST",
  "AUDITOR",
] as const satisfies readonly Role[];

export type UpstreamRole = Exclude<Role, (typeof ACME_ONLY_ROLES)[number]>;

/** The role as upstream knows it, or null for an ACME-only role. */
export function toUpstreamRole(role: Role): UpstreamRole | null {
  return (ACME_ONLY_ROLES as readonly Role[]).includes(role)
    ? null
    : (role as UpstreamRole);
}

/**
 * Upstream's Salesforce role sync, with ACME-only roles skipped. The sync
 * itself only runs on Langfuse Cloud with its MuleSoft credentials, so in
 * CAIRO this is a no-op either way.
 */
export async function syncSfdcUserRole(input: {
  orgId: string;
  userId: string;
  email: string | null | undefined;
  role: Role;
}): Promise<void> {
  const role = toUpstreamRole(input.role);
  if (role === null) return;
  await getSfdcService()?.setUserRole({ ...input, role });
}
