import { describe, it, expect } from "vitest";
import { Role } from "@langfuse/shared/src/db";
import { projectRoleAccessRights } from "@langfuse/shared";
import {
  allowedProceduresFor,
  CONTENT_FREE_ROLES,
  isAllowedForRole,
  isContentFreeRole,
  throwIfSecurityRoleBlocked,
} from "@/src/features/rbac/server/securityRoleAllowList";

// CHG-2026-059 / ADR-0011. Business Analyst and Auditor must do their job
// without reading trace, session, observation or prompt/response content.
// These tests pin both halves: the scope sets, and the server-side
// allow-lists that enforce them where upstream checks membership only.

// Routers whose procedures return trace/session/observation content, or run
// a model over it. No content-free role may call any procedure on them.
const CONTENT_ROUTERS = [
  "traces.",
  "sessions.",
  "observations.",
  "generations.",
  "events.",
  "scores.",
  "comments.",
  "inAppAgent.",
  "batchExport.",
  "datasets.",
  "acmeChat.",
  "experiments.",
  "annotationQueues.",
];

const scopes = (role: Role) =>
  projectRoleAccessRights[role] as readonly string[];

describe("content-free roles: scope sets (ADR-0011 §4)", () => {
  it.each(CONTENT_FREE_ROLES)("%s holds no content or write scope", (role) => {
    const s = scopes(role);
    for (const forbidden of [
      "projectData:read",
      "playground:execute",
      "projectAiAssistant:use",
      "llmGateway:read",
    ]) {
      expect(s).not.toContain(forbidden);
    }
    expect(
      s.filter((x) => /:(CUD|CRUD|create|update|delete|approve)$/.test(x)),
    ).toEqual([]);
  });

  it("Business Analyst: dashboards, metrics and the gateway Spend tab", () => {
    expect([...scopes(Role.ANALYST)].sort()).toEqual(
      [
        "dashboards:read",
        "llmGatewaySpend:read",
        "metrics:read",
        "project:read",
      ].sort(),
    );
  });

  it("Auditor: evidence, read-only", () => {
    expect([...scopes(Role.AUDITOR)].sort()).toEqual(
      [
        "evidence:read",
        "llmGatewayLogs:read",
        "project:read",
        "projectAuditLogs:read",
        "projectGuardrails:read",
        "projectMembers:read",
        "prompts:read",
      ].sort(),
    );
  });

  it("Prompt Analyst (MEMBER) sees the gateway Spend tab only (§11.5)", () => {
    expect(scopes(Role.MEMBER)).toContain("llmGatewaySpend:read");
    expect(scopes(Role.MEMBER)).not.toContain("llmGateway:read");
  });

  it("approving prompt promotions is Platform Owner / Admin only (§11.1)", () => {
    const holders = Object.values(Role).filter((r) =>
      scopes(r).includes("promptApprovals:approve"),
    );
    expect(holders.sort()).toEqual([Role.ADMIN, Role.OWNER].sort());
  });

  it("read-only evidence is Owner, Admin and Auditor", () => {
    const holders = Object.values(Role).filter((r) =>
      scopes(r).includes("evidence:read"),
    );
    expect(holders.sort()).toEqual(
      [Role.ADMIN, Role.AUDITOR, Role.OWNER].sort(),
    );
  });
});

describe("content-free roles: server allow-lists (ADR-0011 §4)", () => {
  it("the content-free roles are exactly SECURITY, ANALYST and AUDITOR", () => {
    expect([...CONTENT_FREE_ROLES].sort()).toEqual(
      [Role.AUDITOR, Role.ANALYST, Role.SECURITY].sort(),
    );
    for (const role of Object.values(Role)) {
      expect(isContentFreeRole(role)).toBe(CONTENT_FREE_ROLES.includes(role));
    }
  });

  it.each(CONTENT_FREE_ROLES)(
    "%s's allow-list touches no content router",
    (role) => {
      const offending = allowedProceduresFor(role).filter((p) =>
        CONTENT_ROUTERS.some((prefix) => p.startsWith(prefix)),
      );
      expect(offending).toEqual([]);
    },
  );

  it.each(CONTENT_FREE_ROLES)(
    "%s's allow-list names only existing, read-only procedures",
    async (role) => {
      const { appRouter } = await import("@/src/server/api/root");
      const procedures = appRouter._def.procedures as unknown as Record<
        string,
        { _def: { type: string } } | undefined
      >;
      const problems = allowedProceduresFor(role).flatMap((path) => {
        const proc = procedures[path];
        if (!proc) return [`${path}: does not exist`];
        if (proc._def.type !== "query")
          return [`${path}: is a ${proc._def.type}`];
        return [];
      });
      expect(problems).toEqual([]);
    },
    120_000,
  );

  it.each(CONTENT_FREE_ROLES)(
    "%s is blocked on an unknown, future procedure",
    (role) => {
      expect(() =>
        throwIfSecurityRoleBlocked({
          projectRole: role,
          procedurePath: "someNewUpstreamRouter.list",
        }),
      ).toThrow();
    },
  );

  it("dashboards: Business Analyst yes; Security Analyst and Auditor no", () => {
    expect(isAllowedForRole(Role.ANALYST, "dashboard.executeQuery")).toBe(true);
    expect(isAllowedForRole(Role.SECURITY, "dashboard.executeQuery")).toBe(
      false,
    );
    expect(isAllowedForRole(Role.AUDITOR, "dashboard.executeQuery")).toBe(
      false,
    );
  });

  it("Business Analyst cannot open gateway keys, the record or guardrail events", () => {
    for (const p of [
      "acmeLitellm.keys",
      "acmeLitellm.events",
      "acmeGuardrails.recentEvents",
      "acmeAuditLogs.all",
    ]) {
      expect(isAllowedForRole(Role.ANALYST, p)).toBe(false);
    }
  });

  it("Auditor keeps everything Security Analyst has", () => {
    for (const p of allowedProceduresFor(Role.SECURITY)) {
      expect(isAllowedForRole(Role.AUDITOR, p)).toBe(true);
    }
  });

  it.each([Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER])(
    "never limits %s",
    (role) => {
      expect(isAllowedForRole(role, "traces.byId")).toBe(true);
    },
  );
});
