import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  AcmeLitellmEventOutcome,
  AcmeLitellmEventPhase,
  AcmeLitellmKeyStatus,
  type Prisma,
} from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import {
  DETAIL_CHANGE_SELECT,
  DETAIL_DECISION_SELECT,
  DETAIL_GENERATION_SELECT,
  acmeApplicationsRouter,
  detailRequestSelect,
} from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";

// CHG-2026-125 (ADR-0023 §3.5): the application detail query's access rules,
// against a mocked Prisma. A role without the page's scopes is refused before
// the database is touched; spend is absent without the spend scope; no
// content column is ever selected; a token hash is never returned.

const PROJECT = "proj-app-detail";
const ORG = "org-app-detail";
const LINEAGE = "lineage-1";
const TOKEN_HASH =
  "4d7a1c9e2b8f6a3d5c0e9b7a2f4d6c8e1a3b5d7f9c2e4a6b8d0f1e3c5a7b9d2f";
const V1 = "cairo-hr-bot-1a2b3c4d";
const V2 = "cairo-hr-bot-1a2b3c4d-r2";
const CONTENT_COLUMNS = [
  "redactedText",
  "piiFindings",
  "rawContentEncrypted",
  "tokenHash",
];

const router = createTRPCRouter({ acmeApplications: acmeApplicationsRouter });

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

// Rows as a careless query would return them: the key rows carry their token
// hash and the change record's before and after carry it too, so the tests
// prove the output never passes either on.
const KEY_ROWS = [
  {
    id: "key-1",
    lineageId: LINEAGE,
    generation: 1,
    displayName: "HR bot",
    litellmKeyAlias: V1,
    tokenHash: TOKEN_HASH,
    status: AcmeLitellmKeyStatus.ROTATED,
    models: ["hr-assistant"],
    rpmLimit: 20,
    tpmLimit: null,
    maxBudget: 50,
    budgetDuration: "30d",
    expiresAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    revokedAt: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "key-2",
    lineageId: LINEAGE,
    generation: 2,
    displayName: "HR bot",
    litellmKeyAlias: V2,
    tokenHash: TOKEN_HASH.replace("4d7a", "0000"),
    status: AcmeLitellmKeyStatus.ACTIVE,
    models: ["hr-assistant"],
    rpmLimit: 20,
    tpmLimit: null,
    maxBudget: 50,
    budgetDuration: "30d",
    expiresAt: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    revokedAt: null,
  },
];

const KEY_VIEW = {
  id: "key-1",
  alias: V1,
  tokenHash: TOKEN_HASH,
  status: "ACTIVE",
  rpmLimit: 20,
};

/** What the tests read back from a mocked query call. */
type QueryArgs = { select: Record<string, unknown>; where: unknown };
type Query = (args: QueryArgs) => Promise<unknown[]>;

