import { appRouter } from "@/src/server/api/root";
import { createInnerTRPCContext } from "@/src/server/api/trpc";
import { prisma, type Role } from "@langfuse/shared/src/db";
import { createOrgProjectAndApiKey } from "@langfuse/shared/src/server";
import type { Session } from "next-auth";

// CHG-2026-101 / ADR-0011: acmeAuditLogs.all returns content to the full
// roles and metadata only to the content-free roles, decided on the server.

const __orgIds: string[] = [];

async function prepare(projectRole: Role) {
  const { project, org } = await createOrgProjectAndApiKey();
  __orgIds.push(org.id);

  const session: Session = {
    expires: "1",
    user: {
      id: "user-1",
      canCreateOrganizations: false,
      name: "Demo User",
      admin: false,
      organizations: [
        {
          id: org.id,
          name: org.name,
          role: "MEMBER",
          plan: "cloud:hobby",
          cloudConfig: undefined,
          metadata: {},
          aiFeaturesEnabled: false,
          aiTelemetryEnabled: false,
          projects: [
            {
              id: project.id,
              role: projectRole,
              retentionDays: 30,
              deletedAt: null,
              hasTraces: false,
              name: project.name,
              metadata: {},
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
      featureFlags: {
        excludeClickhouseRead: false,
        templateFlag: false,
        searchBar: true,
        v4BetaToggleVisible: false,
        observationEvals: false,
        experimentsV4Enabled: false,
      },
    },
    environment: {
      enableExperimentalFeatures: false,
      selfHostedInstancePlan: "cloud:hobby",
    },
  };

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      projectId: project.id,
      resourceType: "prompt",
      resourceId: "prompt-1",
      action: "update",
      before: JSON.stringify({
        id: "prompt-1",
        name: "greeting",
        version: 1,
        prompt: "secret prompt text v1",
      }),
      after: JSON.stringify({
        id: "prompt-1",
        name: "greeting",
        version: 2,
        prompt: "secret prompt text v2",
      }),
    },
  });

  const ctx = createInnerTRPCContext({ session, headers: {} });
  return { project, caller: appRouter.createCaller({ ...ctx, prisma }) };
}

describe("acmeAuditLogs.all content masking (CHG-2026-101)", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: __orgIds } } });
  });

  // MEMBER and VIEWER hold no projectAuditLogs:read and are refused before masking.
  it.each(["OWNER", "ADMIN"] as const)(
    "returns full states to %s",
    async (role) => {
      const { project, caller } = await prepare(role);
      const res = await caller.acmeAuditLogs.all({
        projectId: project.id,
        page: 0,
        limit: 50,
      });

      expect(res.masked).toBe(false);
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.after).toContain("secret prompt text v2");
    },
  );

  it.each(["SECURITY", "AUDITOR"] as const)(
    "masks content fields for %s",
    async (role) => {
      const { project, caller } = await prepare(role);
      const res = await caller.acmeAuditLogs.all({
        projectId: project.id,
        page: 0,
        limit: 50,
      });

      expect(res.masked).toBe(true);
      expect(res.data).toHaveLength(1);
      const row = res.data[0]!;
      expect(JSON.stringify(row)).not.toContain("secret prompt text");
      expect(JSON.parse(row.after!)).toEqual({
        id: "prompt-1",
        name: "greeting",
        version: 2,
        prompt: "[masked: changed]",
      });
    },
  );

  it("still refuses the Business Analyst, whose allow-list lacks the audit log", async () => {
    const { project, caller } = await prepare("ANALYST");
    await expect(
      caller.acmeAuditLogs.all({ projectId: project.id, page: 0, limit: 50 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
