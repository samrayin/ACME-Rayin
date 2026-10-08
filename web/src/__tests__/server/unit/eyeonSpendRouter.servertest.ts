import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import { AcmeLitellmKeyStatus, Role } from "@langfuse/shared/src/db";
import { isAllowedForRole } from "@/src/features/rbac/server/securityRoleAllowList";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { eyeonSpendRouter } from "@/src/features/acme-enhancements/server/eyeonSpendRouter";
import { SPEND_MODELS_SHOWN } from "@/src/features/acme-enhancements/server/eyeonSpend";

// CHG-2026-143 (ADR-0027): the EYEON Cost and usage page's access rules and
// reads, against a mocked Prisma. Only the Spend tab's scope opens it, with
// the Business Analyst through its allow-list and the Auditor and Security
// Analyst refused before the database is touched; with the flag off, or
// without the gateway or its request log, nothing is read; no content
// column, token hash, key secret, end user or source address is selected,
// grouped or queried, and no key alias is returned; the number of reads does
// not grow with the data.

const PROJECT = "proj-eyeon-spend";
const ORG = "org-eyeon-spend";
const TOKEN_HASH =
  "9a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b1d3f5a7c9e2b4d6f8a0c2e4b6d8f0a1c";
const END_USER = "end-user-SECRET-id-4711";
const SOURCE_IP = "203.0.113.77";
const FORBIDDEN_COLUMNS = [
  "apiKeyHash",
  "tokenHash",
  "endUser",
  "requesterIp",
  "errorMessage",
  "otelTraceId",
  "litellmCallId",
  "requestId",
];
const FORBIDDEN_SQL =
  /api_key_hash|token_hash|end_user|requester_ip|error_message|traceback|otel_trace_id|litellm_call_id|request_id/;

const router = createTRPCRouter({ eyeonSpend: eyeonSpendRouter });

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

// Rows as a careless query would return them, with columns the page must
// never pass on, so the tests prove the output drops them.
function keyRow(
  lineage: string,
  alias: string,
  generation: number,
  status: AcmeLitellmKeyStatus,
  extra: { team?: string; budget?: number; duration?: string } = {},
) {
  return {
    id: `key-${alias}`,
    lineageId: lineage,
    generation,
    displayName: `App ${lineage}`,
    litellmKeyAlias: alias,
    tokenHash: TOKEN_HASH,
    status,
    litellmTeamId: extra.team ?? null,
    maxBudget: extra.budget ?? null,
    budgetDuration: extra.duration ?? null,
  };
}
const KEY_ROWS = [
  keyRow("lineage-1", "claims-bot-1", 1, AcmeLitellmKeyStatus.ROTATED, {
    team: "team-claims",
  }),
  keyRow("lineage-1", "claims-bot-1-r2", 2, AcmeLitellmKeyStatus.ACTIVE, {
    team: "team-claims",
    budget: 50,
    duration: "30d",
  }),
  keyRow("lineage-2", "hr-bot-1", 1, AcmeLitellmKeyStatus.ACTIVE, {
    budget: 10,
    duration: "1mo",
  }),
  keyRow("lineage-3", "old-bot-1", 1, AcmeLitellmKeyStatus.REVOKED),
];
const ALIASES = KEY_ROWS.map((k) => k.litellmKeyAlias);

const TEAM_ROWS = [
  { id: "team-claims", teamAlias: "Claims team", maxBudget: 999 },
];

function modelRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    model: i === 0 ? "gpt-4o" : `model-${i}`,
    calls: 100 - i,
    failed: i === 0 ? 3 : 0,
    spend: i === 0 ? 30 : 1,
    totalTokens: 10_000,
    models: count,
  })).slice(0, SPEND_MODELS_SHOWN);
}

function bucketRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    bucket: i,
    calls: 10,
    failed: 1,
    spend: 2.5,
    promptTokens: 800,
    completionTokens: 200,
    totalTokens: 1_000,
    cacheHits: 1,
    cacheReported: 5,
    newestReceivedAt: new Date(Date.now() - (count - i) * 60_000).toISOString(),
  }));
}

function monthRows() {
  const today = new Date().toISOString().slice(0, 10);
  return [{ day: today, spend: 12.5, calls: 40 }];
}

type GroupByArgs = {
  by: string[];
  where: Record<string, unknown>;
  [key: string]: unknown;
};

/** The SQL text of a raw query built with Prisma.sql. */
function sqlText(first: unknown): string {
  if (first && typeof first === "object" && "sql" in first)
    return String((first as { sql: string }).sql);
  return String(first);
}

function sqlValues(first: unknown): unknown[] {
  if (first && typeof first === "object" && "values" in first)
    return (first as { values: unknown[] }).values;
  return [];
}

