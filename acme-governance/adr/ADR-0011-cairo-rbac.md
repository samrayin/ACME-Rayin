# ADR-0011: CAIRO roles and the ACME project access policy

| | |
|---|---|
| **Change** | CHG-2026-059 · Tier 1 (authorisation) · owner: Anees Ur Rahman |
| **Status** | **Accepted by the owner, 2026-09-24** ("go with recommendations", §11). Build proceeds under CHG-2026-059 |
| **Related** | CHG-2026-058 (no ACME edits to Enterprise files; MIT role conversion `upstreamRole.ts`; CI guard) · Security Analyst role (#22) · licence map 2026-09-23 items 2.1–2.4 |

## 1. The problem

Banks need to give different people different views of the same AI platform:
- business users who see cost and usage but never prompt text;
- auditors who see evidence but change nothing;
- teams kept apart from each other's AI applications.

What CAIRO has today falls short of that:
- **Six organisation roles.** Upstream's OWNER, ADMIN, MEMBER, VIEWER and NONE, plus ACME's SECURITY.
- **VIEWER reads prompt and response content** (`projectData:read`), so there is no role for numbers-only access.
- **The same role applies to every project in the organisation.**
- **The sidebar hides pages by permission** (`routes.tsx`, `projectRbacScopes`), **but some in-page panels don't.** Live example, 2026-09-24: a new Member's LLM Gateway page requested the owner-only "unmanaged keys" panel four times. The server refused each request, so nothing was disclosed, but the panel should never have been shown.

## 2. The Enterprise boundary (decided, owner 2026-09-24)

Langfuse sells **project-level roles** as an Enterprise feature. In the code, the feature itself is MIT: the `ProjectMembership` role and `resolveProjectRole`. What makes it Enterprise is an entitlement check (`rbac-project-roles`) in MIT files that blocks creating project roles without a licence.

CAIRO will **not**:
- remove or flip that check;
- write `ProjectMembership` rows to get around it;
- edit any Enterprise-licensed file.

The CHG-2026-058 CI guard enforces the last point.

Instead, the owner chose **option C: an ACME-owned project access policy** (§5). It is designed clean-room. It differs in kind from the Enterprise feature, because it can only **narrow** access and never grants any. It is described as ACME's own feature, never as "project-level RBAC".

## 3. Role set

Roles are organisation-wide. Display names are what CAIRO shows; enum values are what the database stores.

| Display name | Enum | Who | New? |
|---|---|---|---|
| Platform Owner | `OWNER` | ACME operations; the bank's platform owner | Existing (renamed in UI) |
| Platform Admin | `ADMIN` | The bank's AI platform team | Existing (renamed in UI) |
| **Prompt Analyst** | `MEMBER` | Teams building and tuning AI applications | Existing (renamed in UI, owner 2026-09-24) |
| Viewer | `VIEWER` | Kept for compatibility. Reads content; not recommended for bank business users | Existing |
| Security Analyst | `SECURITY` | Security operations | Existing |
| **Business Analyst** | `ANALYST` | Business owners and finance: cost, usage, dashboards | **New** |
| **Auditor** | `AUDITOR` | Internal audit, compliance, regulator visits: evidence, read-only | **New** |
| Approver | — | Not a role (owner decision §11.1): a `promptApprovals:approve` permission on Platform Admin | Permission, not a role |
| No access | `NONE` | — | Existing |

Renaming in the UI changes labels only. Enum values, the API and upstream compatibility stay the same.

## 4. Permissions of the new roles

New scopes, where a role needs part of an existing one without the rest:

| New scope | What it allows | Why it is needed |
|---|---|---|
| `llmGatewaySpend:read` | The LLM Gateway **Spend** tab only | `llmGateway:read` also shows keys, teams and models, which a Business Analyst does not need |
| `evidence:read` | A read-only view of configuration for audit: gateway keys and models (never key material), guardrail settings, members | So Auditors don't need the operational `:read` scopes, which would also light up the edit UI |

| Role | Scopes |
|---|---|
| Business Analyst (`ANALYST`) | `project:read`, `dashboards:read`, `metrics:read`, `llmGatewaySpend:read` |
| Auditor (`AUDITOR`) | `project:read`, `projectAuditLogs:read`, `projectGuardrails:read`, `llmGatewayLogs:read`, `evidence:read`, `projectMembers:read`, `prompts:read` (approval history; see §11 Q3) |
| Platform Admin (existing), added | `promptApprovals:approve` (new; never their own request, as today) |

**Neither Business Analyst nor Auditor holds `projectData:read`, so neither reads traces, sessions or prompt and response content.**

## 5. The ACME project access policy (narrowing only)

**Rule.** For each person and project, an organisation admin may set a **ceiling role** that is lower than or equal to the person's organisation role, or `NONE` to hide the project. The person's effective role in that project is the ceiling. Without a policy row, nothing changes.

**"Lower than or equal to" is defined by permissions, not by rank.** The roles are not a simple ladder: SECURITY and AUDITOR are sideways from MEMBER. A policy is accepted only if **every scope of the ceiling role is also a scope of the person's organisation role**. `NONE` is always accepted. This check makes it impossible for the policy to grant a permission the organisation role lacks. It is checked when a policy is written, and again at sign-in in case the organisation role has since changed.

**Data.** A new ACME table `acme_project_access` with:
- `org_id`, `project_id`, `user_id`;
- `ceiling_role` (Role);
- `created_by`, `created_at` and `updated_at`;
- unique on (`project_id`, `user_id`);
- foreign keys cascading on project and user deletion.

It is written only by an ACME tRPC router, and every change goes to the audit log.

**Enforcement.** A single MIT hook narrows access after upstream has worked out the project role for the session, in `web/src/server/auth.ts` where `resolveProjectRole` is called:
- the effective role becomes the ceiling when a policy row exists and passes the subset check;
- projects with `NONE` are removed from the session's project list.

Everything downstream (sidebar gating, tRPC `throwIfNoProjectAccess`, page guards) reads the session, so it narrows automatically. Public-API keys are project-scoped machine credentials and are not affected.

**Screen.** Organisation settings gets a "Project access" page, visible to OWNER and ADMIN. For each person it shows the organisation role and a ceiling per project, and offers only valid ceilings.

**How it differs from Langfuse's Enterprise project roles:**

| | Langfuse Enterprise project roles | ACME project access policy |
|---|---|---|
| Direction | Can raise or lower per project | **Only lowers** |
| Source of rights | Project role replaces the organisation role | The organisation role is always the maximum |
| Storage | Upstream `ProjectMembership.role` | ACME's own table |
| Code | Upstream MIT logic behind an Enterprise entitlement | ACME code; the upstream gate is untouched |

## 6. Hidden, not just blocked

- **The server stays the security control.** Every procedure keeps its scope check.
- **The UI hides what the role can't use.** A surface appears only if the user holds its scope; otherwise it is not rendered at all.

| Surface | Scope that shows it |
|---|---|
| Traces, sessions, observations, playground | `projectData:read` / `playground:execute` |
| In-app AI assistant widget | `projectAiAssistant:use` |
| Dashboards and cost | `dashboards:read` |
| LLM Gateway page | `llmGateway:read`, `llmGatewayLogs:read` or `llmGatewaySpend:read`. Tabs are shown individually by their own scope |
| Gateway **unmanaged keys** panel | organisation OWNER only (**first fix, independent of the rest**) |
| Gateway models management and smart router | `llmGatewayModels:CUD` (already) |
| Guardrail events | `projectGuardrails:read` |
| Audit logs, change record | `projectAuditLogs:read` / `llmGatewayLogs:read` |
| Settings: members, API keys, integrations, retention | their own `:read` / `:CUD` scopes; Auditor reads through `evidence:read` |
| Project access page | organisation OWNER / ADMIN |

**The rule for every ACME page from now on:** a component that calls a procedure must be guarded by that procedure's scope with `useHasProjectAccess`.

## 7. Staying outside the Enterprise boundary

- New role values are an MIT database migration (`ALTER TYPE "Role" ADD VALUE ...`), as SECURITY was.
- `ACME_ONLY_ROLES` in `upstreamRole.ts` grows to include `ANALYST` and `AUDITOR`, so upstream integrations never receive them.
- The web typecheck wrapper (CHG-2026-058) already tolerates exactly the known Enterprise-file type error that new role values cause, and nothing else.
- The CI guard fails any change under `ee/`.
- The project access policy is ACME code and tables only.

## 8. Tests

- **Every role × every surface:** a rendered-UI test proves each role's hidden surfaces are absent, not disabled, and a server test proves each procedure refuses a role without its scope.
- **Policy properties:**
  - for every pair (organisation role, ceiling), the policy is accepted only if the ceiling's scopes are a subset of the organisation role's;
  - the effective permissions are never more than the organisation role's, checked for all pairs;
  - `NONE` removes the project from the session.
- **Controls:** each check is broken once and shown to fail its tests.
- **Enterprise directories are byte-identical to upstream,** checked by the CI guard and in the PR.

## 9. Rollout

1. The unmanaged-keys panel fix: a small change, which can ship first.
2. The migration adding the new role values.
3. Permission sets and new scopes; UI labels (Prompt Analyst and the rest); in-page gating pass.
4. The project access table, router, screen and session hook.
5. Release. Assign roles to test users and check each role's view with the owner.

## 10. Rollback

- **UI and permissions:** redeploy the previous image.
- **Policy:** delete its rows, or turn off the hook with a flag, `CAIRO_PROJECT_ACCESS_POLICY_ENABLED` (default on after acceptance). The organisation roles are unaffected.
- **Role values:** Postgres cannot drop enum values, so a new role is retired by reassigning its users to another role. The value stays unused.

## 11. Owner decisions (2026-09-24: "go with recommendations")

| # | Question | Decision |
|---|---|---|
| 1 | Approver | **A `promptApprovals:approve` permission on Platform Admin**, not a separate role. Add a role later if a bank asks for four-eyes separation |
| 2 | Security Analyst and Auditor | **Keep both.** Security Analyst has no configuration view |
| 3 | Auditor and prompt templates | **Auditors may read prompt templates** (not customer data) to review approval history |
| 4 | Viewer | **Hide `VIEWER` from the invite dialog in bank deployments.** Business Analyst replaces it there. It stays in the enum for compatibility |
| 5 | Prompt Analyst and the gateway | **Their own project's Spend tab only** |
