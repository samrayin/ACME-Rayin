/**
 * ACME: server-side allow-lists for the content-free roles: SECURITY
 * (Security Analyst), and since ADR-0011 (CHG-2026-059) ANALYST (Business
 * Analyst) and AUDITOR (Auditor).
 *
 * Every project member can read trace, observation, session and score
 * content in upstream Langfuse -- those routers check project membership
 * only, not a scope -- and that content is where raw prompts, and therefore
 * PII, live. These roles must do their job without being able to open it.
 *
 * Enforced as an allow-list, not a deny-list, on purpose: a router added by a
 * future upstream merge is blocked for these roles until someone deliberately
 * allows it, instead of silently exposing new data. Each list is the minimum
 * the role's screens need, read-only.
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
  "acmeGuardrails.getConfig",
  "acmeAssuranceDemo.demoAssets",
  "acmeAssuranceDemo.liveAssurance",
  // Project audit log.
  "acmeAuditLogs.all",
  // Append-only record of LiteLLM gateway management actions (ADR-0003).
  // status is the app frame's "is this feature on" check. Every other
  // acmeLitellm procedure -- keys, teams, spend, all mutations -- stays
  // blocked, and also requires llmGateway:* scopes SECURITY does not hold.
  "acmeLitellm.status",
  "acmeLitellm.events",
  // CHG-2026-008: the gateway request-log mirror and its completeness status.
  // Metadata only; both need llmGatewayLogs:read, which SECURITY holds.
  "acmeLitellm.requestLogs",
  "acmeLitellm.reconcileStatus",
  // App frame: project theme.
  "acmeTheme.get",
]);

// ADR-0011: Business Analyst. Dashboards (aggregates and metadata dimensions
// only -- the query data model has no prompt/response text fields), and the
// gateway Spend tab. Dashboard create/update/delete stay blocked.
const ANALYST_ROLE_ALLOWED_PROCEDURES: ReadonlySet<string> = new Set([
  "dashboard.chart",
  "dashboard.scoreHistogram",
  "dashboard.executeQuery",
  "dashboard.allDashboards",
  "dashboard.getDashboard",
  "dashboard.getHomeDashboard",
  "dashboardWidgets.all",
  "dashboardWidgets.get",
  "acmeLitellm.status",
  "acmeLitellm.spend",
  "acmeTheme.get",
]);

// ADR-0011: Auditor. Everything the Security Analyst sees, plus read-only
// configuration evidence (gateway keys/teams/models -- never key material),
// prompt templates and their approval/review history, and project members.
const AUDITOR_ROLE_ALLOWED_PROCEDURES: ReadonlySet<string> = new Set([
  ...SECURITY_ROLE_ALLOWED_PROCEDURES,
  "acmeLitellm.keys",
  "acmeLitellm.teams",
  "acmeLitellm.models",
  "acmeLitellm.catalogue",
  "acmePromptApproval.listPending",
  "acmePromptApproval.listHistory",
  "acmePromptReview.listDue",
  "acmePromptReview.listAll",
  "prompts.hasAny",
  "prompts.all",
  "prompts.count",
  "prompts.byId",
  "prompts.filterOptions",
  "prompts.allLabels",
  "prompts.allNames",
  "prompts.allPromptMeta",
  "prompts.allVersions",
  "prompts.getProtectedLabels",
  "members.byProjectId",
]);

const ALLOW_LISTS: Partial<Record<Role, ReadonlySet<string>>> = {
  [Role.SECURITY]: SECURITY_ROLE_ALLOWED_PROCEDURES,
  [Role.ANALYST]: ANALYST_ROLE_ALLOWED_PROCEDURES,
  [Role.AUDITOR]: AUDITOR_ROLE_ALLOWED_PROCEDURES,
};

const ROLE_LABEL: Partial<Record<Role, string>> = {
  [Role.SECURITY]:
    "The Security Analyst role cannot access this resource. It is limited to guardrail events and audit logs.",
  [Role.ANALYST]:
    "The Business Analyst role cannot access this resource. It is limited to dashboards, cost and usage.",
  [Role.AUDITOR]:
    "The Auditor role cannot access this resource. It is limited to read-only evidence: audit logs, guardrail events, the gateway record and configuration.",
};

/** The roles whose project access is limited to an allow-list. */
export const CONTENT_FREE_ROLES: readonly Role[] = [
  Role.SECURITY,
  Role.ANALYST,
  Role.AUDITOR,
];

export function isContentFreeRole(role: Role | undefined): boolean {
  return role !== undefined && ALLOW_LISTS[role] !== undefined;
}

/** True when `role` may call `procedurePath`, or is not content-free. */
export function isAllowedForRole(
  role: Role | undefined,
  procedurePath: string,
): boolean {
  const list = role === undefined ? undefined : ALLOW_LISTS[role];
  return list === undefined || list.has(procedurePath);
}

/** The allow-list of a content-free role, for tests and audits. */
export function allowedProceduresFor(role: Role): readonly string[] {
  return [...(ALLOW_LISTS[role] ?? [])];
}

export function isAllowedForSecurityRole(procedurePath: string): boolean {
  return SECURITY_ROLE_ALLOWED_PROCEDURES.has(procedurePath);
}

/**
 * Throws FORBIDDEN when a content-free role calls a project procedure that is
 * not on its allow-list. No-op for every other role and for Langfuse instance
 * admins. (Name kept from when SECURITY was the only such role.)
 */
export function throwIfSecurityRoleBlocked(p: {
  projectRole: Role | undefined;
  procedurePath: string;
  isInstanceAdmin?: boolean;
}): void {
  if (p.isInstanceAdmin) return;
  if (isAllowedForRole(p.projectRole, p.procedurePath)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: ROLE_LABEL[p.projectRole as Role] ?? "Access denied.",
  });
}
