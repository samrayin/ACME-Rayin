import { type Role } from "../../db";

export const projectScopes = [
  "projectMembers:read",
  "projectMembers:CUD",

  "apiKeys:read",
  "apiKeys:CUD",

  "objects:publish",
  "objects:bookmark",
  "objects:tag",

  "traces:delete",

  "scores:CUD",

  "scoreConfigs:CUD",
  "scoreConfigs:read",

  "annotationQueues:read",
  "annotationQueues:CUD",
  "annotationQueueAssignments:read",
  "annotationQueueAssignments:CUD",

  "project:read",
  "project:update",
  "project:delete",

  "integrations:CRUD",

  "datasets:read",
  "datasets:CUD",

  "prompts:CUD",
  "prompts:read",
  "promptProtectedLabels:CUD",

  "dashboards:read",
  "dashboards:CUD",

  "models:CUD",

  "batchExports:create",
  "batchExports:read",

  "evaluator:CUD",
  "evaluator:read",
  "evaluationRule:read",
  "evaluationRule:CUD",
  "evalJobExecution:read",
  "evalDefaultModel:read",
  "evalDefaultModel:CUD",

  "llmApiKeys:read",
  "llmApiKeys:create",
  "llmApiKeys:update",
  "llmApiKeys:delete",

  "llmSchemas:CUD",
  "llmSchemas:read",

  "llmTools:CUD",
  "llmTools:read",

  "playground:execute",

  "comments:CUD",
  "comments:read",

  "promptExperiments:CUD",
  "promptExperiments:read",

  "projectAuditLogs:read",

  // ACME addition: read access to the Guardrails dashboard (recent
  // block/redact/allow decisions from rayin-guardrails). Owner/admin only,
  // same sensitivity level as audit logs -- these events reveal what
  // content was flagged or blocked, not just that something happened.
  "projectGuardrails:read",
  // ACME addition (ADR-0003, CHG-2026-005): CAIRO management of the LiteLLM
  // gateway. read = see this project's gateway keys (never key material),
  // teams, model catalogue and spend. CUD = create, change, rotate and
  // revoke keys and teams -- owner/admin only: a key spends money.
  "llmGateway:read",
  "llmGateway:CUD",
  // ACME addition (ADR-0010, CHG-2026-056): add, change and remove gateway
  // models and endpoints, and the smart router. Owner/admin only: it can
  // hand the gateway a provider credential and point it at an endpoint.
  "llmGatewayModels:CUD",
  // ACME (ADR-0011, CHG-2026-059): the LLM Gateway Spend tab only, without
  // keys, teams or models. Business Analyst; Prompt Analyst (own project).
  "llmGatewaySpend:read",
  // ACME (ADR-0011): read-only configuration evidence for audit -- gateway
  // keys and models (never key material), guardrail settings, members.
  "evidence:read",
  // ACME (ADR-0011 §11.1): approve or reject prompt promotion requests
  // (never one's own). Platform Owner and Platform Admin.
  "promptApprovals:approve",
  // The append-only record of gateway management actions (and, with
  // CHG-2026-008, of gateway requests: who, which key, source address).
  // Audit-log sensitivity: owner, admin and the Security Analyst.
  "llmGatewayLogs:read",
  // ACME: read trace / observation / session / score content (raw prompts).
  // Held by every built-in role; withheld only from SECURITY, whose access
  // is also enforced server-side by securityRoleAllowList.ts.
  "projectData:read",

  // ACME addition: use the in-app ACME AI chat widget, which reads this
  // project's own trace data and sends it to an LLM via RAYIN's LiteLLM
  // gateway. Same bar as playground:execute (an action that also invokes
  // an LLM) -- granted to MEMBER and above, not VIEWER. Viewing the same
  // trace data in the console itself isn't scope-gated at all (any member
  // can), but this is a distinct action -- it causes project data to leave
  // the tenant boundary -- and deserves its own gate rather than
  // inheriting "can view traces" implicitly.
  "projectAiAssistant:use",

  "TableViewPresets:CUD",
  "TableViewPresets:read",

  "automations:CUD",
  "automations:read",

  "alerts:read",
  "alerts:CUD",

  // Public-API action tokens; not granted to any UI role.
  "traces:read",
  "traces:create",
  "scores:read",
  "scores:create",
  "media:read",
  "media:create",
  "sessions:read",
  "metrics:read",
  "models:read",
  "experiments:read",
  "feedback:create",

  // ACME addition: the rayin-guardrails audit-trail push endpoint
  // (POSTGRES-COMPLIANCE-FRAMEWORK.md decision #4) -- a project-scoped API
  // key held by the separate rayin-guardrails service, never a human role.
  // Not granted to OWNER/ADMIN/MEMBER/VIEWER for the same reason none of the
  // other public-API-only scopes above are: this is what an API key
  // presents, not something a UI role membership should confer.
  "guardrailsEvents:create",
] as const;

