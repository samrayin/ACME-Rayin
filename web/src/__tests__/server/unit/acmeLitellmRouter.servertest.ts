import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { acmeLitellmRouter } from "@/src/features/acme-enhancements/server/litellm/acmeLitellmRouter";
import { projectRoleAccessRights } from "@langfuse/shared";
import { isAllowedForSecurityRole } from "@/src/features/rbac/server/securityRoleAllowList";

// ADR-0003 §3.3 / CHG-2026-005: CAIRO RBAC is authoritative. These are the
// DENIAL paths. No database and no LiteLLM: every denied call must be refused
// before either is touched, so both are rigged to fail the test if reached.

const PROJECT = "proj-litellm-rbac";
const ORG = "org-litellm-rbac";

// Mounted under its real name: the Security Analyst allow-list keys off the
// full procedure path ("acmeLitellm.keys"), exactly as in root.ts.
const router = createTRPCRouter({ acmeLitellm: acmeLitellmRouter });

function sessionFor(role: string, orgRole = role): Session {
  return {
    expires: "1",
    user: {
      id: `user-${role}`,
      name: role,
      canCreateOrganizations: false,
      admin: false,
      featureFlags: {},
      organizations: [
        {
          id: ORG,
          name: "org",
          role: orgRole,
          plan: "oss",
          projects: [
            {
              id: PROJECT,
              name: "p",
              role,
              deletedAt: null,
              retentionDays: null,
            },
          ],
        },
      ],
    },
    environment: {
      enableExperimentalFeatures: false,
      selfHostedInstancePlan: "oss",
    },
  } as unknown as Session;
}

const touched = vi.fn();
const explodingPrisma = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      touched(String(prop));
      throw new Error(`database touched: ${String(prop)}`);
    },
  },
);

function callerFor(role: string, orgRole?: string) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role, orgRole),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: explodingPrisma as typeof ctx.prisma,
  }).acmeLitellm;
}

const LIMITS = {
  models: [],
  maxBudget: null,
  budgetDuration: null,
  rpmLimit: null,
  tpmLimit: null,
};

const MUTATIONS: Array<
  [string, (c: ReturnType<typeof callerFor>) => Promise<unknown>]
> = [
  [
    "createKey",
    (c) => c.createKey({ projectId: PROJECT, displayName: "k", ...LIMITS }),
  ],
  [
    "updateKey",
    (c) => c.updateKey({ projectId: PROJECT, keyId: "k", ...LIMITS }),
  ],
  ["revokeKey", (c) => c.revokeKey({ projectId: PROJECT, keyId: "k" })],
  ["rotateKey", (c) => c.rotateKey({ projectId: PROJECT, keyId: "k" })],
  [
    "resolvePartialRotation",
    (c) => c.resolvePartialRotation({ projectId: PROJECT, keyId: "k" }),
  ],
  [
    "createTeam",
    (c) => c.createTeam({ projectId: PROJECT, teamAlias: "t", ...LIMITS }),
  ],
  [
    "updateTeam",
    (c) => c.updateTeam({ projectId: PROJECT, teamId: "t", ...LIMITS }),
  ],
  ["deleteTeam", (c) => c.deleteTeam({ projectId: PROJECT, teamId: "t" })],
];

const READS: Array<
  [string, (c: ReturnType<typeof callerFor>) => Promise<unknown>]
> = [
  ["keys", (c) => c.keys({ projectId: PROJECT })],
  ["teams", (c) => c.teams({ projectId: PROJECT })],
  ["catalogue", (c) => c.catalogue({ projectId: PROJECT })],
  [
    "spend",
    (c) =>
      c.spend({
        projectId: PROJECT,
        startDate: "2026-09-01",
        endDate: "2026-09-19",
      }),
  ],
  ["unmanagedKeys", (c) => c.unmanagedKeys({ projectId: PROJECT })],
];

