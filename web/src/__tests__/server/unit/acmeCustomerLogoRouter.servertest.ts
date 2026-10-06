import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";

const audit = vi.fn();
vi.mock("@/src/features/audit-logs/auditLog", () => ({
  auditLog: (...args: unknown[]) => audit(...args),
}));

const { acmeCustomerLogoRouter } =
  await import("@/src/features/acme-enhancements/server/acmeCustomerLogoRouter");

// CHG-2026-124 (ADR-0025): who may change the organization's logo, what is
// stored, and what the audit log records. Every member reads it; only a role
// with organization:update (Owner, Admin) uploads or removes it, and a refused
// call never reaches the database.

const ORG = "org-customer-logo";
const router = createTRPCRouter({ acmeCustomerLogo: acmeCustomerLogoRouter });

function sessionFor(role: string, orgId = ORG): Session {
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
        { id: orgId, name: "org", role, plan: "oss", projects: [] },
      ],
    },
    environment: {
      enableExperimentalFeatures: false,
      selfHostedInstancePlan: "oss",
    },
  } as unknown as Session;
}

type Row = Record<string, unknown> & { orgId: string; data: Buffer };

/** An in-memory stand-in for the one table the router uses. */
function fakeDb() {
  const rows = new Map<string, Row>();
  const touched = vi.fn();
  const pick = (row: Row, select?: Record<string, boolean>) =>
    select
      ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
      : row;
  const table = {
    findUnique: async (a: {
      where: { orgId: string };
      select?: Record<string, boolean>;
    }) => {
      touched("findUnique");
      const row = rows.get(a.where.orgId);
      return row ? pick(row, a.select) : null;
    },
    upsert: async (a: {
      where: { orgId: string };
      create: Row;
      update: Partial<Row>;
      select?: Record<string, boolean>;
    }) => {
      touched("upsert");
      const now = new Date("2026-10-06T21:00:00.000Z");
      const prev = rows.get(a.where.orgId);
      const row = prev
        ? ({ ...prev, ...a.update, updatedAt: now } as Row)
        : ({ ...a.create, updatedAt: now } as Row);
      rows.set(a.where.orgId, row);
      return pick(row, a.select);
    },
    delete: async (a: { where: { orgId: string } }) => {
      touched("delete");
      rows.delete(a.where.orgId);
    },
  };
  return { db: { acmeOrganizationLogo: table }, rows, touched };
}

function callerFor(role: string, db: object, orgId = ORG) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role, orgId),
    headers: {},
  });
  return router.createCaller({ ...ctx, prisma: db as typeof ctx.prisma })
    .acmeCustomerLogo;
}

/** A PNG header for a 240 x 64 image; the router checks only the header. */
function pngBase64(): string {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, 240);
  new DataView(b.buffer).setUint32(20, 64);
  return Buffer.from(b).toString("base64");
}

const UPLOAD = { orgId: ORG, contentType: "image/png" as const };

describe("customer logo router (ADR-0025)", () => {
  beforeEach(() => audit.mockClear());

  it.each(["MEMBER", "VIEWER", "NONE", "SECURITY", "ANALYST", "AUDITOR"])(
    "refuses an upload or removal by %s before touching the database",
    async (role) => {
      const { db, touched } = fakeDb();
      const caller = callerFor(role, db);
      await expect(
        caller.upload({ ...UPLOAD, dataBase64: pngBase64() }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.remove({ orgId: ORG })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(touched).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it("refuses someone who is not a member of the organization", async () => {
    const { db } = fakeDb();
    await expect(
      callerFor("OWNER", db, "another-org").get({ orgId: ORG }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(["OWNER", "ADMIN"])(
    "lets %s upload, stores the bytes and audits metadata only",
    async (role) => {
      const { db, rows } = fakeDb();
      const after = await callerFor(role, db).upload({
        ...UPLOAD,
        dataBase64: pngBase64(),
      });
      expect(after).toMatchObject({
        contentType: "image/png",
        width: 240,
        height: 64,
        sizeBytes: 64,
      });
      expect(rows.get(ORG)?.data.length).toBe(64);
      expect(rows.get(ORG)?.updatedBy).toBe(`user-${role}`);
      expect(audit).toHaveBeenCalledTimes(1);
      const entry = audit.mock.calls[0]![0] as Record<string, unknown>;
      expect(entry).toMatchObject({
        resourceType: "acmeOrganizationLogo",
        resourceId: ORG,
        action: "upload",
      });
      expect(JSON.stringify(entry.after)).toMatch(/"sha256":"[0-9a-f]{64}"/);
      expect(JSON.stringify(entry)).not.toContain(pngBase64());
      expect(entry.after).not.toHaveProperty("data");
    },
  );

  it("records a second upload as a replacement, with what it replaced", async () => {
    const { db } = fakeDb();
    const caller = callerFor("ADMIN", db);
    await caller.upload({ ...UPLOAD, dataBase64: pngBase64() });
    await caller.upload({ ...UPLOAD, dataBase64: pngBase64() });
    const second = audit.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.action).toBe("replace");
    expect(second.before).toMatchObject({ width: 240, height: 64 });
  });

  it("refuses a file whose bytes are not the declared type, storing nothing", async () => {
    const { db, rows } = fakeDb();
    await expect(
      callerFor("OWNER", db).upload({
        orgId: ORG,
        contentType: "image/jpeg",
        dataBase64: pngBase64(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rows.size).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an SVG at the input, before any check runs", async () => {
    const { db } = fakeDb();
    await expect(
      callerFor("OWNER", db).upload({
        orgId: ORG,
        contentType: "image/svg+xml" as "image/png",
        dataBase64: Buffer.from("<svg/>").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("serves the logo to every member as a data URL", async () => {
    const { db } = fakeDb();
    await callerFor("OWNER", db).upload({ ...UPLOAD, dataBase64: pngBase64() });
    const logo = await callerFor("VIEWER", db).get({ orgId: ORG });
    expect(logo?.src).toBe(`data:image/png;base64,${pngBase64()}`);
    expect(logo).toMatchObject({ width: 240, height: 64, sizeBytes: 64 });
  });

  it("removes the logo and audits the removal; removing none is a no-op", async () => {
    const { db, rows } = fakeDb();
    const caller = callerFor("ADMIN", db);
    expect(await caller.remove({ orgId: ORG })).toEqual({ removed: false });
    expect(audit).not.toHaveBeenCalled();
    await caller.upload({ ...UPLOAD, dataBase64: pngBase64() });
    audit.mockClear();
    expect(await caller.remove({ orgId: ORG })).toEqual({ removed: true });
    expect(rows.size).toBe(0);
    expect(audit.mock.calls[0]![0]).toMatchObject({
      resourceType: "acmeOrganizationLogo",
      action: "remove",
    });
    expect(await caller.get({ orgId: ORG })).toBeNull();
  });
});