function fakePrisma(opts: { rows?: number; keys?: object[] } = {}) {
  const rows = opts.rows ?? 5;
  return {
    acmeLitellmKey: {
      findMany: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => Promise<unknown[]>
      >(async () => opts.keys ?? KEY_ROWS),
    },
    acmeLitellmTeam: {
      findMany: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => Promise<unknown[]>
      >(async () => TEAM_ROWS),
    },
    acmeLitellmRequestLog: {
      groupBy: vi.fn<(args: GroupByArgs) => Promise<unknown[]>>(async (args) =>
        args.by.includes("keyAlias")
          ? [
              {
                keyAlias: "claims-bot-1",
                _count: { _all: 10 },
                _sum: { spend: 4, totalTokens: 1_000 },
              },
              {
                keyAlias: "claims-bot-1-r2",
                _count: { _all: 20 },
                _sum: { spend: 6, totalTokens: 2_000 },
              },
              {
                keyAlias: "hr-bot-1",
                _count: { _all: 5 },
                _sum: { spend: 12, totalTokens: 500 },
              },
              {
                keyAlias: "old-bot-1",
                _count: { _all: 2 },
                _sum: { spend: 0.5, totalTokens: 100 },
              },
            ].slice(0, rows)
          : [
              { status: "success", _count: { _all: 40 }, _sum: { spend: 8 } },
              { status: "failure", _count: { _all: 2 }, _sum: { spend: null } },
            ],
      ),
    },
    acmeLitellmReconcileRun: {
      findFirst: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => Promise<unknown>
      >(async () => ({
        finishedAt: new Date(Date.now() - 3 * 60_000),
        windowEnd: new Date(Date.now() - 5 * 60_000),
        gapCount: 0,
        errorMessage: "SECRET reconcile failure text",
      })),
    },
    $queryRaw: vi.fn(async (first: unknown) => {
      const sql = sqlText(first);
      if (sql.includes("AS models")) return modelRows(rows);
      if (sql.includes('"newestReceivedAt"')) return bucketRows(rows);
      if (sql.includes("date_trunc('day'")) return monthRows();
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

function callerFor(role: string, db: object = explodingPrisma) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: db as typeof ctx.prisma,
  }).eyeonSpend;
}

const INPUT_7D = { projectId: PROJECT, window: "7d" as const };

async function enabledSummary(
  role: string,
  db = fakePrisma(),
  window: "24h" | "7d" | "30d" = "7d",
) {
  const result = await callerFor(role, db).summary({
    projectId: PROJECT,
    window,
  });
  if (!result.enabled) throw new Error("expected the page to be enabled");
  return { result, db };
}

/** How many times each read was made. */
function readCounts(db: ReturnType<typeof fakePrisma>) {
  return {
    keys: db.acmeLitellmKey.findMany.mock.calls.length,
    teams: db.acmeLitellmTeam.findMany.mock.calls.length,
    groupBy: db.acmeLitellmRequestLog.groupBy.mock.calls.length,
    reconcile: db.acmeLitellmReconcileRun.findFirst.mock.calls.length,
    sql: db.$queryRaw.mock.calls.length,
  };
}

const ALL_READS = { keys: 1, teams: 1, groupBy: 2, reconcile: 1, sql: 3 };
const NO_READS = { keys: 0, teams: 0, groupBy: 0, reconcile: 0, sql: 0 };

describe("EYEON Cost and usage: access and reads (CHG-2026-143)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    page: envRecord.CAIRO_EYEON_SPEND_ENABLED,
    gateway: envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED,
    requestLog: envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED,
  };

  beforeEach(() => {
    envRecord.CAIRO_EYEON_SPEND_ENABLED = "true";
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "true";
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "true";
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_EYEON_SPEND_ENABLED = original.page;
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = original.gateway;
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = original.requestLog;
  });

  // Every role without llmGatewaySpend:read: the Auditor and the Security
  // Analyst (content-free, and on neither list), and no role.
  it.each(["AUDITOR", "SECURITY", "NONE"])(
    "refuses %s before the database is touched, on both queries",
    async (role) => {
      await expect(callerFor(role).summary(INPUT_7D)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        callerFor(role).status({ projectId: PROJECT }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it("is on the Business Analyst's content-free allow-list only", () => {
    for (const path of ["eyeonSpend.summary", "eyeonSpend.status"]) {
      expect(isAllowedForRole(Role.ANALYST, path)).toBe(true);
      expect(isAllowedForRole(Role.AUDITOR, path)).toBe(false);
      expect(isAllowedForRole(Role.SECURITY, path)).toBe(false);
    }
  });

  it("refuses a project the viewer is not a member of, before any read", async () => {
    await expect(
      callerFor("OWNER").summary({
        projectId: "another-project",
        window: "7d",
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED|NOT_FOUND/),
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN", "MEMBER", "VIEWER", "ANALYST"])(
    "lets %s, who holds the Spend tab's scope, open the page",
    async (role) => {
      const { result } = await enabledSummary(role);
      expect(result.period?.totals.spendUsd).toBe(12.5);
      await expect(
        callerFor(role).status({ projectId: PROJECT }),
      ).resolves.toEqual({ enabled: true });
    },
  );

  it("offers links only to pages the person may open", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      const { result } = await enabledSummary(role);
      expect(result.links).toEqual({ applications: true, gatewayHealth: true });
    }
    for (const role of ["MEMBER", "VIEWER", "ANALYST"]) {
      const { result } = await enabledSummary(role);
      expect(result.links).toEqual({
        applications: false,
        gatewayHealth: false,
      });
    }
  });

  it("says switched off, without touching the database, while the flag is off", async () => {
    envRecord.CAIRO_EYEON_SPEND_ENABLED = "false";
    await expect(callerFor("ANALYST").summary(INPUT_7D)).resolves.toEqual({
      enabled: false,
    });
    await expect(
      callerFor("OWNER").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_SPEND_ENABLED = undefined;
    await expect(callerFor("VIEWER").summary(INPUT_7D)).resolves.toEqual({
      enabled: false,
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("status reports the flag without a database read", async () => {
    await expect(
      callerFor("ANALYST").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: true });
    expect(touched).not.toHaveBeenCalled();
  });

  it("refuses a period other than 24 hours, 7 days or 30 days", async () => {
    await expect(
      callerFor("OWNER", fakePrisma()).summary({
        projectId: PROJECT,
        window: "14d" as "7d",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reads nothing and reports nothing while gateway management is off", async () => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "false";
    const { result, db } = await enabledSummary("OWNER");
    expect(result).toMatchObject({
      gatewayManagement: false,
      requestLog: false,
      mirror: null,
      month: null,
      period: null,
      breakdown: null,
      budgets: null,
    });
    expect(readCounts(db)).toEqual(NO_READS);
  });

  it("reads nothing while the request log is off: every figure comes from it", async () => {
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "false";
    const { result, db } = await enabledSummary("OWNER");
    expect(result).toMatchObject({
      gatewayManagement: true,
      requestLog: false,
      period: null,
    });
    expect(readCounts(db)).toEqual(NO_READS);
  });

  it("adds up the month, the period and the change from the request log", async () => {
    const { result } = await enabledSummary("ANALYST", fakePrisma(), "24h");
    expect(result.month?.spentUsd).toBe(12.5);
    expect(result.month?.days.at(-1)?.calls).toBe(40);
    const p = result.period!;
    expect(p.series).toHaveLength(24);
    expect(p.bucketMinutes).toBe(60);
    expect(p.totals).toEqual({
      spendUsd: 12.5,
      calls: 50,
      failed: 5,
      promptTokens: 4_000,
      completionTokens: 1_000,
      totalTokens: 5_000,
      cacheHits: 5,
      cacheReported: 25,
    });
    expect(p.previous).toEqual({ spendUsd: 8, calls: 42, failed: 2 });
    expect(p.costPer1kTokensUsd).toBeCloseTo(2.5);
    expect(p.failedPct).toBe(10);
    expect(p.failedBand).toBe("red");
    expect(p.cacheHitPct).toBe(20);
    expect(result.mirror).toMatchObject({ state: "withinLag" });
  });

  it("breaks spend down by model, application, team and key, by name only", async () => {
    const { result } = await enabledSummary("ANALYST");
    const b = result.breakdown!;
    expect(b.model.rows[0]).toMatchObject({ name: "gpt-4o", spendUsd: 30 });
    expect(b.model.rest.count).toBe(0);
    expect(b.application.rows.map((r) => [r.name, r.spendUsd])).toEqual([
      ["App lineage-2", 12],
      ["App lineage-1", 10],
      ["Keys no longer in use", 0.5],
    ]);
    expect(b.team.rows.map((r) => [r.name, r.spendUsd])).toEqual([
      ["No team", 12.5],
      ["Claims team", 10],
    ]);
    expect(b.key.rows.map((r) => r.name)).toEqual([
      "App lineage-2",
      "App lineage-1 (generation 2)",
      "App lineage-1",
      "App lineage-3",
    ]);
    const json = JSON.stringify(result);
    for (const alias of ALIASES) expect(json).not.toContain(alias);
  });

  it("measures each application against its current key's budget", async () => {
    const { result } = await enabledSummary("OWNER");
    expect(result.budgets).toEqual({
      shown: [
        {
          lineageId: "lineage-2",
          name: "App lineage-2",
          spentUsd: 12,
          budgetUsd: 10,
          budgetDuration: "1mo",
          usedPct: 120,
          band: "red",
        },
        {
          lineageId: "lineage-1",
          name: "App lineage-1",
          spentUsd: 10,
          budgetUsd: 50,
          budgetDuration: "30d",
          usedPct: 20,
          band: "green",
        },
      ],
      withBudget: 2,
      withoutBudget: 0,
    });
  });

  it("selects, groups and queries no content column, token hash, end user or address", async () => {
    const { result, db } = await enabledSummary("OWNER");
    const [keys] = db.acmeLitellmKey.findMany.mock.calls[0]!;
    expect(keys.where).toMatchObject({ projectId: PROJECT });
    expect(Object.keys(keys.select).sort()).toEqual(
      [
        "budgetDuration",
        "displayName",
        "generation",
        "lineageId",
        "litellmKeyAlias",
        "litellmTeamId",
        "maxBudget",
        "status",
      ].sort(),
    );
    const [teams] = db.acmeLitellmTeam.findMany.mock.calls[0]!;
    expect(teams.where).toEqual({ projectId: PROJECT });
    expect(Object.keys(teams.select).sort()).toEqual(["id", "teamAlias"]);

    for (const [args] of db.acmeLitellmRequestLog.groupBy.mock.calls) {
      expect(args.where).toMatchObject({ projectId: PROJECT });
      for (const column of FORBIDDEN_COLUMNS) {
        expect(args.by).not.toContain(column);
        expect(JSON.stringify(args)).not.toContain(column);
      }
    }

    const [reconcile] = db.acmeLitellmReconcileRun.findFirst.mock.calls[0]!;
    expect(Object.keys(reconcile.select).sort()).toEqual(
      ["finishedAt", "gapCount", "windowEnd"].sort(),
    );

    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
    for (const [first] of db.$queryRaw.mock.calls) {
      const sql = sqlText(first);
      expect(sql).not.toMatch(FORBIDDEN_SQL);
      expect(sql).toMatch(/WHERE project_id = \?/);
      expect(sql).toMatch(/start_time >= \?::timestamp/);
      expect(sql).toMatch(/start_time <= \?::timestamp/);
      expect(sqlValues(first)).toContain(PROJECT);
    }
    const perModel = db.$queryRaw.mock.calls
      .map(([q]) => q)
      .find((q) => sqlText(q).includes("AS models"));
    expect(sqlText(perModel)).toMatch(/LIMIT \?$/);
    expect(sqlValues(perModel)).toContain(SPEND_MODELS_SHOWN);

    const json = JSON.stringify(result);
    for (const secret of [TOKEN_HASH, END_USER, SOURCE_IP, "SECRET"]) {
      expect(json).not.toContain(secret);
    }
  });

  it.each([
    ["24h", 24, 60],
    ["7d", 28, 360],
    ["30d", 30, 1440],
  ] as const)(
    "%s: %d buckets of %d minutes",
    async (window, buckets, minutes) => {
      const { result, db } = await enabledSummary(
        "OWNER",
        fakePrisma(),
        window,
      );
      expect(result.window).toBe(window);
      expect(result.period?.series).toHaveLength(buckets);
      expect(result.period?.bucketMinutes).toBe(minutes);
      const bucketSql = db.$queryRaw.mock.calls
        .map(([q]) => q)
        .find((q) => sqlText(q).includes('"newestReceivedAt"'));
      expect(sqlValues(bucketSql)).toContain(minutes * 60);
    },
  );

  it("bounds the month query to the calendar month (UTC)", async () => {
    const { db } = await enabledSummary("OWNER");
    const month = db.$queryRaw.mock.calls
      .map(([q]) => q)
      .find((q) => sqlText(q).includes("date_trunc('day'"));
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    expect(sqlValues(month)).toContain(start);
  });

  it("reads a fixed number of times, with few rows or many", async () => {
    const few = await enabledSummary(
      "OWNER",
      fakePrisma({ rows: 1, keys: KEY_ROWS.slice(0, 1) }),
    );
    const manyKeys = Array.from({ length: 60 }, (_, i) =>
      keyRow(`lineage-x${i}`, `app-${i}`, 1, AcmeLitellmKeyStatus.ACTIVE),
    );
    const many = await enabledSummary(
      "OWNER",
      fakePrisma({ rows: 400, keys: [...KEY_ROWS, ...manyKeys] }),
    );
    expect(readCounts(few.db)).toEqual(ALL_READS);
    expect(readCounts(many.db)).toEqual(ALL_READS);
  });
});
