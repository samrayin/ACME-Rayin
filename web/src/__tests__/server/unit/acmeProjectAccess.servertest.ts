import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { Role, projectRoleAccessRights } from "@langfuse/shared";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import {
  applyProjectAccessCeiling,
  isScopeSubset,
  isValidCeiling,
  validCeilingsFor,
} from "@/src/features/acme-enhancements/projectAccess/projectAccessPolicy";

const audit = vi.fn();
vi.mock("@/src/features/audit-logs/server", () => ({
  auditLog: (...args: unknown[]) => audit(...args),
}));

const { acmeProjectAccessRouter } =
  await import("@/src/features/acme-enhancements/server/acmeProjectAccessRouter");

// CHG-2026-059 part c / ADR-0011 section 5. The project access policy may
// only ever NARROW a person's access. These tests pin that for every pair of
// roles, and check the router refuses anything that would widen it.

const ROLES = Object.values(Role);
const scopes = (role: Role) =>
  new Set(projectRoleAccessRights[role] as readonly string[]);
const isSubset = (a: Set<string>, b: Set<string>) =>
  [...a].every((x) => b.has(x));

describe("project access policy: properties over every role pair (§8)", () => {
  it.each(ROLES)(
    "org role %s: a ceiling is accepted exactly when its scopes are a subset",
    (orgRole) => {
      for (const ceiling of ROLES) {
        const expected =
          ceiling === Role.NONE || isSubset(scopes(ceiling), scopes(orgRole));
        expect(isValidCeiling(orgRole, ceiling)).toBe(expected);
      }
    },
  );

  it.each(ROLES)(
    "org role %s: the effective role never has a scope the org role or resolved role lacks",
    (orgRole) => {
      for (const resolvedRole of ROLES) {
        for (const ceiling of [...ROLES, undefined]) {
          const effective = applyProjectAccessCeiling({
            resolvedRole,
            orgRole,
            ceiling,
          });
          expect(isSubset(scopes(effective), scopes(resolvedRole))).toBe(true);
          if (ceiling !== undefined)
            expect(isSubset(scopes(effective), scopes(orgRole))).toBe(true);
        }
      }
    },
  );

  it("no ceiling leaves the resolved role unchanged", () => {
    for (const role of ROLES)
      expect(
        applyProjectAccessCeiling({
          resolvedRole: role,
          orgRole: role,
          ceiling: undefined,
        }),
      ).toBe(role);
  });

  it("NONE hides the project: it has no project:read, so the session drops it", () => {
    expect(
      applyProjectAccessCeiling({
        resolvedRole: Role.OWNER,
        orgRole: Role.OWNER,
        ceiling: Role.NONE,
      }),
    ).toBe(Role.NONE);
    expect(scopes(Role.NONE).has("project:read")).toBe(false);
  });

  it("a valid ceiling becomes the effective role", () => {
    expect(
      applyProjectAccessCeiling({
        resolvedRole: Role.ADMIN,
        orgRole: Role.ADMIN,
        ceiling: Role.VIEWER,
      }),
    ).toBe(Role.VIEWER);
  });

  it("a ceiling that no longer fits the org role fails closed to NONE", () => {
    // e.g. the org role was lowered to Business Analyst after a Viewer
    // limit was set. Viewer can read content; Business Analyst cannot.
    expect(isScopeSubset(Role.VIEWER, Role.ANALYST)).toBe(false);
    expect(
      applyProjectAccessCeiling({
        resolvedRole: Role.ANALYST,
        orgRole: Role.ANALYST,
        ceiling: Role.VIEWER,
      }),
    ).toBe(Role.NONE);
  });

  it("offered ceilings: NONE first, include the org role itself, never a wider role", () => {
    for (const orgRole of ROLES) {
      const offered = validCeilingsFor(orgRole);
      expect(offered[0]).toBe(Role.NONE);
      if (orgRole !== Role.NONE) expect(offered).toContain(orgRole);
      for (const role of offered)
        expect(isValidCeiling(orgRole, role)).toBe(true);
    }
    expect(validCeilingsFor(Role.VIEWER)).not.toContain(Role.MEMBER);
    // ADR-0011 §11 Q7: Viewer has the gateway Spend tab only, like Prompt
    // Analyst, so Viewer is a narrowing of Prompt Analyst.
    expect(validCeilingsFor(Role.MEMBER)).toContain(Role.VIEWER);
    expect(validCeilingsFor(Role.MEMBER)).not.toContain(Role.ADMIN);
  });
});

// ---------------------------------------------------------------------------
// Router

const ORG = "org-pa";
const router = createTRPCRouter({ acmeProjectAccess: acmeProjectAccessRouter });

function sessionFor(orgRole: Role, userId = "caller"): Session {
  return {
    expires: "1",
    user: {
      id: userId,
      name: "caller",
      canCreateOrganizations: false,
      admin: false,
      featureFlags: {},
      organizations: [
        { id: ORG, name: "org", role: orgRole, plan: "oss", projects: [] },
      ],
    },
    environment: {
      enableExperimentalFeatures: false,
      selfHostedInstancePlan: "oss",
    },
  } as unknown as Session;
}

type FakeDb = {
  upsert: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  prisma: unknown;
};