function fakePrisma(keys: object[] = KEY_ROWS) {
  const recent = new Date(Date.now() - 3_600_000);
  const db = {
    acmeLitellmKey: { findMany: vi.fn<Query>(async () => keys) },
    acmeGuardrailSettings: { findFirst: vi.fn(async () => null) },
    acmeGuardrailEvent: {
      groupBy: vi.fn<(args: { by: string[] }) => Promise<unknown[]>>(
        async () => [
          {
            agentId: V2,
            direction: AcmeGuardrailEventDirection.INPUT,
            action: AcmeGuardrailEventAction.BLOCK,
            policyTriggered: "Jailbreak Detection",
            gatewayMode: "enforce",
            _count: { _all: 1 },
          },
        ],
      ),
      findMany: vi.fn<Query>(async () => [
        {
          traceId: "call-1",
          eventTime: recent,
          direction: AcmeGuardrailEventDirection.INPUT,
          action: AcmeGuardrailEventAction.BLOCK,
          policyTriggered: "Jailbreak Detection",
          gatewayMode: "enforce",
          // As if the select were ignored: never passed on.
          redactedText: "SECRET-REDACTED-TEXT",
          rawContentEncrypted: "SECRET-CIPHERTEXT",
        },
      ]),
    },
    acmeLitellmRequestLog: {
      groupBy: vi.fn(async () => [
        {
          keyAlias: V2,
          status: "success",
          _count: { _all: 12 },
          _sum: { spend: 1.25 },
        },
      ]),
      findMany: vi.fn<Query>(async (args) => [
        {
          id: "req-1",
          requestId: "chatcmpl-1",
          litellmCallId: "call-1",
          startTime: recent,
          endTime: new Date(recent.getTime() + 900),
          status: "success",
          errorClass: null,
          model: "gpt-4o",
          modelGroup: "hr-assistant",
          keyAlias: V2,
          endUser: "user-7",
          ...(args.select.spend ? { spend: 0.01 } : {}),
        },
      ]),
    },
    acmeLitellmEvent: {
      findMany: vi.fn<Query>(async () => [
        {
          id: "ev-1",
          eventTime: new Date("2026-10-01T00:00:00.000Z"),
          phase: AcmeLitellmEventPhase.OUTCOME,
          outcome: AcmeLitellmEventOutcome.SUCCESS,
          action: "key.update",
          resourceId: "key-1",
          actorUserId: "user-1",
          actorOrgRole: "OWNER",
          actorProjectRole: null,
          before: KEY_VIEW,
          after: { ...KEY_VIEW, rpmLimit: 40 },
        },
      ]),
    },
    user: {
      findMany: vi.fn(async () => [
        { id: "user-1", name: "Ana Admin", email: null },
      ]),
    },
    $queryRaw: vi.fn(async (sql: Prisma.Sql) =>
      sql.sql.includes("acme_litellm_request_logs")
        ? [
            {
              alias: V2,
              day: recent.toISOString().slice(0, 10),
              calls: 12,
              failed: 0,
              ...(sql.sql.includes("spend") ? { spend: 1.25 } : {}),
            },
          ]
        : [{ alias: V2, day: recent.toISOString().slice(0, 10), n: 1 }],
    ),
  };
  return db;
}

function callerFor(role: string, db: object = explodingPrisma) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: db as typeof ctx.prisma,
  }).acmeApplications;
}

const INPUT = { projectId: PROJECT, lineageId: LINEAGE, windowDays: 30 };

async function enabledDetail(role: string, db = fakePrisma()) {
  const result = await callerFor(role, db).detail(INPUT);
  if (!result.enabled) throw new Error("expected the detail to be enabled");
  return { result, db };
}

