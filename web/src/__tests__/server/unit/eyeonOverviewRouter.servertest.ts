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
import { eyeonOverviewRouter } from "@/src/features/acme-enhancements/server/eyeonOverviewRouter";
import { acmeApplicationsRouter } from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";
import { acmeGuardrailsRouter } from "@/src/features/acme-enhancements/server/acmeGuardrailsRouter";

// CHG-2026-132 (ADR-0027): the EYEON overview's access rules and reads,
// against a mocked Prisma. A role without the page's scopes is refused before
// the database is touched; with the flag off nothing is read; spend is absent
// without its scope; no content column is ever selected, grouped or queried;
// the number of reads does not grow with the data.
//
// CHG-2026-138 follow-up (owner decision, 2026-10-07): the enforcement card's
// last change of mode says who made it and the reason given, to every role
// that may open the overview, exactly as the Guardrails page shows them (the
// email to guardrail administrators only, never the user id).

const PROJECT = "proj-eyeon-overview";
const ORG = "org-eyeon-overview";
const TOKEN_HASH =
  "9b1d5e7f3a2c4b6d8e0f1a3c5e7b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c1e3b";
const V1 = "cairo-claims-bot-5e6f7a8b";
const V2 = "cairo-claims-bot-5e6f7a8b-r2";
const CONTENT_COLUMNS = [
  "redactedText",
  "piiFindings",
  "rawContentEncrypted",
  "tokenHash",
];
const CONTENT_SQL =
  /redacted_text|pii_findings|raw_content_encrypted|token_hash/;

const router = createTRPCRouter({
  eyeonOverview: eyeonOverviewRouter,
  acmeApplications: acmeApplicationsRouter,
  acmeGuardrails: acmeGuardrailsRouter,
});

