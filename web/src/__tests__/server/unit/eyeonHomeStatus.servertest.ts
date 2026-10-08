import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { Role } from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { eyeonOverviewRouter } from "@/src/features/acme-enhancements/server/eyeonOverviewRouter";
import { isAllowedForRole } from "@/src/features/rbac/server/securityRoleAllowList";

// CHG-2026-136 (ADR-0028): EYEON Home's flag, as the home page reads it. It
// is on only while CAIRO_EYEON_HOME_ENABLED and CAIRO_EYEON_OVERVIEW_ENABLED
// are both on; it uses the overview's access rule, refuses every other role
// before anything is read, and never reads the database.

const PROJECT = "proj-eyeon-home";
const ORG = "org-eyeon-home";

const router = createTRPCRouter({ eyeonOverview: eyeonOverviewRouter });

function sessionFor(role: string): Session {
  return {
    expires: "1",
    user: {
      id: `user-${role}`,
      name: role,
      email: null,
      canCreateOrganizations: false,
      admin: false,
      featureFlags: {},
      organizations: [
        {
          id: ORG,
          name: "org",
          role,
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

function homeStatusFor(role: string) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role),
    headers: {},
  });
  return router
    .createCaller({ ...ctx, prisma: explodingPrisma as typeof ctx.prisma })
    .eyeonOverview.homeStatus({ projectId: PROJECT });
}

describe("EYEON Home flag: eyeonOverview.homeStatus (CHG-2026-136)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    home: envRecord.CAIRO_EYEON_HOME_ENABLED,
    overview: envRecord.CAIRO_EYEON_OVERVIEW_ENABLED,
  };

  beforeEach(() => {
    envRecord.CAIRO_EYEON_HOME_ENABLED = "true";
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = "true";
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_EYEON_HOME_ENABLED = original.home;
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = original.overview;
  });

  it.each(["OWNER", "ADMIN", "AUDITOR"])(
    "%s, who can open the overview, reads the flag without a database read",
    async (role) => {
      await expect(homeStatusFor(role)).resolves.toEqual({ enabled: true });
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it.each(["MEMBER", "VIEWER", "NONE", "SECURITY", "ANALYST"])(
    "refuses %s, who cannot open the overview, before anything is read",
    async (role) => {
      await expect(homeStatusFor(role)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it("is off by default and while either flag is off: Home stays classic", async () => {
    envRecord.CAIRO_EYEON_HOME_ENABLED = undefined;
    await expect(homeStatusFor("OWNER")).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_HOME_ENABLED = "false";
    await expect(homeStatusFor("OWNER")).resolves.toEqual({ enabled: false });
    // EYEON Home needs the overview: Home on with the overview off is off.
    envRecord.CAIRO_EYEON_HOME_ENABLED = "true";
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = "false";
    await expect(homeStatusFor("ADMIN")).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = undefined;
    await expect(homeStatusFor("AUDITOR")).resolves.toEqual({
      enabled: false,
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("does not change the overview's own status", async () => {
    envRecord.CAIRO_EYEON_HOME_ENABLED = "false";
    const ctx = createInnerTRPCContext({
      session: sessionFor("OWNER"),
      headers: {},
    });
    const caller = router.createCaller({
      ...ctx,
      prisma: explodingPrisma as typeof ctx.prisma,
    });
    await expect(
      caller.eyeonOverview.status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: true });
  });

  it("is on the Auditor's allow-list only, beside the overview's status", () => {
    expect(isAllowedForRole(Role.AUDITOR, "eyeonOverview.homeStatus")).toBe(
      true,
    );
    expect(isAllowedForRole(Role.SECURITY, "eyeonOverview.homeStatus")).toBe(
      false,
    );
    expect(isAllowedForRole(Role.ANALYST, "eyeonOverview.homeStatus")).toBe(
      false,
    );
  });
});
