/**
 * ACME: server-side allow-list for the SECURITY (Security Analyst) role.
 *
 * Every project member can read trace, observation, session and score
 * content in upstream Langfuse -- those routers check project membership
 * only, not a scope -- and that content is where raw prompts, and therefore
 * PII, live. A Security Analyst must be able to investigate guardrail
 * decisions without being able to open that content.
 *
 * Enforced as an allow-list, not a deny-list, on purpose: a router added by a
 * future upstream merge is blocked for this role until someone deliberately
 * allows it, instead of silently exposing new data.
 *
 * Applied in every middleware that grants project access (trpc.ts:
 * enforceUserIsAuthedAndProjectMember, enforceTraceAccess,
 * enforceSessionAccess) and in the Next.js routes that return trace content
 * outside tRPC.
 */
import { Role } from "@langfuse/shared/src/db";
import { TRPCError } from "@trpc/server";

const SECURITY_ROLE_ALLOWED_PROCEDURES: ReadonlySet<string> = new Set([
  // Guardrail events and policies (updateConfig stays blocked: it isn't here,
  // and it also requires project:update, which SECURITY does not hold).
  "acmeGuardrails.recentEvents",
  "acmeGuardrails.eventDetail",
  // PII-masked content only, decrypted server-side, and every view is
  // audit-logged. Raw content is never returned by this procedure.
  "acmeGuardrails.maskedContent",
  "acmeGuardrails.getConfig",
  "acmeAssuranceDemo.demoAssets",
  "acmeAssuranceDemo.liveAssurance",
  // Project audit log.
  "acmeAuditLogs.all",
  // App frame: project theme.
  "acmeTheme.get",
]);

export function isAllowedForSecurityRole(procedurePath: string): boolean {
  return SECURITY_ROLE_ALLOWED_PROCEDURES.has(procedurePath);
}

/**
 * Throws FORBIDDEN when a Security Analyst calls a project procedure that is
 * not allow-listed. No-op for every other role and for Langfuse instance
 * admins.
 */
export function throwIfSecurityRoleBlocked(p: {
  projectRole: Role | undefined;
  procedurePath: string;
  isInstanceAdmin?: boolean;
}): void {
  if (p.isInstanceAdmin) return;
  if (p.projectRole !== Role.SECURITY) return;
  if (isAllowedForSecurityRole(p.procedurePath)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "The Security Analyst role cannot access this resource. It is limited to guardrail events and audit logs.",
  });
}
