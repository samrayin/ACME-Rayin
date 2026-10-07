import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import { AcmeLitellmKeyStatus, Role } from "@langfuse/shared/src/db";
import { isAllowedForRole } from "@/src/features/rbac/server/securityRoleAllowList";
import type * as CheckProjectAccess from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { eyeonGatewayHealthRouter } from "@/src/features/acme-enhancements/server/eyeonGatewayHealthRouter";
import {
  CATALOGUE_SNAPSHOT_KEY,
  LATEST_FAILED_SHOWN,
  MODELS_SHOWN,
} from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";

// CHG-2026-139 (ADR-0027): the EYEON Gateway health page's access rules and
// reads, against a mocked Prisma. A role without the LLM Gateway page's read
// scopes is refused before the database is touched; with the flag off
// nothing is read; individual failed calls are read only with the request
// log's scope; no content column, token hash, key secret, end user, source
// address or spend is selected, grouped or queried; the provider's health
// message never leaves the server; the number of reads does not grow with
// the data.

// Lets a test take llmGatewayLogs:read away from a role that holds it: no
// built-in role has the page's scopes without it.
const access = vi.hoisted(() => ({ denyLogs: false }));
vi.mock(
  "@/src/features/rbac/utils/checkProjectAccess",
  async (importOriginal) => {
    const original = await importOriginal<typeof CheckProjectAccess>();
    return {
      ...original,
      hasProjectAccess: (p: Parameters<typeof original.hasProjectAccess>[0]) =>
        access.denyLogs && p.scope === "llmGatewayLogs:read"
          ? false
          : original.hasProjectAccess(p),
    };
  },
);

const PROJECT = "proj-eyeon-gateway-health";
const ORG = "org-eyeon-gateway-health";
const TOKEN_HASH =
  "9a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b1d3f5a7c9e2b4d6f8a0c2e4b6d8f0a1c";
const PROVIDER_SECRET = "sk-SECRET-provider-message-abcd";
const END_USER = "end-user-SECRET-id-4711";
const SOURCE_IP = "203.0.113.77";
const FORBIDDEN_COLUMNS = [
  "apiKeyHash",
  "tokenHash",
  "endUser",
  "requesterIp",
  "spend",
  "errorMessage",
  "otelTraceId",
];
const FORBIDDEN_SQL =
  /api_key_hash|token_hash|end_user|requester_ip|\bspend\b|error_message|traceback|prompt_tokens|completion_tokens/;

const router = createTRPCRouter({
  eyeonGatewayHealth: eyeonGatewayHealthRouter,
});

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
) {
  return {
    id: `key-${alias}`,
    lineageId: lineage,
    generation,
    displayName: `App ${lineage}`,
    litellmKeyAlias: alias,
    tokenHash: TOKEN_HASH,
    status,
  };
}
const KEY_ROWS = [
  keyRow("lineage-1", "claims-bot-1", 1, AcmeLitellmKeyStatus.ROTATED),
  keyRow("lineage-1", "claims-bot-1-r2", 2, AcmeLitellmKeyStatus.ACTIVE),
  keyRow("lineage-2", "hr-bot-1", 1, AcmeLitellmKeyStatus.ACTIVE),
  keyRow("lineage-3", "old-bot-1", 1, AcmeLitellmKeyStatus.REVOKED),
];

function snapshotRow(minutesAgo = 2) {
  return {
    payload: [
      {
        modelName: "gpt-4o",
        providers: ["openai"],
        health: "healthy",
        healthError: null,
      },
      {
        modelName: "claude-sonnet",
        providers: ["anthropic"],
        health: "unhealthy",
        healthError: `litellm.AuthenticationError: invalid key ${PROVIDER_SECRET}`,
      },
    ],
    fetchedAt: new Date(Date.now() - minutesAgo * 60_000),
  };
}

function modelRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    model: i === 0 ? "claude-sonnet" : `model-${i}`,
    calls: 100,
    failed: i === 0 ? 12 : 1,
    timedCalls: 80,
    p50Ms: 900,
    p95Ms: 3_100,
    models: count,
  })).slice(0, MODELS_SHOWN);
}

function bucketRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    bucket: i,
    calls: 10,
    failed: 2,
    newestReceivedAt: new Date(Date.now() - (count - i) * 60_000).toISOString(),
  }));
}

function failedRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `req-${i}`,
    requestId: `chatcmpl-${i}`,
    startTime: new Date(Date.now() - i * 60_000),
    model: "anthropic/claude-sonnet",
    modelGroup: "claude-sonnet",
    keyAlias: i === 0 ? "claims-bot-1" : "unknown-key",
    errorClass: "AuthenticationError",
    apiKeyHash: TOKEN_HASH,
    endUser: END_USER,
    requesterIp: SOURCE_IP,
    spend: 12.3456,
    status: "failure",
  })).slice(0, LATEST_FAILED_SHOWN);
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
    acmeLitellmSpendSnapshot: {
      findUnique: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => Promise<unknown>
      >(async () => snapshotRow()),
    },
    acmeLitellmKey: {
      findMany: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => Promise<unknown[]>
      >(async () => opts.keys ?? KEY_ROWS),
    },
    acmeLitellmRequestLog: {
      groupBy: vi.fn<(args: GroupByArgs) => Promise<unknown[]>>(async (args) =>
        args.by.includes("errorClass")
          ? [
              { errorClass: "AuthenticationError", _count: { _all: 10 } },
              { errorClass: "RateLimitError", _count: { _all: 4 } },
              { errorClass: "BudgetExceededError", _count: { _all: 1 } },
              { errorClass: null, _count: { _all: 1 } },
            ].slice(0, rows)
          : [
              { status: "success", _count: { _all: 40 } },
              { status: "failure", _count: { _all: 8 } },
            ],
      ),
      findMany: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
          take: number;
        }) => Promise<unknown[]>
      >(async () => failedRows(rows)),
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
        gapCount: 2,
        errorMessage: "SECRET reconcile failure text",
      })),
    },
    $queryRaw: vi.fn(async (first: unknown) => {
      const sql = sqlText(first);
      if (sql.includes('"p50Ms"')) return modelRows(rows);
      if (sql.includes('"newestReceivedAt"')) return bucketRows(rows);
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
  }).eyeonGatewayHealth;
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
    snapshot: db.acmeLitellmSpendSnapshot.findUnique.mock.calls.length,
    keys: db.acmeLitellmKey.findMany.mock.calls.length,
    groupBy: db.acmeLitellmRequestLog.groupBy.mock.calls.length,
    failedCalls: db.acmeLitellmRequestLog.findMany.mock.calls.length,
    reconcile: db.acmeLitellmReconcileRun.findFirst.mock.calls.length,
    sql: db.$queryRaw.mock.calls.length,
  };
}

const ALL_READS = {
  snapshot: 1,
  keys: 1,
  groupBy: 2,
  failedCalls: 1,
  reconcile: 1,
  sql: 2,
};