describe("acmeLitellm RBAC", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    flag: envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED,
    url: envRecord.LITELLM_BASE_URL,
    key: envRecord.LITELLM_MASTER_KEY,
    logs: envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED,
  };
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "true";
    // Unroutable on purpose. No denied call may get as far as using it.
    envRecord.LITELLM_BASE_URL = "http://litellm.invalid:4000";
    envRecord.LITELLM_MASTER_KEY = "sk-test-master-key-must-not-leak";
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "true";
    touched.mockClear();
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async () => {
      throw new Error(
        "LiteLLM was called by a request that should have been denied",
      );
    });
  });

  afterEach(() => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = original.flag;
    envRecord.LITELLM_BASE_URL = original.url;
    envRecord.LITELLM_MASTER_KEY = original.key;
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = original.logs;
  });

  it("role map: CUD is owner/admin only; logs are owner/admin/security; read excludes security", () => {
    const has = (role: keyof typeof projectRoleAccessRights, scope: string) =>
      (projectRoleAccessRights[role] as string[]).includes(scope);
    expect(
      ["OWNER", "ADMIN", "MEMBER", "VIEWER", "NONE", "SECURITY"].filter((r) =>
        has(r as never, "llmGateway:CUD"),
      ),
    ).toEqual(["OWNER", "ADMIN"]);
    // ADR-0011 §11.5: MEMBER (Prompt Analyst) sees the Spend tab only.
    expect(
      ["OWNER", "ADMIN", "MEMBER", "VIEWER", "NONE", "SECURITY"].filter((r) =>
        has(r as never, "llmGateway:read"),
      ),
    ).toEqual(["OWNER", "ADMIN", "VIEWER"]);
    expect(
      ["OWNER", "ADMIN", "MEMBER", "VIEWER", "NONE", "SECURITY"].filter((r) =>
        has(r as never, "llmGatewayLogs:read"),
      ),
    ).toEqual(["OWNER", "ADMIN", "SECURITY"]);
  });

  describe.each(["MEMBER", "VIEWER", "NONE"])("%s", (role) => {
    it.each(MUTATIONS)("cannot %s", async (_name, call) => {
      await expect(call(callerFor(role))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(touched).not.toHaveBeenCalled();
    });

    it("cannot read the append-only record", async () => {
      await expect(
        callerFor(role).events({ projectId: PROJECT }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(touched).not.toHaveBeenCalled();
    });
  });

  it("NONE cannot read anything", async () => {
    for (const [, call] of READS) {
      await expect(call(callerFor("NONE"))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("Security Analyst", () => {
    it("allow-list holds exactly the four read-only record procedures for this router", () => {
      const all = [...MUTATIONS, ...READS]
        .map(([n]) => n)
        .concat(["status", "events", "requestLogs", "reconcileStatus"]);
      expect(
        all.filter((n) => isAllowedForSecurityRole(`acmeLitellm.${n}`)).sort(),
      ).toEqual(["events", "reconcileStatus", "requestLogs", "status"]);
    });

    it.each([...MUTATIONS, ...READS])(
      "is blocked from %s",
      async (_name, call) => {
        await expect(call(callerFor("SECURITY"))).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(touched).not.toHaveBeenCalled();
      },
    );

    it("may read the append-only record (gets past RBAC, reaches the database)", async () => {
      // The rigged database throws, which tRPC reports as an internal error.
      // What matters: it is NOT a FORBIDDEN, and the query was attempted.
      await expect(
        callerFor("SECURITY").events({ projectId: PROJECT }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(touched).toHaveBeenCalledWith("acmeLitellmEvent");
    });
  });

  it("a user who is not a member of the project is refused outright", async () => {
    const ctx = createInnerTRPCContext({
      session: sessionFor("OWNER"),
      headers: {},
    });
    const caller = router.createCaller({
      ...ctx,
      prisma: explodingPrisma as typeof ctx.prisma,
    }).acmeLitellm;
    await expect(
      caller.keys({ projectId: "some-other-project" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unmanaged keys: a project ADMIN who is not an organisation OWNER is refused", async () => {
    await expect(
      callerFor("ADMIN", "ADMIN").unmanagedKeys({ projectId: PROJECT }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("feature flag off", () => {
    beforeEach(() => {
      envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "false";
    });

    it.each([...MUTATIONS, ...READS])(
      "an OWNER cannot %s",
      async (_name, call) => {
        await expect(call(callerFor("OWNER"))).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(touched).not.toHaveBeenCalled();
      },
    );

    it("status reports it as off without calling LiteLLM", async () => {
      await expect(
        callerFor("OWNER").status({ projectId: PROJECT }),
      ).resolves.toMatchObject({
        enabled: false,
        reachable: null,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("status never returns the master key or the gateway URL", async () => {
    fetchSpy.mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    const out = await callerFor("VIEWER").status({ projectId: PROJECT });
    expect(out).toEqual({
      enabled: true,
      configured: true,
      auditConfigured: expect.any(Boolean),
      reachable: true,
      requestLogsEnabled: true,
      // CHG-2026-056: console model management switch (a boolean, no secret).
      modelManagementEnabled: expect.any(Boolean),
    });
    expect(JSON.stringify(out)).not.toContain("sk-test-master");
    expect(JSON.stringify(out)).not.toContain("litellm.invalid");
  });
  describe("gateway request logs (CHG-2026-008)", () => {
    const LOG_READS: Array<
      [string, (c: ReturnType<typeof callerFor>) => Promise<unknown>]
    > = [
      ["requestLogs", (c) => c.requestLogs({ projectId: PROJECT })],
      ["reconcileStatus", (c) => c.reconcileStatus({ projectId: PROJECT })],
    ];

    describe.each(["MEMBER", "VIEWER", "NONE"])("%s", (role) => {
      it.each(LOG_READS)("cannot read %s", async (_name, call) => {
        await expect(call(callerFor(role))).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(touched).not.toHaveBeenCalled();
      });
    });

    it.each(LOG_READS)(
      "the Security Analyst gets past RBAC for %s",
      async (_name, call) => {
        await expect(call(callerFor("SECURITY"))).rejects.toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
        });
        expect(touched).toHaveBeenCalled();
      },
    );

    it("requests from keys CAIRO did not issue: refused unless the caller is an organisation OWNER", async () => {
      for (const [role, orgRole] of [
        ["ADMIN", "ADMIN"],
        ["SECURITY", "SECURITY"],
        ["OWNER", "ADMIN"],
      ] as const) {
        await expect(
          callerFor(role, orgRole).requestLogs({
            projectId: PROJECT,
            scope: "unattributed",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(touched).not.toHaveBeenCalled();
      // An organisation owner gets through to the database.
      await expect(
        callerFor("OWNER", "OWNER").requestLogs({
          projectId: PROJECT,
          scope: "unattributed",
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    });

    it.each(LOG_READS)(
      "an OWNER cannot read %s while the request-log flag is off",
      async (_name, call) => {
        envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "false";
        await expect(call(callerFor("OWNER"))).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
        });
        expect(touched).not.toHaveBeenCalled();
      },
    );

    it("the project filter comes from the checked input, not from a row", async () => {
      const seen: unknown[] = [];
      const ctx = createInnerTRPCContext({
        session: sessionFor("OWNER"),
        headers: {},
      });
      const prismaSpy = {
        acmeLitellmRequestLog: {
          findMany: async (a: unknown) => {
            seen.push(a);
            return [];
          },
          count: async () => 0,
        },
        acmeLitellmKey: { findMany: async () => [] },
      };
      const caller = router.createCaller({
        ...ctx,
        prisma: prismaSpy as unknown as typeof ctx.prisma,
      }).acmeLitellm;
      await caller.requestLogs({ projectId: PROJECT });
      expect(seen[0]).toMatchObject({ where: { projectId: PROJECT } });
    });
  });
});