describe("application detail: access (CHG-2026-125)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED;

  beforeEach(() => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "true";
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = original;
  });

  it.each(["MEMBER", "VIEWER", "NONE", "SECURITY", "ANALYST"])(
    "refuses %s before the database is touched",
    async (role) => {
      await expect(callerFor(role).detail(INPUT)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it("says switched off, without touching the database, where gateway management is off", async () => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "false";
    await expect(callerFor("OWNER").detail(INPUT)).resolves.toEqual({
      enabled: false,
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("is scoped to the project, and a lineage with no active key is not found", async () => {
    const db = fakePrisma([KEY_ROWS[0]!]);
    await expect(callerFor("OWNER", db).detail(INPUT)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(db.acmeLitellmKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT, lineageId: LINEAGE },
      }),
    );
    expect(db.acmeLitellmRequestLog.findMany).not.toHaveBeenCalled();
  });

  it("the Auditor sees the application without spend: no spend field, no spend column read", async () => {
    const { result, db } = await enabledDetail("AUDITOR");
    expect(result.canSeeSpend).toBe(false);
    expect(
      result.application.dimensions.find((d) => d.dimension === "spend"),
    ).toMatchObject({ band: "none", evidence: "Not shown for your role." });
    for (const point of result.daily)
      expect(point).not.toHaveProperty("spendUsd");
    expect(result.requests).toHaveLength(1);
    expect(result.requests?.[0]).not.toHaveProperty("costUsd");
    const requestArgs = db.acmeLitellmRequestLog.findMany.mock.calls[0]![0];
    expect(requestArgs.select.spend).toBe(false);
    const dailySql = db.$queryRaw.mock.calls
      .map(([sql]) => sql.sql)
      .find((sql) => sql.includes("acme_litellm_request_logs"));
    expect(dailySql).toBeDefined();
    expect(dailySql).not.toMatch(/spend/i);
  });

  it("an Owner sees spend and each request's cost", async () => {
    const { result, db } = await enabledDetail("OWNER");
    expect(result.canSeeSpend).toBe(true);
    expect(result.requests?.[0]).toMatchObject({ costUsd: 0.01 });
    expect(result.daily.some((p) => p.spendUsd === 1.25)).toBe(true);
    expect(
      db.acmeLitellmRequestLog.findMany.mock.calls[0]![0].select.spend,
    ).toBe(true);
  });

  it("names the gateway-traces project only when the deployment sets it (CHG-2026-126)", async () => {
    const before = envRecord.CAIRO_GATEWAY_TRACES_PROJECT_ID;
    try {
      envRecord.CAIRO_GATEWAY_TRACES_PROJECT_ID = undefined;
      const unset = await enabledDetail("OWNER");
      expect(unset.result.gatewayTracesProjectId).toBeNull();
      envRecord.CAIRO_GATEWAY_TRACES_PROJECT_ID = "proj-gateway-traces";
      const set = await enabledDetail("AUDITOR");
      expect(set.result.gatewayTracesProjectId).toBe("proj-gateway-traces");
      expect(
        set.db.acmeLitellmRequestLog.findMany.mock.calls[0]![0].select
          .otelTraceId,
      ).toBe(true);
    } finally {
      envRecord.CAIRO_GATEWAY_TRACES_PROJECT_ID = before;
    }
  });

  it("selects no content column and no token hash, anywhere", async () => {
    const { db } = await enabledDetail("OWNER");
    const selects = [
      db.acmeLitellmKey.findMany.mock.calls[0]![0].select,
      db.acmeLitellmRequestLog.findMany.mock.calls[0]![0].select,
      db.acmeGuardrailEvent.findMany.mock.calls[0]![0].select,
      db.acmeLitellmEvent.findMany.mock.calls[0]![0].select,
    ];
    expect(selects).toEqual([
      DETAIL_GENERATION_SELECT,
      detailRequestSelect(true),
      DETAIL_DECISION_SELECT,
      DETAIL_CHANGE_SELECT,
    ]);
    for (const select of selects) {
      for (const column of CONTENT_COLUMNS) {
        expect(select).not.toHaveProperty(column);
      }
    }
    for (const [args] of db.acmeGuardrailEvent.groupBy.mock.calls) {
      for (const column of CONTENT_COLUMNS)
        expect(args.by).not.toContain(column);
    }
    for (const [sql] of db.$queryRaw.mock.calls) {
      expect(sql.sql).not.toMatch(
        /redacted_text|pii_findings|raw_content_encrypted|token_hash/,
      );
    }
  });

  it("returns no token hash, no request or call id and no guardrail content", async () => {
    const { result } = await enabledDetail("OWNER");
    const json = JSON.stringify(result);
    expect(json).not.toContain(TOKEN_HASH);
    expect(json).not.toContain(TOKEN_HASH.replace("4d7a", "0000"));
    expect(json).not.toMatch(/tokenHash|token_hash/);
    expect(json).not.toContain("SECRET-");
    expect(json).not.toContain("chatcmpl-1");
    expect(result.changes).toEqual([
      expect.objectContaining({
        generation: 1,
        actor: "Ana Admin",
        changes: [
          {
            setting: "rpmLimit",
            label: "Requests per minute",
            from: 20,
            to: 40,
          },
        ],
      }),
    ]);
  });

  it("links each decision to its request by the gateway call id, within the project and the application's aliases", async () => {
    const { result, db } = await enabledDetail("AUDITOR");
    expect(db.acmeGuardrailEvent.findMany.mock.calls[0]![0].where).toEqual(
      expect.objectContaining({
        projectId: PROJECT,
        agentId: { in: [V1, V2] },
        traceId: { in: ["call-1", "chatcmpl-1"] },
      }),
    );
    expect(db.acmeLitellmEvent.findMany.mock.calls[0]![0].where).toEqual({
      projectId: PROJECT,
      resourceType: "litellmKey",
      resourceId: { in: ["key-1", "key-2"] },
    });
    expect(result.requests?.[0]?.decisions).toEqual([
      expect.objectContaining({
        direction: "input",
        action: "block",
        mode: "enforce",
        policy: "Jailbreak Detection",
      }),
    ]);
    expect(result.aliases).toEqual([V1, V2]);
    expect(result.generations.map((g) => [g.generation, g.current])).toEqual([
      [2, true],
      [1, false],
    ]);
  });
});