describe("EYEON Gateway health: access and reads (CHG-2026-139)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    page: envRecord.CAIRO_EYEON_GATEWAY_HEALTH_ENABLED,
    gateway: envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED,
    requestLog: envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED,
  };

  beforeEach(() => {
    envRecord.CAIRO_EYEON_GATEWAY_HEALTH_ENABLED = "true";
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "true";
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "true";
    access.denyLogs = false;
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_EYEON_GATEWAY_HEALTH_ENABLED = original.page;
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = original.gateway;
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = original.requestLog;
    access.denyLogs = false;
  });

  // Every role without llmGateway:read or evidence:read: the Prompt Analyst
  // (MEMBER), the Viewer, no role, and the Business Analyst and Security
  // Analyst (content-free, not on the list either).
  it.each(["MEMBER", "VIEWER", "NONE", "ANALYST", "SECURITY"])(
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

  it("is on the Auditor's content-free allow-list only", () => {
    for (const path of [
      "eyeonGatewayHealth.summary",
      "eyeonGatewayHealth.status",
    ]) {
      expect(isAllowedForRole(Role.AUDITOR, path)).toBe(true);
      expect(isAllowedForRole(Role.SECURITY, path)).toBe(false);
      expect(isAllowedForRole(Role.ANALYST, path)).toBe(false);
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

  it.each(["OWNER", "ADMIN", "AUDITOR"])(
    "lets %s, who holds the LLM Gateway page's read scopes, open the page",
    async (role) => {
      const { result } = await enabledSummary(role);
      expect(result.health?.counts.total).toBe(2);
      expect(result.failures?.latest).toHaveLength(5);
      await expect(
        callerFor(role).status({ projectId: PROJECT }),
      ).resolves.toEqual({ enabled: true });
    },
  );

  it("says switched off, without touching the database, while the flag is off", async () => {
    envRecord.CAIRO_EYEON_GATEWAY_HEALTH_ENABLED = "false";
    await expect(callerFor("AUDITOR").summary(INPUT_7D)).resolves.toEqual({
      enabled: false,
    });
    await expect(
      callerFor("OWNER").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_GATEWAY_HEALTH_ENABLED = undefined;
    await expect(callerFor("ADMIN").summary(INPUT_7D)).resolves.toEqual({
      enabled: false,
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("status reports the flag without a database read", async () => {
    await expect(
      callerFor("AUDITOR").status({ projectId: PROJECT }),
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

  it("shows model health from the last stored check, never the provider's message", async () => {
    const { result, db } = await enabledSummary("AUDITOR");
    expect(result.health).toMatchObject({
      fresh: true,
      cacheMinutes: 5,
      counts: { total: 2, healthy: 1, unhealthy: 1, unknown: 0 },
      models: [
        {
          model: "claude-sonnet",
          providers: ["anthropic"],
          status: "unhealthy",
          cause: "keyOrCredit",
        },
        {
          model: "gpt-4o",
          providers: ["openai"],
          status: "healthy",
          cause: null,
        },
      ],
    });
    const [args] = db.acmeLitellmSpendSnapshot.findUnique.mock.calls[0]!;
    expect(args.where).toEqual({ cacheKey: CATALOGUE_SNAPSHOT_KEY });
    expect(args.select).toEqual({ payload: true, fetchedAt: true });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toMatch(/invalid key|sk-/);
  });

  it("calls a check older than 5 minutes stale", async () => {
    const db = fakePrisma();
    db.acmeLitellmSpendSnapshot.findUnique.mockResolvedValue(snapshotRow(9));
    const { result } = await enabledSummary("OWNER", db);
    expect(result.health?.fresh).toBe(false);
  });

  it("says no check is recorded when the LLM Gateway page has stored none", async () => {
    const db = fakePrisma();
    db.acmeLitellmSpendSnapshot.findUnique.mockResolvedValue(null);
    const { result } = await enabledSummary("OWNER", db);
    expect(result.health).toMatchObject({ checkedAt: null, models: [] });
  });

  it("counts applications from the keys, reading lineage, name, alias and status only", async () => {
    const { result, db } = await enabledSummary("AUDITOR");
    expect(result.applications).toBe(2);
    const [args] = db.acmeLitellmKey.findMany.mock.calls[0]!;
    expect(args.where).toMatchObject({ projectId: PROJECT });
    expect(Object.keys(args.select).sort()).toEqual(
      [
        "displayName",
        "generation",
        "lineageId",
        "litellmKeyAlias",
        "status",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain(TOKEN_HASH);
  });

  it("adds up the failure analysis from the request log", async () => {
    const { result } = await enabledSummary("OWNER", fakePrisma(), "24h");
    const f = result.failures!;
    expect(f.series).toHaveLength(24);
    expect(f.calls).toBe(50);
    expect(f.failed).toBe(10);
    expect(f.previous).toEqual({ calls: 48, failed: 8 });
    expect(f.bucketMinutes).toBe(60);
    // 16 classified in the capped groups; none past the cap here.
    expect(f.byClass).toEqual([
      { group: "auth", failed: 10 },
      { group: "rateLimited", failed: 4 },
      { group: "budget", failed: 1 },
      { group: "notReported", failed: 1 },
    ]);
    expect(f.limitRefusals).toBe(5);
    expect(f.byModel.total).toBe(5);
    expect(f.byModel.shown[0]).toMatchObject({
      model: "claude-sonnet",
      calls: 100,
      failed: 12,
      band: "red",
      p50Ms: 900,
      p95Ms: 3_100,
    });
    expect(f.latest?.[0]).toEqual({
      time: expect.any(String),
      model: "claude-sonnet",
      alias: "claims-bot-1",
      application: { lineageId: "lineage-1", name: "App lineage-1" },
      group: "auth",
    });
    expect(f.latest?.[1]?.application).toBeNull();
    expect(result.mirror).toMatchObject({
      state: "withinLag",
      expectedLagMinutes: 7,
      lastGapCount: 2,
    });
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
      expect(result.failures?.series).toHaveLength(buckets);
      expect(result.failures?.bucketMinutes).toBe(minutes);
      const bucketSql = db.$queryRaw.mock.calls
        .map(([q]) => q)
        .find((q) => sqlText(q).includes('"newestReceivedAt"'));
      expect(sqlValues(bucketSql)).toContain(minutes * 60);
    },
  );

  it("reads individual failed calls only with the request log's scope", async () => {
    access.denyLogs = true;
    const { result, db } = await enabledSummary("AUDITOR");
    expect(result.failures?.latest).toBeNull();
    expect(db.acmeLitellmRequestLog.findMany).not.toHaveBeenCalled();
    // The counts are still there: they are not individual requests.
    expect(result.failures?.failed).toBe(10);
  });

  it("offers the health check only to roles that may run it", async () => {
    expect((await enabledSummary("OWNER")).result.canCheckHealth).toBe(true);
    expect((await enabledSummary("ADMIN")).result.canCheckHealth).toBe(true);
    expect((await enabledSummary("AUDITOR")).result.canCheckHealth).toBe(false);
  });

  it("reads nothing and reports nothing while gateway management is off", async () => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "false";
    const { result, db } = await enabledSummary("OWNER");
    expect(result).toMatchObject({
      gatewayManagement: false,
      requestLog: false,
      health: null,
      applications: null,
      mirror: null,
      failures: null,
    });
    expect(readCounts(db)).toEqual({
      snapshot: 0,
      keys: 0,
      groupBy: 0,
      failedCalls: 0,
      reconcile: 0,
      sql: 0,
    });
  });

  it("reads no request log while the request log is off", async () => {
    envRecord.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "false";
    const { result, db } = await enabledSummary("OWNER");
    expect(result.health?.counts.total).toBe(2);
    expect(result.applications).toBe(2);
    expect(result).toMatchObject({
      requestLog: false,
      mirror: null,
      failures: null,
    });
    expect(readCounts(db)).toEqual({
      ...ALL_READS,
      groupBy: 0,
      failedCalls: 0,
      reconcile: 0,
      sql: 0,
    });
  });

  it("selects, groups and queries no content column, token hash, end user, address or spend", async () => {
    const { result, db } = await enabledSummary("OWNER");
    for (const [args] of db.acmeLitellmRequestLog.groupBy.mock.calls) {
      expect(args.where).toMatchObject({ projectId: PROJECT });
      for (const column of FORBIDDEN_COLUMNS) {
        expect(args.by).not.toContain(column);
        expect(JSON.stringify(args)).not.toContain(column);
      }
    }
    const classes = db.acmeLitellmRequestLog.groupBy.mock.calls
      .map(([args]) => args)
      .find((args) => args.by.includes("errorClass"));
    expect(classes?.where).toMatchObject({ status: { not: "success" } });
    expect(classes?.take).toBe(50);

    const [failed] = db.acmeLitellmRequestLog.findMany.mock.calls[0]!;
    expect(Object.keys(failed.select).sort()).toEqual(
      ["errorClass", "keyAlias", "model", "modelGroup", "startTime"].sort(),
    );
    expect(failed.where).toMatchObject({
      projectId: PROJECT,
      status: { not: "success" },
    });
    expect(failed.take).toBe(LATEST_FAILED_SHOWN);

    const [reconcile] = db.acmeLitellmReconcileRun.findFirst.mock.calls[0]!;
    expect(Object.keys(reconcile.select).sort()).toEqual(
      ["finishedAt", "gapCount", "windowEnd"].sort(),
    );
    expect(reconcile.where).toEqual({ status: "success" });

    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
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
      .find((q) => sqlText(q).includes('"p50Ms"'));
    expect(sqlText(perModel)).toMatch(/LIMIT \?$/);
    expect(sqlValues(perModel)).toContain(MODELS_SHOWN);

    const json = JSON.stringify(result);
    for (const secret of [
      TOKEN_HASH,
      END_USER,
      SOURCE_IP,
      "12.3456",
      "SECRET",
      "chatcmpl-",
    ]) {
      expect(json).not.toContain(secret);
    }
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
    expect(many.result.applications).toBe(62);
    // Without the request log's scope, one read fewer.
    access.denyLogs = true;
    const auditor = await enabledSummary("AUDITOR", fakePrisma({ rows: 400 }));
    expect(readCounts(auditor.db)).toEqual({ ...ALL_READS, failedCalls: 0 });
  });
});
