import { describe, it, expect, afterEach } from "vitest";
import type { Session } from "next-auth";
import { Role } from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { eyeonShellRouter } from "@/src/features/acme-enhancements/server/eyeonShellRouter";

// CHG-2026-135 (ADR-0026 §12.2): the console asks the server whether the
// EYEON navigation rail is on. CAIRO_EYEON_RAIL_ENABLED is server-only and off
// by default. Every signed-in role may ask, the content-free ones included
// (the rail is the shell, not project data); a visitor who is not signed in
// may not. The answer reads nothing from the database.

const router = createTRPCRouter({ eyeonShell: eyeonShellRouter });
const envRecord = env as unknown as Record<string, string | undefined>;

const explodingPrisma = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      throw new Error(`database touched: ${String(prop)}`);
    },
  },
);

function sessionFor(role: Role): Session {
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
          id: "org-shell",
          name: "org",
          role,
          plan: "oss",
          projects: [
            {
              id: "proj-shell",
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

function callerFor(session: Session | null) {
  const ctx = createInnerTRPCContext({ session, headers: {} });
  return router.createCaller({
    ...ctx,
    prisma: explodingPrisma as typeof ctx.prisma,
  }).eyeonShell;
}

describe("eyeonShell.railStatus (CHG-2026-135)", () => {
  const original = envRecord.CAIRO_EYEON_RAIL_ENABLED;
  afterEach(() => {
    envRecord.CAIRO_EYEON_RAIL_ENABLED = original;
  });

  it.each(["false", undefined])(
    "is off unless set to true (here: %s)",
    async (value) => {
      envRecord.CAIRO_EYEON_RAIL_ENABLED = value;
      await expect(
        callerFor(sessionFor(Role.OWNER)).railStatus(),
      ).resolves.toEqual({ enabled: false });
    },
  );

  it.each([
    Role.OWNER,
    Role.ADMIN,
    Role.MEMBER,
    Role.VIEWER,
    Role.SECURITY,
    Role.ANALYST,
    Role.AUDITOR,
  ])("tells %s when it is on, reading nothing else", async (role) => {
    envRecord.CAIRO_EYEON_RAIL_ENABLED = "true";
    await expect(callerFor(sessionFor(role)).railStatus()).resolves.toEqual({
      enabled: true,
    });
  });

  it("refuses a visitor who is not signed in", async () => {
    envRecord.CAIRO_EYEON_RAIL_ENABLED = "true";
    await expect(callerFor(null).railStatus()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