function fakeDb(targetRole: Role, existing: unknown = null): FakeDb {
  const upsert = vi.fn(async ({ create }: { create: object }) => ({
    id: "pa-1",
    ...create,
  }));
  const remove = vi.fn(async () => ({}));
  return {
    upsert,
    remove,
    prisma: {
      organizationMembership: {
        findUnique: vi.fn(async () => ({ id: "om-target", role: targetRole })),
      },
      project: { findFirst: vi.fn(async () => ({ id: "proj-1" })) },
      acmeProjectAccess: {
        findUnique: vi.fn(async () => existing),
        upsert,
        delete: remove,
      },
    },
  };
}

function callerFor(orgRole: Role, prisma: unknown) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(orgRole),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: prisma as typeof ctx.prisma,
  }).acmeProjectAccess;
}

const TARGET = { orgId: ORG, projectId: "proj-1", userId: "target" };

describe("project access router", () => {
  beforeEach(() => audit.mockClear());

  it.each([
    Role.MEMBER,
    Role.VIEWER,
    Role.SECURITY,
    Role.ANALYST,
    Role.AUDITOR,
  ])("%s cannot read or change project access", async (role) => {
    const db = fakeDb(Role.MEMBER);
    const caller = callerFor(role, db.prisma);
    await expect(caller.overview({ orgId: ORG })).rejects.toThrow(
      /FORBIDDEN|Forbidden/,
    );
    await expect(
      caller.set({ ...TARGET, ceilingRole: Role.VIEWER }),
    ).rejects.toThrow(/Forbidden/);
    await expect(caller.remove(TARGET)).rejects.toThrow(/Forbidden/);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("refuses a limit that would widen access, before writing", async () => {
    const db = fakeDb(Role.MEMBER);
    await expect(
      callerFor(Role.ADMIN, db.prisma).set({
        ...TARGET,
        ceilingRole: Role.ADMIN,
      }),
    ).rejects.toThrow(/can only narrow/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refuses a sideways limit (Auditor on a Prompt Analyst)", async () => {
    const db = fakeDb(Role.MEMBER);
    await expect(
      callerFor(Role.ADMIN, db.prisma).set({
        ...TARGET,
        ceilingRole: Role.AUDITOR,
      }),
    ).rejects.toThrow(/can only narrow/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("an Admin cannot limit an Owner", async () => {
    const db = fakeDb(Role.OWNER);
    await expect(
      callerFor(Role.ADMIN, db.prisma).set({
        ...TARGET,
        ceilingRole: Role.VIEWER,
      }),
    ).rejects.toThrow(/higher than your own/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("nobody can limit themselves", async () => {
    const db = fakeDb(Role.ADMIN);
    await expect(
      callerFor(Role.OWNER, db.prisma).set({
        ...TARGET,
        userId: "caller",
        ceilingRole: Role.NONE,
      }),
    ).rejects.toThrow(/yourself/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("a narrowing limit is saved and audited", async () => {
    const db = fakeDb(Role.ADMIN);
    await callerFor(Role.OWNER, db.prisma).set({
      ...TARGET,
      ceilingRole: Role.MEMBER,
    });
    expect(db.upsert).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "acmeProjectAccess",
        action: "create",
      }),
    );
  });

  it("NONE is always accepted", async () => {
    const db = fakeDb(Role.ANALYST);
    await callerFor(Role.ADMIN, db.prisma).set({
      ...TARGET,
      ceilingRole: Role.NONE,
    });
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });

  it("removing a limit is audited", async () => {
    const db = fakeDb(Role.MEMBER, { id: "pa-1", ceilingRole: Role.VIEWER });
    await expect(
      callerFor(Role.ADMIN, db.prisma).remove(TARGET),
    ).resolves.toEqual({ removed: true });
    expect(db.remove).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete" }),
    );
  });
});

// CHG-2026-072: the project Members table reads the limits set in a project.
describe("project access router: forProject (Members table)", () => {
  const PROJECT_ID = "proj-members";

  function projectCaller(role: Role, rows: unknown[] = []) {
    const session = {
      expires: "1",
      user: {
        id: "caller",
        admin: false,
        featureFlags: {},
        organizations: [
          {
            id: ORG,
            name: "org",
            role,
            plan: "oss",
            projects: [{ id: PROJECT_ID, name: "p", role, deletedAt: null }],
          },
        ],
      },
      environment: {},
    } as unknown as Session;
    const findMany = vi.fn(async () => rows);
    const ctx = createInnerTRPCContext({ session, headers: {} });
    return {
      findMany,
      caller: router.createCaller({
        ...ctx,
        prisma: {
          acmeProjectAccess: { findMany },
        } as unknown as typeof ctx.prisma,
      }).acmeProjectAccess,
    };
  }

  it.each([Role.OWNER, Role.ADMIN, Role.AUDITOR])(
    "%s reads the limits in the project",
    async (role) => {
      const { caller, findMany } = projectCaller(role, [
        { userId: "u1", ceilingRole: Role.VIEWER },
      ]);
      const out = await caller.forProject({ projectId: PROJECT_ID });
      expect(out.limits).toEqual([{ userId: "u1", ceilingRole: Role.VIEWER }]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT_ID } }),
      );
    },
  );

  it.each([Role.ANALYST, Role.SECURITY])(
    "%s cannot read the limits",
    async (role) => {
      const { caller, findMany } = projectCaller(role);
      await expect(
        caller.forProject({ projectId: PROJECT_ID }),
      ).rejects.toThrow();
      expect(findMany).not.toHaveBeenCalled();
    },
  );
});