function sessionFor(role: string, email: string | null = null): Session {
  return {
    expires: "1",
    user: {
      id: `user-${role}`,
      name: role,
      email,
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
function keyRow(lineage: string, alias: string, generation: number) {
  return {
    id: `key-${alias}`,
    lineageId: lineage,
    generation,
    displayName: `App ${lineage}`,
    litellmKeyAlias: alias,
    tokenHash: TOKEN_HASH,
    status:
      generation === 1 && alias === V1
        ? AcmeLitellmKeyStatus.ROTATED
        : AcmeLitellmKeyStatus.ACTIVE,
    models: ["claims-assistant"],
    rpmLimit: 20,
    maxBudget: 10,
    budgetDuration: "30d",
    expiresAt: null,
    createdAt: new Date(Date.now() - 86_400_000),
  };
}
const KEY_ROWS = [keyRow("lineage-1", V1, 1), keyRow("lineage-1", V2, 2)];

// Settings versions, ascending: the seeded record version, then a switch to
// enforce by a person. The reason is shown; the person's id never, and their
// email to guardrail administrators only.
const SETTINGS_ROWS = [
  {
    version: 1,
    mode: "record",
    piiEntities: ["EMAIL_ADDRESS"],
    jailbreakEnabled: true,
    topicalEnabled: true,
    reason: "Seeded first version",
    createdBy: "migration",
    createdByEmail: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    revertAt: null,
    automatic: false,
  },
  {
    version: 2,
    mode: "enforce",
    piiEntities: ["EMAIL_ADDRESS"],
    jailbreakEnabled: true,
    topicalEnabled: true,
    reason: "Reason typed for the switch",
    createdBy: "SECRET-USER-ID",
    createdByEmail: "EDITOR-EMAIL",
    createdAt: new Date("2026-10-05T09:00:00.000Z"),
    revertAt: null,
    automatic: false,
  },
];

const { INPUT, OUTPUT } = AcmeGuardrailEventDirection;
const { ALLOW, BLOCK, REDACT, UNAVAILABLE } = AcmeGuardrailEventAction;

/** The project's decisions by direction, verdict and mode. */
const PROJECT_GROUPS = [
  { direction: INPUT, action: ALLOW, gatewayMode: "enforce", n: 15 },
  // Another caller's checks, not an application's: counted project-wide.
  { direction: INPUT, action: ALLOW, gatewayMode: null, n: 5 },
  { direction: INPUT, action: BLOCK, gatewayMode: "enforce", n: 2 },
  { direction: INPUT, action: BLOCK, gatewayMode: "record", n: 1 },
  { direction: OUTPUT, action: BLOCK, gatewayMode: "record", n: 1 },
  { direction: INPUT, action: REDACT, gatewayMode: "record", n: 3 },
  { direction: INPUT, action: UNAVAILABLE, gatewayMode: null, n: 1 },
].map(({ n, ...g }) => ({ ...g, _count: { _all: n } }));

type GroupByArgs = { by: string[]; where: Record<string, unknown> };

function groupsFor(args: GroupByArgs) {
  if (args.by.includes("agentId")) {
    // The scorecards: the application's own decisions.
    return PROJECT_GROUPS.filter((g) => g.gatewayMode !== null).map((g) => ({
      ...g,
      agentId: V2,
      policyTriggered: g.action === BLOCK ? "Jailbreak Detection" : null,
    }));
  }
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

const today = () => new Date().toISOString().slice(0, 10);

function fakePrisma(keys: object[] = KEY_ROWS) {
  return {
    acmeLitellmKey: {
      findMany: vi.fn<
        (args: { select: Record<string, unknown> }) => Promise<unknown[]>
      >(async () => keys),
    },
    acmeGuardrailSettings: {
      findFirst: vi.fn(async () => SETTINGS_ROWS[1]),
      findMany: vi.fn(async () => [...SETTINGS_ROWS].reverse()),
    },
    acmeGuardrailEvent: {
      groupBy: vi.fn<(args: GroupByArgs) => Promise<unknown[]>>(async (args) =>
        groupsFor(args),
      ),
    },
    acmeLitellmRequestLog: {
      groupBy: vi.fn<(args: GroupByArgs) => Promise<unknown[]>>(async () => [
        {
          keyAlias: V2,
          status: "success",
          _count: { _all: 20 },
          _sum: { spend: 4 },
        },
      ]),
    },
    $queryRaw: vi.fn(async (first: unknown) => {
      const sql = sqlText(first);
      if (sql.includes('"promptsRefused"'))
        return [
          {
            day: today(),
            checks: 28,
            promptsRefused: 3,
            answersWithheld: 1,
            redactions: 3,
            noVerdict: 1,
          },
        ];
      if (sql.includes("acme_litellm_request_logs"))
        return [{ alias: V2, day: today(), n: 20 }];
      return [{ alias: V2, day: today(), n: 2 }];
    }),
  };
}

function rootCallerFor(role: string, db: object, email: string | null = null) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role, email),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: db as typeof ctx.prisma,
  });
}

function callerFor(
  role: string,
  db: object = explodingPrisma,
  email: string | null = null,
) {
  return rootCallerFor(role, db, email).eyeonOverview;
}

const INPUT_7 = { projectId: PROJECT, windowDays: 7 as const };

async function enabledSummary(
  role: string,
  db = fakePrisma(),
  email: string | null = null,
) {
  const result = await callerFor(role, db, email).summary(INPUT_7);
  if (!result.enabled) throw new Error("expected the overview to be enabled");
  return { result, db };
}

