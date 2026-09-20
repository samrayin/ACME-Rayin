import { describe, it, expect } from "vitest";
import { Role } from "@langfuse/shared/src/db";
import { projectRoleAccessRights } from "@langfuse/shared";
import {
  isAllowedForSecurityRole,
  throwIfSecurityRoleBlocked,
} from "@/src/features/rbac/server/securityRoleAllowList";

// The Security Analyst role investigates guardrail decisions without seeing
// trace content (raw prompts, where PII lives). These tests pin that down so
// an upstream merge or a scope-map edit can't quietly widen it.

const CONTENT_PROCEDURES = [
  "traces.all",
  "traces.byId",
  "traces.byIdWithObservationsAndScores",
  "sessions.byId",
  "observations.byId",
  "events.all",
  "scores.all",
  "dashboard.executeQuery",
  "datasets.allDatasets",
  "prompts.all",
  "comments.getByObjectId",
  "inAppAgent.startRun",
  "batchExport.create",
];

const ALLOWED_PROCEDURES = [
  "acmeGuardrails.recentEvents",
  "acmeGuardrails.eventDetail",
  "acmeGuardrails.maskedContent",
  "acmeGuardrails.getConfig",
  "acmeAuditLogs.all",
  "acmeTheme.get",
];

describe("Security Analyst allow-list", () => {
  it.each(CONTENT_PROCEDURES)("blocks %s for SECURITY", (path) => {
    expect(isAllowedForSecurityRole(path)).toBe(false);
    expect(() =>
      throwIfSecurityRoleBlocked({
        projectRole: Role.SECURITY,
        procedurePath: path,
      }),
    ).toThrow(/Security Analyst/);
  });

  it.each(ALLOWED_PROCEDURES)("allows %s for SECURITY", (path) => {
    expect(() =>
      throwIfSecurityRoleBlocked({
        projectRole: Role.SECURITY,
        procedurePath: path,
      }),
    ).not.toThrow();
  });

  it("blocks changing guardrail policies (not allow-listed)", () => {
    expect(() =>
      throwIfSecurityRoleBlocked({
        projectRole: Role.SECURITY,
        procedurePath: "acmeGuardrails.updateConfig",
      }),
    ).toThrow();
  });

  // Masked content is allowed; nothing that could return raw (unmasked)
  // content is. The raw reveal is a separate, later procedure and must be
  // allow-listed deliberately, not by a prefix match.
  it.each([
    "acmeGuardrails.rawContent",
    "acmeGuardrails.revealRawContent",
    "acmeGuardrails.maskedContentRaw",
  ])("does not allow raw-content procedure %s", (path) => {
    expect(isAllowedForSecurityRole(path)).toBe(false);
  });

  it("blocks an unknown, future procedure by default", () => {
    expect(() =>
      throwIfSecurityRoleBlocked({
        projectRole: Role.SECURITY,
        procedurePath: "someNewUpstreamRouter.list",
      }),
    ).toThrow();
  });

  it.each([Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER])(
    "never affects %s",
    (role) => {
      for (const path of CONTENT_PROCEDURES) {
        expect(() =>
          throwIfSecurityRoleBlocked({
            projectRole: role,
            procedurePath: path,
          }),
        ).not.toThrow();
      }
    },
  );

  it("does not apply to Langfuse instance admins", () => {
    expect(() =>
      throwIfSecurityRoleBlocked({
        projectRole: Role.SECURITY,
        procedurePath: "traces.byId",
        isInstanceAdmin: true,
      }),
    ).not.toThrow();
  });
});

describe("Security Analyst scopes", () => {
  it("has exactly guardrail read, audit log read and project read", () => {
    expect([...projectRoleAccessRights.SECURITY].sort()).toEqual(
      [
        "project:read",
        "projectAuditLogs:read",
        "projectGuardrails:read",
      ].sort(),
    );
  });

  it("cannot read trace content, use the AI assistant, or change the project", () => {
    for (const scope of [
      "projectData:read",
      "projectAiAssistant:use",
      "project:update",
    ] as const) {
      expect(projectRoleAccessRights.SECURITY).not.toContain(scope);
    }
  });

  it.each([Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER])(
    "%s keeps projectData:read (no change for existing roles)",
    (role) => {
      expect(projectRoleAccessRights[role]).toContain("projectData:read");
    },
  );
});
