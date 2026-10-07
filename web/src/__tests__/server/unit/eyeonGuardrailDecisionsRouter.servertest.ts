import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  AcmeLitellmKeyStatus,
} from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import {
  BUSIEST_SHOWN,
  eyeonGuardrailDecisionsRouter,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisionsRouter";

// CHG-2026-133 (ADR-0027): the EYEON Guardrail decisions page's access rules
// and reads, against a mocked Prisma. A role without projectGuardrails:read
// is refused before the database is touched; with the flag off nothing is
// read; keys are read only for a viewer who may open Applications; no content
// column is ever selected, grouped or queried; only a reported "enforce"
// counts as applied; the number of reads does not grow with the data.

const PROJECT = "proj-eyeon-decisions";
const ORG = "org-eyeon-decisions";
const TOKEN_HASH =
  "4c2e6a8b0d1f3e5a7c9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c";
const V1 = "cairo-claims-bot-1a2b3c4d";
const V2 = "cairo-claims-bot-1a2b3c4d-r2";
const OLD = "cairo-retired-app-9f8e7d6c";
const PROBE = "promptfoo-suite";
const CONTENT_COLUMNS = [
  "redactedText",
  "piiFindings",
  "rawContentEncrypted",
  "tokenHash",
];
const CONTENT_SQL =
  /redacted_text|pii_findings|raw_content_encrypted|token_hash/;

const router = createTRPCRouter({
  eyeonGuardrailDecisions: eyeonGuardrailDecisionsRouter,
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

// Key rows as a careless query would return them, with their token hash, so
// the tests prove the output never passes it on.
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
  keyRow("lineage-1", V1, 1, AcmeLitellmKeyStatus.ROTATED),
  keyRow("lineage-1", V2, 2, AcmeLitellmKeyStatus.ACTIVE),
  // No active key: not an application, so its alias links nowhere.
  keyRow("lineage-2", OLD, 1, AcmeLitellmKeyStatus.REVOKED),
];

// The settings in force: enforce, set by a person whose id and reason must
// never reach the page.
const SETTINGS_ROW = {
  version: 2,
  mode: "enforce",
  piiEntities: ["EMAIL_ADDRESS"],
  jailbreakEnabled: true,
  topicalEnabled: true,
  reason: "SECRET-REASON for the switch",
  createdBy: "SECRET-USER-ID",
  createdByEmail: null,
  createdAt: new Date("2026-10-05T09:00:00.000Z"),
  revertAt: null,
  automatic: false,
};

const { INPUT, OUTPUT } = AcmeGuardrailEventDirection;
const { ALLOW, BLOCK, REDACT, UNAVAILABLE } = AcmeGuardrailEventAction;

/** The project's decisions by direction, verdict and the reported mode. */
const PROJECT_GROUPS = [
  { direction: INPUT, action: ALLOW, gatewayMode: "enforce", n: 15 },
  { direction: INPUT, action: ALLOW, gatewayMode: null, n: 5 },
  { direction: OUTPUT, action: ALLOW, gatewayMode: "record", n: 4 },
  { direction: INPUT, action: BLOCK, gatewayMode: "enforce", n: 2 },
  { direction: INPUT, action: BLOCK, gatewayMode: "record", n: 1 },
  // No mode reported: nothing says it was applied, so a Would block.
  { direction: INPUT, action: BLOCK, gatewayMode: null, n: 1 },
  { direction: OUTPUT, action: BLOCK, gatewayMode: "record", n: 1 },
  { direction: OUTPUT, action: BLOCK, gatewayMode: "enforce", n: 1 },
  { direction: INPUT, action: REDACT, gatewayMode: "record", n: 3 },
  { direction: OUTPUT, action: REDACT, gatewayMode: "enforce", n: 2 },
  { direction: INPUT, action: UNAVAILABLE, gatewayMode: null, n: 1 },
].map(({ n, ...g }) => ({ ...g, _count: { _all: n } }));

/** The same refusals by policy label, direction and mode. */
const REFUSAL_GROUPS = [
  {
    policyTriggered: "Jailbreak Detection",
    direction: INPUT,
    gatewayMode: "enforce",
    n: 2,
  },
  {
    policyTriggered: "Jailbreak Detection",
    direction: INPUT,
    gatewayMode: "record",
    n: 1,
  },
  { policyTriggered: null, direction: INPUT, gatewayMode: null, n: 1 },
  {
    policyTriggered: "Topical Rail",
    direction: OUTPUT,
    gatewayMode: "record",
    n: 1,
  },
  {
    policyTriggered: "Topical Rail",
    direction: OUTPUT,
    gatewayMode: "enforce",
    n: 1,
  },
].map(({ n, ...g }) => ({ ...g, _count: { _all: n } }));

/** The agents with the most refusals, as the capped query returns them. */
function busiestRows(count = 4) {
  const rows = [
    { alias: V2, checks: 30, refusals: 4, refusalsEnforced: 2 },
    { alias: OLD, checks: 12, refusals: 1, refusalsEnforced: 0 },
    { alias: PROBE, checks: 4, refusals: 1, refusalsEnforced: 0 },
    { alias: V1, checks: 2, refusals: 1, refusalsEnforced: 1 },
  ].slice(0, count);
  return rows.map((r) => ({ ...r, withRefusals: count }));
}

type GroupByArgs = {
  by: string[];
  where: Record<string, unknown>;
  [key: string]: unknown;
};

function groupsFor(args: GroupByArgs) {
  if (args.by.includes("policyTriggered")) return REFUSAL_GROUPS;
  if (args.by.length === 1 && args.by[0] === "action") {
    // The judge's no-verdict rate over 24 hours.
    return [
      { action: "ALLOW", _count: { _all: 99 } },
      { action: "UNAVAILABLE", _count: { _all: 1 } },
    ];
  }
  return PROJECT_GROUPS;
}

/** The SQL text of a raw query, whether tagged or built with Prisma.sql. */
function sqlText(first: unknown): string {
  if (first && typeof first === "object" && "sql" in first)
    return String((first as { sql: string }).sql);
  if (Array.isArray(first)) return first.join("?");
  return String(first);
}

function sqlValues(first: unknown): unknown[] {
  if (first && typeof first === "object" && "values" in first)
    return (first as { values: unknown[] }).values;
  return [];
}

const today = () => new Date().toISOString().slice(0, 10);

const DAILY_ROW = {
  checks: 36,
  allowed: 24,
  blocked: 3,
  wouldBlock: 3,
  redacted: 2,
  wouldRedact: 3,
  noVerdict: 1,
};

function fakePrisma(opts: { keys?: object[]; busiest?: object[] } = {}) {
  const keys = opts.keys ?? KEY_ROWS;
  const busiest = opts.busiest ?? busiestRows();
  return {
    acmeLitellmKey: {
      findMany: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => Promise<unknown[]>
      >(async () => keys),
    },
    acmeGuardrailSettings: {
      findFirst: vi.fn(async () => SETTINGS_ROW),
      findMany: vi.fn(async () => [SETTINGS_ROW]),
    },
    acmeGuardrailEvent: {
      groupBy: vi.fn<(args: GroupByArgs) => Promise<unknown[]>>(async (args) =>
        groupsFor(args),
      ),
      findMany: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async (first: unknown) => {
      const sql = sqlText(first);
      if (sql.includes('"wouldBlock"')) return [{ day: today(), ...DAILY_ROW }];
      if (sql.includes('"withRefusals"')) return busiest;
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
  }).eyeonGuardrailDecisions;
}

const INPUT_7 = { projectId: PROJECT, windowDays: 7 as const };

async function enabledSummary(role: string, db = fakePrisma()) {
  const result = await callerFor(role, db).summary(INPUT_7);
  if (!result.enabled) throw new Error("expected the page to be enabled");
  return { result, db };
}

/** How many times each read was made. */
function readCounts(db: ReturnType<typeof fakePrisma>) {
  return {
    keys: db.acmeLitellmKey.findMany.mock.calls.length,
    settings: db.acmeGuardrailSettings.findFirst.mock.calls.length,
    settingsHistory: db.acmeGuardrailSettings.findMany.mock.calls.length,
    groupBy: db.acmeGuardrailEvent.groupBy.mock.calls.length,
    events: db.acmeGuardrailEvent.findMany.mock.calls.length,
    sql: db.$queryRaw.mock.calls.length,
  };
}

describe("EYEON Guardrail decisions: access and reads (CHG-2026-133)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    page: envRecord.CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED,
    gateway: envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED,
    ceiling: envRecord.CAIRO_GUARDRAIL_MODE_MAX,
  };

  beforeEach(() => {
    envRecord.CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED = "true";
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "true";
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = "enforce";
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED = original.page;
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = original.gateway;
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = original.ceiling;
  });

  // Every role without projectGuardrails:read: the Prompt Analyst (MEMBER),
  // the Viewer, no role, and the Business Analyst (content-free, not on the
  // list either).
  it.each(["MEMBER", "VIEWER", "NONE", "ANALYST"])(
    "refuses %s before the database is touched, on both queries",
    async (role) => {
      await expect(callerFor(role).summary(INPUT_7)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        callerFor(role).status({ projectId: PROJECT }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it("refuses a project the viewer is not a member of, before any read", async () => {
    await expect(
      callerFor("OWNER").summary({
        projectId: "another-project",
        windowDays: 7,
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED|NOT_FOUND/),
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN", "SECURITY", "AUDITOR"])(
    "lets %s, who holds projectGuardrails:read, open the page",
    async (role) => {
      const { result } = await enabledSummary(role);
      expect(result.totals.checks).toBe(36);
      await expect(
        callerFor(role).status({ projectId: PROJECT }),
      ).resolves.toEqual({ enabled: true });
    },
  );

  it("says switched off, without touching the database, while the flag is off", async () => {
    envRecord.CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED = "false";
    await expect(callerFor("SECURITY").summary(INPUT_7)).resolves.toEqual({
      enabled: false,
    });
    await expect(
      callerFor("AUDITOR").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED = undefined;
    await expect(callerFor("OWNER").summary(INPUT_7)).resolves.toEqual({
      enabled: false,
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("status reports the flag without a database read", async () => {
    await expect(
      callerFor("SECURITY").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: true });
    expect(touched).not.toHaveBeenCalled();
  });

  it("refuses a period other than 7 or 30 days", async () => {
    await expect(
      callerFor("OWNER", fakePrisma()).summary({
        projectId: PROJECT,
        windowDays: 14 as 7,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("counts by verdict and direction; only a reported enforce is applied", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.totals).toMatchObject({
      checks: 36,
      promptChecks: 28,
      answerChecks: 8,
      allowed: 24,
      promptsRefused: { enforced: 2, notEnforced: 2 },
      answersWithheld: { enforced: 1, notEnforced: 1 },
      redactions: { enforced: 2, notEnforced: 3 },
      noVerdict: 1,
      enforcedChecks: 20,
    });
    expect(result.byDirection).toEqual({
      prompts: {
        checks: 28,
        allowed: 20,
        blocked: { enforced: 2, notEnforced: 2 },
        redacted: { enforced: 0, notEnforced: 3 },
        noVerdict: 1,
      },
      answers: {
        checks: 8,
        allowed: 4,
        blocked: { enforced: 1, notEnforced: 1 },
        redacted: { enforced: 2, notEnforced: 0 },
        noVerdict: 0,
      },
    });
    const projectGroupBy = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([args]) => args)
      .find(
        (args) =>
          args.by.includes("direction") &&
          args.by.length === 3 &&
          args.by.includes("action"),
      );
    expect(projectGroupBy?.where).toMatchObject({
      projectId: PROJECT,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
  });

  it("splits each day by verdict, applied apart from recorded, in SQL that applies the same rule", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.daily).toHaveLength(7);
    expect(result.daily[6]).toEqual({ day: today(), ...DAILY_ROW });
    expect(result.daily[0]).toMatchObject({ checks: 0, wouldBlock: 0 });
    const daily = db.$queryRaw.mock.calls
      .map(([first]) => sqlText(first))
      .find((sql) => sql.includes('"wouldBlock"'));
    expect(daily).toMatch(
      /action = 'block' AND gateway_mode = 'enforce'\)\)::int AS blocked/,
    );
    expect(daily).toMatch(
      /action = 'block' AND gateway_mode IS DISTINCT FROM 'enforce'\)\)::int AS "wouldBlock"/,
    );
    expect(daily).toMatch(
      /action = 'redact' AND gateway_mode IS DISTINCT FROM 'enforce'\)\)::int AS "wouldRedact"/,
    );
  });

  it("names refusals by type from the policy label only, split by the reported mode", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.refusalsByType).toEqual([
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 3,
        split: { enforced: 2, notEnforced: 1 },
        prompts: 3,
        answers: 0,
      },
      {
        type: "offTopic",
        label: "Off-topic or outside policy",
        count: 2,
        split: { enforced: 1, notEnforced: 1 },
        prompts: 0,
        answers: 2,
      },
      {
        type: "other",
        label: "Other",
        count: 1,
        split: { enforced: 0, notEnforced: 1 },
        prompts: 1,
        answers: 0,
      },
    ]);
    const refusals = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([args]) => args)
      .find((args) => args.by.includes("policyTriggered"));
    expect(refusals?.where).toMatchObject({
      projectId: PROJECT,
      action: BLOCK,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    // The caller-set label itself is never returned.
    expect(JSON.stringify(result)).not.toMatch(
      /Jailbreak Detection|Topical Rail/,
    );
  });

  it("lists the busiest callers, capped in the database, with applied and recorded refusals", async () => {
    const { result, db } = await enabledSummary("OWNER");
    expect(result.busiest).toEqual({
      shown: [
        {
          alias: V2,
          application: { lineageId: "lineage-1", name: "App lineage-1" },
          refusals: { enforced: 2, notEnforced: 2 },
          checks: 30,
          per100: (100 * 4) / 30,
        },
        {
          alias: OLD,
          application: null,
          refusals: { enforced: 0, notEnforced: 1 },
          checks: 12,
          per100: (100 * 1) / 12,
        },
        {
          alias: PROBE,
          application: null,
          refusals: { enforced: 0, notEnforced: 1 },
          checks: 4,
          per100: null,
        },
        {
          // A rotated key's alias still belongs to its application.
          alias: V1,
          application: { lineageId: "lineage-1", name: "App lineage-1" },
          refusals: { enforced: 1, notEnforced: 0 },
          checks: 2,
          per100: null,
        },
      ],
      total: 4,
      limit: BUSIEST_SHOWN,
      linksApplications: true,
    });
    const [first] = db.$queryRaw.mock.calls.find(([q]) =>
      sqlText(q).includes('"withRefusals"'),
    )!;
    expect(sqlText(first)).toMatch(
      /ORDER BY refusals DESC, alias ASC\s+LIMIT \?/,
    );
    expect(sqlText(first)).toMatch(/WHERE project_id = \?/);
    expect(sqlValues(first)).toContain(PROJECT);
    expect(sqlValues(first)).toContain(BUSIEST_SHOWN);
    const [keysArgs] = db.acmeLitellmKey.findMany.mock.calls[0]!;
    expect(keysArgs.where).toMatchObject({ projectId: PROJECT });
  });

  it.each(["SECURITY"])(
    "%s, who cannot open Applications, gets no application links and no key read",
    async (role) => {
      const { result, db } = await enabledSummary(role);
      expect(result.busiest.linksApplications).toBe(false);
      expect(result.busiest.shown.map((b) => b.application)).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(db.acmeLitellmKey.findMany).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("App lineage-1");
    },
  );

  it("the Auditor (evidence:read) gets the application links", async () => {
    const { result } = await enabledSummary("AUDITOR");
    expect(result.busiest.linksApplications).toBe(true);
    expect(result.busiest.shown[0]?.application).toEqual({
      lineageId: "lineage-1",
      name: "App lineage-1",
    });
  });

  it("links no application and reads no key while gateway management is off", async () => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "false";
    const { result, db } = await enabledSummary("OWNER");
    expect(result.busiest.linksApplications).toBe(false);
    expect(db.acmeLitellmKey.findMany).not.toHaveBeenCalled();
    expect(result.busiest.shown).toHaveLength(4);
  });

  it("reads no key when no caller had a refusal", async () => {
    const { result, db } = await enabledSummary(
      "OWNER",
      fakePrisma({ busiest: [] }),
    );
    expect(result.busiest).toMatchObject({ shown: [], total: 0 });
    expect(db.acmeLitellmKey.findMany).not.toHaveBeenCalled();
  });

  it("shows the served mode with its ceiling, never who set it", async () => {
    const { result } = await enabledSummary("SECURITY");
    expect(result.mode).toEqual({ mode: "enforce", ceiling: "enforce" });
    expect(JSON.stringify(result)).not.toContain("SECRET-");
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = undefined;
    const capped = await enabledSummary("SECURITY");
    expect(capped.result.mode).toEqual({ mode: "record", ceiling: "record" });
  });

  it("reports no mode when no guardrail settings are stored", async () => {
    const db = fakePrisma();
    db.acmeGuardrailSettings.findFirst.mockResolvedValue(
      undefined as unknown as typeof SETTINGS_ROW,
    );
    const { result } = await enabledSummary("SECURITY", db);
    expect(result.mode).toEqual({ mode: null, ceiling: "enforce" });
  });

  it("reports the judge's no-verdict rate over 24 hours against the 1% alert", async () => {
    const { result } = await enabledSummary("SECURITY");
    expect(result.judge).toEqual({
      windowHours: 24,
      checks: 100,
      noVerdict: 1,
      rate: 0.01,
      alertRate: 0.01,
      alert: true,
    });
  });

  it("selects, groups and queries no content column and no token hash, anywhere", async () => {
    const { result, db } = await enabledSummary("OWNER");
    expect(db.acmeLitellmKey.findMany).toHaveBeenCalledTimes(1);
    for (const [args] of db.acmeLitellmKey.findMany.mock.calls) {
      expect(Object.keys(args.select).sort()).toEqual(
        [
          "displayName",
          "generation",
          "lineageId",
          "litellmKeyAlias",
          "status",
        ].sort(),
      );
    }
    for (const [args] of db.acmeGuardrailEvent.groupBy.mock.calls) {
      for (const column of CONTENT_COLUMNS) {
        expect(args.by).not.toContain(column);
        expect(JSON.stringify(args)).not.toContain(column);
      }
    }
    expect(db.acmeGuardrailEvent.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    for (const [first] of db.$queryRaw.mock.calls) {
      expect(sqlText(first)).not.toMatch(CONTENT_SQL);
      expect(sqlText(first)).toMatch(/WHERE project_id = \?/);
    }
    const json = JSON.stringify(result);
    expect(json).not.toContain(TOKEN_HASH);
    expect(json).not.toMatch(/tokenHash|token_hash/);
  });

  it("reads a fixed number of times, with few events or many", async () => {
    const few = await enabledSummary(
      "OWNER",
      fakePrisma({ busiest: busiestRows(1), keys: KEY_ROWS.slice(0, 2) }),
    );
    const manyKeys = Array.from({ length: 40 }, (_, i) =>
      keyRow(`lineage-x${i}`, `cairo-app-${i}`, 1, AcmeLitellmKeyStatus.ACTIVE),
    );
    const many = await enabledSummary(
      "OWNER",
      fakePrisma({ busiest: busiestRows(4), keys: [...KEY_ROWS, ...manyKeys] }),
    );
    const expected = {
      keys: 1,
      settings: 1,
      settingsHistory: 0,
      groupBy: 3,
      events: 0,
      sql: 2,
    };
    expect(readCounts(few.db)).toEqual(expected);
    expect(readCounts(many.db)).toEqual(expected);
    // Without the right to open Applications, one read fewer.
    const security = await enabledSummary(
      "SECURITY",
      fakePrisma({ busiest: busiestRows(4) }),
    );
    expect(readCounts(security.db)).toEqual({ ...expected, keys: 0 });
  });
});