describe("EYEON overview: access and reads (CHG-2026-132)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    overview: envRecord.CAIRO_EYEON_OVERVIEW_ENABLED,
    gateway: envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED,
    ceiling: envRecord.CAIRO_GUARDRAIL_MODE_MAX,
    admins: envRecord.CAIRO_GUARDRAIL_ADMINS,
    signup: envRecord.AUTH_DISABLE_SIGNUP,
  };

  beforeEach(() => {
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = "true";
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "true";
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = "enforce";
    envRecord.CAIRO_GUARDRAIL_ADMINS = undefined;
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = original.overview;
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = original.gateway;
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = original.ceiling;
    envRecord.CAIRO_GUARDRAIL_ADMINS = original.admins;
    envRecord.AUTH_DISABLE_SIGNUP = original.signup;
  });

  it.each(["MEMBER", "VIEWER", "NONE", "SECURITY", "ANALYST"])(
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

  it("says switched off, without touching the database, while the flag is off", async () => {
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = "false";
    await expect(callerFor("OWNER").summary(INPUT_7)).resolves.toEqual({
      enabled: false,
    });
    await expect(
      callerFor("AUDITOR").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_OVERVIEW_ENABLED = undefined;
    await expect(callerFor("ADMIN").summary(INPUT_7)).resolves.toEqual({
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

  it("refuses a period other than 7 or 30 days", async () => {
    await expect(
      callerFor("OWNER", fakePrisma()).summary({
        projectId: PROJECT,
        windowDays: 14 as 7,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(["OWNER", "ADMIN"])("%s sees spend against budget", async (role) => {
    const { result } = await enabledSummary(role);
    expect(result.canSeeSpend).toBe(true);
    expect(result.spend).toEqual({
      shown: [
        {
          name: "App lineage-1",
          alias: V2,
          spentUsd: 4,
          budgetUsd: 10,
          budgetDuration: "30d",
          usedPct: 40,
        },
      ],
      withBudget: 1,
      withoutBudget: 0,
      totalUsd: 4,
    });
  });

  it("the Auditor sees the overview without spend: the field is absent", async () => {
    const { result } = await enabledSummary("AUDITOR");
    expect(result.canSeeSpend).toBe(false);
    expect(result).not.toHaveProperty("spend");
    expect(result.applications).toMatchObject({ total: 1 });
    expect(JSON.stringify(result)).not.toMatch(/\$4\.00|"spentUsd"|"totalUsd"/);
  });

  it("counts every guardrail check in the project, split by the mode the gateway reported", async () => {
    const { result, db } = await enabledSummary("OWNER");
    expect(result.decisions).toEqual({
      checks: 28,
      promptChecks: 27,
      answerChecks: 1,
      allowed: 20,
      promptsRefused: { enforced: 2, notEnforced: 1 },
      answersWithheld: { enforced: 0, notEnforced: 1 },
      redactions: { enforced: 0, notEnforced: 3 },
      noVerdict: 1,
      enforcedChecks: 17,
      enforcedPct: (100 * 17) / 28,
    });
    const projectGroupBy = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([args]) => args)
      .find(
        (args) =>
          args.by.includes("gatewayMode") && !args.by.includes("agentId"),
      );
    expect(projectGroupBy?.by).toEqual(["direction", "action", "gatewayMode"]);
    expect(projectGroupBy?.where).toMatchObject({
      projectId: PROJECT,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    expect(result.daily).toHaveLength(7);
    expect(result.daily[6]).toEqual({
      day: today(),
      checks: 28,
      promptsRefused: 3,
      answersWithheld: 1,
      redactions: 3,
      noVerdict: 1,
    });
    expect(result.judge).toMatchObject({
      windowHours: 24,
      checks: 100,
      noVerdict: 1,
      rate: 0.01,
      alert: true,
    });
  });

  it("shows the served mode with its ceiling, and the last change with who made it and why", async () => {
    const { result } = await enabledSummary("AUDITOR");
    expect(result.mode).toEqual({
      mode: "enforce",
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: {
        at: "2026-10-05T09:00:00.000Z",
        to: "enforce",
        automatic: false,
        // Not a guardrail administrator: no email, as on the Guardrails
        // page, so the card says "a guardrail administrator".
        createdByEmail: null,
        reason: "Reason typed for the switch",
      },
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("SECRET-");

    envRecord.CAIRO_GUARDRAIL_MODE_MAX = undefined;
    const capped = await enabledSummary("AUDITOR");
    expect(capped.result.mode).toMatchObject({
      mode: "record",
      ceiling: "record",
    });
  });

  it("reports no mode when no guardrail settings are stored", async () => {
    const db = fakePrisma();
    db.acmeGuardrailSettings.findFirst.mockResolvedValue(
      undefined as unknown as (typeof SETTINGS_ROWS)[number],
    );
    db.acmeGuardrailSettings.findMany.mockResolvedValue([]);
    const { result } = await enabledSummary("OWNER", db);
    expect(result.mode).toMatchObject({ mode: null, lastChange: null });
  });

  it.each(["OWNER", "ADMIN", "AUDITOR"])(
    "returns who made the last change and the reason given to %s, and nothing else about the person",
    async (role) => {
      const { result } = await enabledSummary(role);
      expect(result.mode.lastChange).toMatchObject({
        automatic: false,
        createdByEmail: null,
        reason: "Reason typed for the switch",
      });
      const json = JSON.stringify(result.mode);
      expect(json).not.toContain("SECRET-USER-ID");
      expect(json).not.toContain("EDITOR-EMAIL");
      expect(json).not.toMatch(/"createdBy"|"userId"/);
    },
  );

  it("gives a guardrail administrator the person's email, as the Guardrails page does, never the user id", async () => {
    envRecord.CAIRO_GUARDRAIL_ADMINS = "guardrail-admin";
    envRecord.AUTH_DISABLE_SIGNUP = "true";
    for (const role of ["OWNER", "AUDITOR"]) {
      const { result } = await enabledSummary(
        role,
        fakePrisma(),
        "guardrail-admin",
      );
      expect(result.mode.lastChange?.createdByEmail).toBe("EDITOR-EMAIL");
      expect(JSON.stringify(result)).not.toMatch(/SECRET-USER-ID|"createdBy"/);
    }
    const other = await enabledSummary("ADMIN", fakePrisma(), "someone-else");
    expect(other.result.mode.lastChange?.createdByEmail).toBeNull();
    // A listed address while open sign-up is on is not an administrator.
    envRecord.AUTH_DISABLE_SIGNUP = undefined;
    const signupOpen = await enabledSummary(
      "OWNER",
      fakePrisma(),
      "guardrail-admin",
    );
    expect(signupOpen.result.mode.lastChange?.createdByEmail).toBeNull();
  });

  it("says an automatic switch-back made the last change, instead of a person", async () => {
    envRecord.CAIRO_GUARDRAIL_ADMINS = "guardrail-admin";
    envRecord.AUTH_DISABLE_SIGNUP = "true";
    const db = fakePrisma();
    const automatic = {
      ...SETTINGS_ROWS[1]!,
      version: 3,
      mode: "record",
      reason: "Automatic switch-back to record",
      createdBy: "automatic",
      createdByEmail: null,
      createdAt: new Date("2026-10-05T09:30:00.000Z"),
      automatic: true,
    };
    db.acmeGuardrailSettings.findFirst.mockResolvedValue(automatic);
    db.acmeGuardrailSettings.findMany.mockResolvedValue(
      [...SETTINGS_ROWS, automatic].reverse(),
    );
    const { result } = await enabledSummary("OWNER", db, "guardrail-admin");
    expect(result.mode.lastChange).toEqual({
      at: "2026-10-05T09:30:00.000Z",
      to: "record",
      automatic: true,
      createdByEmail: null,
      reason: "Automatic switch-back to record",
    });
  });

  it.each([
    ["OWNER", null],
    ["AUDITOR", null],
    ["OWNER", "guardrail-admin"],
    ["AUDITOR", "guardrail-admin"],
  ] as const)(
    "shows %s (email %s) who and why exactly as the Guardrails page's mode changes do",
    async (role, email) => {
      envRecord.CAIRO_GUARDRAIL_ADMINS = "guardrail-admin";
      envRecord.AUTH_DISABLE_SIGNUP = "true";
      const { result } = await enabledSummary(role, fakePrisma(), email);
      const [newest] = await rootCallerFor(
        role,
        fakePrisma(),
        email,
      ).acmeGuardrails.modeChanges({ projectId: PROJECT });
      expect(result.mode.lastChange).toMatchObject({
        automatic: newest?.automatic,
        createdByEmail: newest?.createdByEmail,
        reason: newest?.reason,
      });
    },
  );

  it("rates no applications and shows no spend while gateway management is off", async () => {
    envRecord.CAIRO_LITELLM_MANAGEMENT_ENABLED = "false";
    const { result, db } = await enabledSummary("OWNER");
    expect(result.applications).toBeNull();
    expect(result).not.toHaveProperty("spend");
    expect(result.decisions.checks).toBe(28);
    expect(result.mode.mode).toBe("enforce");
    expect(db.acmeLitellmKey.findMany).not.toHaveBeenCalled();
    expect(db.acmeLitellmRequestLog.groupBy).not.toHaveBeenCalled();
    expect(db.acmeGuardrailSettings.findFirst).toHaveBeenCalledTimes(1);
  });

  it("reuses the Applications scorecard: the same applications, bands and top risks", async () => {
    const { result } = await enabledSummary("OWNER");
    expect(result.applications?.byOverall).toEqual({
      red: expect.any(Number),
      amber: expect.any(Number),
      green: expect.any(Number),
      none: expect.any(Number),
    });
    expect(
      Object.values(result.applications!.byOverall).reduce((a, b) => a + b, 0),
    ).toBe(1);
    expect(result.applications?.topRisks.risks.length).toBeGreaterThan(0);
    for (const r of result.applications!.topRisks.risks) {
      expect(r.alias).toBe(V2);
    }
  });

  it.each(["OWNER", "AUDITOR"])(
    "rates applications for %s exactly as the Applications page does (one loader)",
    async (role) => {
      const { result } = await enabledSummary(role);
      const page = await rootCallerFor(
        role,
        fakePrisma(),
      ).acmeApplications.scorecards({ projectId: PROJECT, windowDays: 7 });
      if (!page.enabled) throw new Error("expected the scorecards");
      expect(result.applications).toEqual({
        total: page.summary.applications,
        byOverall: page.summary.byOverall,
        topRisks: page.summary.topRisks,
        missingBudget: page.summary.missingBudget,
      });
      expect(result.canSeeSpend).toBe(page.canSeeSpend);
    },
  );

  it("selects, groups and queries no content column and no token hash, anywhere", async () => {
    const { result, db } = await enabledSummary("OWNER");
    for (const [args] of db.acmeLitellmKey.findMany.mock.calls) {
      for (const column of CONTENT_COLUMNS)
        expect(args.select).not.toHaveProperty(column);
    }
    for (const [args] of [
      ...db.acmeGuardrailEvent.groupBy.mock.calls,
      ...db.acmeLitellmRequestLog.groupBy.mock.calls,
    ]) {
      for (const column of CONTENT_COLUMNS)
        expect(args.by).not.toContain(column);
    }
    expect(db.$queryRaw.mock.calls.length).toBeGreaterThan(0);
    for (const [first] of db.$queryRaw.mock.calls) {
      expect(sqlText(first)).not.toMatch(CONTENT_SQL);
    }
    const json = JSON.stringify(result);
    expect(json).not.toContain(TOKEN_HASH);
    expect(json).not.toMatch(/tokenHash|token_hash/);
  });

  it("reads a fixed number of times, however many applications there are", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      keyRow(`lineage-${i + 2}`, `cairo-app-${i}`, 1),
    );
    const small = await enabledSummary("OWNER");
    const large = await enabledSummary(
      "OWNER",
      fakePrisma([...KEY_ROWS, ...many]),
    );
    const counts = (db: ReturnType<typeof fakePrisma>) => [
      db.acmeLitellmKey.findMany.mock.calls.length,
      db.acmeGuardrailSettings.findFirst.mock.calls.length,
      db.acmeGuardrailSettings.findMany.mock.calls.length,
      db.acmeGuardrailEvent.groupBy.mock.calls.length,
      db.acmeLitellmRequestLog.groupBy.mock.calls.length,
      db.$queryRaw.mock.calls.length,
    ];
    expect(counts(small.db)).toEqual([1, 1, 1, 3, 1, 3]);
    expect(counts(large.db)).toEqual(counts(small.db));
    expect(large.result.applications?.total).toBe(13);
  });
});