// type string of all Resource:Action, e.g. "members:read"
export type ProjectScope = (typeof projectScopes)[number];

export const projectRoleAccessRights: Record<Role, ProjectScope[]> = {
  OWNER: [
    "llmGateway:read",
    "llmGateway:CUD",
    "llmGatewayModels:CUD",
    "llmGatewaySpend:read",
    "evidence:read",
    "promptApprovals:approve",
    "llmGatewayLogs:read",
    "project:read",
    "projectData:read",
    "project:update",
    "project:delete",
    "projectMembers:read",
    "projectMembers:CUD",
    "apiKeys:read",
    "apiKeys:CUD",
    "integrations:CRUD",
    "objects:publish",
    "objects:bookmark",
    "objects:tag",
    "traces:delete",
    "scores:CUD",
    "scoreConfigs:CUD",
    "scoreConfigs:read",
    "datasets:read",
    "datasets:CUD",
    "prompts:CUD",
    "prompts:read",
    "promptProtectedLabels:CUD",
    "models:CUD",
    "evaluator:CUD",
    "evaluator:read",
    "evaluationRule:CUD",
    "evaluationRule:read",
    "evalJobExecution:read",
    "evalDefaultModel:CUD",
    "evalDefaultModel:read",
    "llmApiKeys:read",
    "llmApiKeys:create",
    "llmApiKeys:update",
    "llmApiKeys:delete",
    "llmSchemas:CUD",
    "llmSchemas:read",
    "llmTools:CUD",
    "llmTools:read",
    "playground:execute",
    "batchExports:create",
    "batchExports:read",
    "comments:CUD",
    "comments:read",
    "annotationQueues:read",
    "annotationQueues:CUD",
    "annotationQueueAssignments:read",
    "annotationQueueAssignments:CUD",
    "promptExperiments:CUD",
    "promptExperiments:read",
    "projectAuditLogs:read",
    "projectGuardrails:read",
    "projectAiAssistant:use",
    "dashboards:read",
    "dashboards:CUD",
    "TableViewPresets:CUD",
    "TableViewPresets:read",
    "automations:CUD",
    "automations:read",
    "alerts:read",
    "alerts:CUD",
  ],
  ADMIN: [
    "llmGateway:read",
    "llmGateway:CUD",
    "llmGatewayModels:CUD",
    "llmGatewaySpend:read",
    "evidence:read",
    "promptApprovals:approve",
    "llmGatewayLogs:read",
    "project:read",
    "projectData:read",
    "project:update",
    "projectMembers:read",
    "projectMembers:CUD",
    "apiKeys:read",
    "apiKeys:CUD",
    "integrations:CRUD",
    "objects:publish",
    "objects:bookmark",
    "objects:tag",
    "traces:delete",
    "scores:CUD",
    "scoreConfigs:CUD",
    "scoreConfigs:read",
    "datasets:read",
    "datasets:CUD",
    "prompts:CUD",
    "prompts:read",
    "promptProtectedLabels:CUD",
    "models:CUD",
    "evaluator:CUD",
    "evaluator:read",
    "evaluationRule:CUD",
    "evaluationRule:read",
    "evalJobExecution:read",
    "evalDefaultModel:CUD",
    "evalDefaultModel:read",
    "llmApiKeys:read",
    "llmApiKeys:create",
    "llmApiKeys:update",
    "llmApiKeys:delete",
    "llmSchemas:CUD",
    "llmSchemas:read",
    "llmTools:CUD",
    "llmTools:read",
    "playground:execute",
    "batchExports:create",
    "batchExports:read",
    "comments:CUD",
    "comments:read",
    "annotationQueues:read",
    "annotationQueues:CUD",
    "annotationQueueAssignments:read",
    "annotationQueueAssignments:CUD",
    "promptExperiments:CUD",
    "promptExperiments:read",
    "projectAuditLogs:read",
    "projectGuardrails:read",
    "projectAiAssistant:use",
    "dashboards:read",
    "dashboards:CUD",
    "TableViewPresets:CUD",
    "TableViewPresets:read",
    "automations:CUD",
    "automations:read",
    "alerts:read",
    "alerts:CUD",
  ],
  MEMBER: [
    // ACME (ADR-0011 §11.5): the gateway Spend tab only, not keys/teams/models.
    "llmGatewaySpend:read",
    "project:read",
    "projectData:read",
    "projectMembers:read",
    "apiKeys:read",
    "objects:publish",
    "objects:bookmark",
    "objects:tag",
    "scores:CUD",
    "scoreConfigs:CUD",
    "scoreConfigs:read",
    "datasets:read",
    "datasets:CUD",
    "prompts:CUD",
    "prompts:read",
    "evaluator:CUD",
    "evaluator:read",
    "evaluationRule:read",
    "evaluationRule:CUD",
    "evalJobExecution:read",
    "evalDefaultModel:read",
    "evalDefaultModel:CUD",
    "llmApiKeys:read",
    "llmSchemas:read",
    "llmSchemas:CUD",
    "llmTools:CUD",
    "llmTools:read",
    "playground:execute",
    "batchExports:create",
    "batchExports:read",
    "comments:CUD",
    "comments:read",
    "annotationQueues:read",
    "annotationQueues:CUD",
    "annotationQueueAssignments:read",
    "promptExperiments:CUD",
    "promptExperiments:read",
    "dashboards:read",
    "dashboards:CUD",
    "TableViewPresets:CUD",
    "TableViewPresets:read",
    "automations:read",
    "alerts:read",
    "alerts:CUD",
    "projectAiAssistant:use",
  ],
  VIEWER: [
    // ADR-0011 §11 Q7 (owner, 2026-09-25): the gateway Spend tab only, as
    // for Prompt Analyst -- no keys, teams or models.
    "llmGatewaySpend:read",
    "project:read",
    "projectData:read",
    "prompts:read",
    "evaluator:read",
    "scoreConfigs:read",
    "evaluationRule:read",
    "evalJobExecution:read",
    "evalDefaultModel:read",
    "datasets:read",
    "llmApiKeys:read",
    "llmSchemas:read",
    "llmTools:read",
    "comments:read",
    "annotationQueues:read",
    "promptExperiments:read",
    "dashboards:read",
    "TableViewPresets:read",
    "automations:read",
    "alerts:read",
  ],
  NONE: [],
  // ACME: Security Analyst. Guardrail events (incl. what was typed, PII
  // masked) and audit logs; no trace/session/score content (no
  // projectData:read), no configuration changes.
  SECURITY: [
    "project:read",
    "projectGuardrails:read",
    "projectAuditLogs:read",
    // The gateway's append-only record only -- not llmGateway:read, so no
    // keys, budgets or spend (ADR-0003 §3.3).
    "llmGatewayLogs:read",
  ],
  // ACME (ADR-0011): Business Analyst. Dashboards, cost and usage. No
  // trace/session/prompt content (no projectData:read); enforced server-side
  // by the ANALYST allow-list in securityRoleAllowList.ts.
  ANALYST: [
    "project:read",
    "dashboards:read",
    "metrics:read",
    "llmGatewaySpend:read",
  ],
  // ACME (ADR-0011): Auditor. Evidence, read-only: audit logs, guardrail
  // events, the gateway record, configuration, prompt approval history. No
  // trace/session/prompt-response content; enforced server-side by the
  // AUDITOR allow-list in securityRoleAllowList.ts.
  AUDITOR: [
    "project:read",
    "projectAuditLogs:read",
    "projectGuardrails:read",
    "llmGatewayLogs:read",
    "evidence:read",
    "projectMembers:read",
    "prompts:read",
  ],
};

export const projectNoneRoleComment =
  "Do not override the organization role for this project.";

/**
 * Pure role-based access check (no session), for callers that already
 * resolved the caller's project role — e.g. the in-app agent runtime.
 * Mirrors the role branch of web's `hasProjectAccess`.
 */
export function hasProjectAccessByRole(p: {
  role: Role;
  scope: ProjectScope;
  admin?: boolean;
}): boolean {
  if (p.admin) return true;
  return projectRoleAccessRights[p.role].includes(p.scope);
}
