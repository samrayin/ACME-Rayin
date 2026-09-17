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
  "media:create",
  "sessions:read",
  "metrics:read",
  "models:read",
  "experiments:read",
  "mcp:access",
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
    "project:read",
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
    "project:read",
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
    "project:read",
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
    "project:read",
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
