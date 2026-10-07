import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
} from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import {
  MODE_CHANGES_SHOWN,
  eyeonEnforcementRouter,
} from "@/src/features/acme-enhancements/server/eyeonEnforcementRouter";
import { MAX_LISTED_PODS } from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

// CHG-2026-138 (ADR-0027): the EYEON Enforcement and policy page's access
// rules and reads, against a mocked Prisma. A role without
// projectGuardrails:read is refused before the database is touched; with the
// flag off nothing is read; no content column is ever selected, grouped or
// queried; who changed the mode, and the reason given, never reach the page;
// gateway replicas are counted, not named; the number of reads does not grow
// with the data.

const PROJECT = "proj-eyeon-enforcement";
const ORG = "org-eyeon-enforcement";
const CONTENT_COLUMNS = [
  "redactedText",
  "piiFindings",
  "rawContentEncrypted",
  "tokenHash",
];
const CONTENT_SQL =
  /redacted_text|pii_findings|raw_content_encrypted|token_hash/;

const router = createTRPCRouter({ eyeonEnforcement: eyeonEnforcementRouter });

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

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A settings version as the table holds it, with who and why. */
function version(
  v: number,
  at: number,
  mode: "record" | "enforce",
  extra: Partial<{
    revertAt: Date | null;
    automatic: boolean;
    createdBy: string;
    topicalEnabled: boolean;
  }> = {},
) {
  return {
    id: `settings-${v}`,
    version: v,
    mode,
    piiEntities: ["BH_CPR", "EMAIL_ADDRESS"],
    jailbreakEnabled: true,
    topicalEnabled: extra.topicalEnabled ?? false,
    reason: `SECRET-REASON-${v} for this change`,
    createdBy: extra.createdBy ?? `SECRET-USER-ID-${v}`,
    createdByEmail: `SECRET-EMAIL-${v}`,
    projectId: PROJECT,
    createdAt: new Date(at),
    revertAt: extra.revertAt ?? null,
    automatic: extra.automatic ?? false,
  };
}

const TRIAL_AT = NOW - 20 * DAY;
/** Oldest first: seed, a 30-minute trial, its automatic end, a policy change, enforce. */
const VERSIONS = [
  version(1, NOW - 40 * DAY, "record", { createdBy: "migration" }),
  version(2, TRIAL_AT, "enforce", { revertAt: new Date(TRIAL_AT + 30 * MIN) }),
  version(3, TRIAL_AT + 30 * MIN + 20_000, "record", {
    automatic: true,
    createdBy: "automatic",
  }),
  version(4, NOW - 10 * DAY, "record"),
  version(5, NOW - 2 * HOUR, "enforce"),
];
const CURRENT = VERSIONS[VERSIONS.length - 1]!;

const { INPUT, OUTPUT } = AcmeGuardrailEventDirection;
const { ALLOW, BLOCK, REDACT } = AcmeGuardrailEventAction;

/** The project's decisions by direction, verdict and the reported mode. */
const PROJECT_GROUPS = [
  { direction: INPUT, action: ALLOW, gatewayMode: "enforce", n: 15 },
  { direction: INPUT, action: ALLOW, gatewayMode: null, n: 5 },
  { direction: OUTPUT, action: ALLOW, gatewayMode: "record", n: 4 },
  { direction: INPUT, action: BLOCK, gatewayMode: "enforce", n: 2 },
  { direction: INPUT, action: BLOCK, gatewayMode: "record", n: 1 },
  { direction: OUTPUT, action: REDACT, gatewayMode: "enforce", n: 2 },
  { direction: INPUT, action: REDACT, gatewayMode: "record", n: 3 },
].map(({ n, ...g }) => ({ ...g, _count: { _all: n } }));

/** Refusals by the caller-set policy label, direction and mode. */
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
  {
    policyTriggered: "Topical Rail",
    direction: OUTPUT,
    gatewayMode: "record",
    n: 1,
  },
  {
    policyTriggered: "Input too large",
    direction: INPUT,
    gatewayMode: "enforce",
    n: 1,
  },
  { policyTriggered: null, direction: INPUT, gatewayMode: null, n: 1 },
].map(({ n, ...g }) => ({ ...g, _count: { _all: n } }));

/** Gateway replicas' latest reports; their names must never be returned. */
function gatewayGroups(count = 3) {
  const all = [
    { pod: "gw-pod-SECRET-1", mode: "enforce", version: 5, ago: MIN },
    { pod: "gw-pod-SECRET-2", mode: "enforce", version: 5, ago: 2 * MIN },
    // Last seen before the change to enforce: not compared.
    { pod: "gw-pod-SECRET-3", mode: "record", version: 4, ago: 5 * HOUR },
  ];
  const extra = Array.from({ length: Math.max(0, count - 3) }, (_, i) => ({
    pod: `gw-pod-SECRET-x${i}`,
    mode: "enforce",
    version: 5,
    ago: 3 * MIN,
  }));
  return [...all, ...extra].slice(0, count).map((g) => ({
    gatewayPod: g.pod,
    gatewayMode: g.mode,
    gatewaySettingsVersion: g.version,
    _max: { eventTime: new Date(NOW - g.ago) },
  }));
}

function podRows(count = 3) {
  const rows = [
    {
      pod: "guard-pod-a",
      appliedVersion: 5,
      lastSyncAt: new Date(NOW - 10_000),
    },
    {
      pod: "guard-pod-b",
      appliedVersion: 4,
      lastSyncAt: new Date(NOW - 20_000),
    },
    { pod: "guard-pod-c", appliedVersion: 4, lastSyncAt: new Date(NOW - HOUR) },
  ];
  const extra = Array.from({ length: Math.max(0, count - 3) }, (_, i) => ({
    pod: `guard-pod-x${i}`,
    appliedVersion: 5,
    lastSyncAt: new Date(NOW - 5_000),
  }));
  return [...rows, ...extra].slice(0, count);
}

type GroupByArgs = {
  by: string[];
  where: Record<string, unknown>;
  [key: string]: unknown;
};

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

function fakePrisma(
  opts: {
    versions?: ReturnType<typeof version>[];
    pods?: object[];
    gateways?: object[];
  } = {},
) {
  const versions = opts.versions ?? VERSIONS;
  const pods = opts.pods ?? podRows();
  const gateways = opts.gateways ?? gatewayGroups();
  return {
    acmeGuardrailSettings: {
      findFirst: vi.fn(async () => versions[versions.length - 1] ?? null),
      // listModeChanges reads the newest first.
      findMany: vi.fn(async () => [...versions].reverse()),
    },
    acmeGuardrailSettingsPod: {
      findMany: vi.fn<
        (args: {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
          take: number;
        }) => Promise<unknown[]>
      >(async () => pods),
    },
    acmeGuardrailEvent: {
      groupBy: vi.fn<(args: GroupByArgs) => Promise<unknown[]>>(
        async (args) => {
          if (args.by.includes("policyTriggered")) return REFUSAL_GROUPS;
          if (args.by.includes("gatewayPod")) return gateways;
          if (args.by.length === 1 && args.by[0] === "action")
            return [
              { action: "ALLOW", _count: { _all: 99 } },
              { action: "UNAVAILABLE", _count: { _all: 1 } },
            ];
          return PROJECT_GROUPS;
        },
      ),
      findMany: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async (first: unknown) => {
      const sql = sqlText(first);
      if (sql.includes('"enforceMode"'))
        return [{ day: today(), checks: 32, enforceMode: 19, recordMode: 8 }];
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

function callerFor(
  role: string,
  db: object = explodingPrisma,
  email: string | null = null,
) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role, email),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: db as typeof ctx.prisma,
  }).eyeonEnforcement;
}

const INPUT_7 = { projectId: PROJECT, windowDays: 7 as const };

async function enabledSummary(
  role: string,
  db = fakePrisma(),
  email: string | null = null,
) {
  const result = await callerFor(role, db, email).summary(INPUT_7);
  if (!result.enabled) throw new Error("expected the page to be enabled");
  return { result, db };
}

/** How many times each read was made. */
function readCounts(db: ReturnType<typeof fakePrisma>) {
  return {
    settings: db.acmeGuardrailSettings.findFirst.mock.calls.length,
    settingsHistory: db.acmeGuardrailSettings.findMany.mock.calls.length,
    pods: db.acmeGuardrailSettingsPod.findMany.mock.calls.length,
    groupBy: db.acmeGuardrailEvent.groupBy.mock.calls.length,
    events: db.acmeGuardrailEvent.findMany.mock.calls.length,
    sql: db.$queryRaw.mock.calls.length,
  };
}

describe("EYEON Enforcement and policy: access and reads (CHG-2026-138)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    page: envRecord.CAIRO_EYEON_ENFORCEMENT_ENABLED,
    ceiling: envRecord.CAIRO_GUARDRAIL_MODE_MAX,
    admins: envRecord.CAIRO_GUARDRAIL_ADMINS,
    signup: envRecord.AUTH_DISABLE_SIGNUP,
  };

  beforeEach(() => {
    envRecord.CAIRO_EYEON_ENFORCEMENT_ENABLED = "true";
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = "enforce";
    envRecord.CAIRO_GUARDRAIL_ADMINS = undefined;
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_EYEON_ENFORCEMENT_ENABLED = original.page;
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = original.ceiling;
    envRecord.CAIRO_GUARDRAIL_ADMINS = original.admins;
    envRecord.AUTH_DISABLE_SIGNUP = original.signup;
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
      expect(result.mode.mode).toBe("enforce");
      await expect(
        callerFor(role).status({ projectId: PROJECT }),
      ).resolves.toEqual({ enabled: true });
    },
  );

  it("says switched off, without touching the database, while the flag is off", async () => {
    envRecord.CAIRO_EYEON_ENFORCEMENT_ENABLED = "false";
    await expect(callerFor("SECURITY").summary(INPUT_7)).resolves.toEqual({
      enabled: false,
    });
    await expect(
      callerFor("AUDITOR").status({ projectId: PROJECT }),
    ).resolves.toEqual({ enabled: false });
    envRecord.CAIRO_EYEON_ENFORCEMENT_ENABLED = undefined;
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

  it("serves the mode against its ceiling, with the Guardrails page's functions", async () => {
    const { result } = await enabledSummary("SECURITY");
    expect(result.mode).toEqual({
      mode: "enforce",
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: {
        at: CURRENT.createdAt.toISOString(),
        to: "enforce",
        automatic: false,
      },
      version: 5,
      storedMode: "enforce",
      cappedByCeiling: false,
      switchBackDue: false,
    });
    // An unset ceiling is record: the stored enforce is served as record.
    envRecord.CAIRO_GUARDRAIL_MODE_MAX = undefined;
    const capped = await enabledSummary("SECURITY");
    expect(capped.result.mode).toMatchObject({
      mode: "record",
      ceiling: "record",
      storedMode: "enforce",
      cappedByCeiling: true,
    });
  });

  it("serves a running trial's switch-back time, and an ended one as record", async () => {
    const running = [
      ...VERSIONS.slice(0, 4),
      version(5, NOW - 5 * MIN, "enforce", {
        revertAt: new Date(NOW + 25 * MIN),
      }),
    ];
    const { result } = await enabledSummary(
      "OWNER",
      fakePrisma({ versions: running }),
    );
    expect(result.mode.trialEndsAt).toBe(
      new Date(NOW + 25 * MIN).toISOString(),
    );
    expect(result.trial.last).toMatchObject({
      outcome: "running",
      minutes: 30,
    });

    const ended = [
      ...VERSIONS.slice(0, 4),
      version(5, NOW - 40 * MIN, "enforce", {
        revertAt: new Date(NOW - 10 * MIN),
      }),
    ];
    const after = await enabledSummary(
      "OWNER",
      fakePrisma({ versions: ended }),
    );
    expect(after.result.mode).toMatchObject({
      mode: "record",
      switchBackDue: true,
      trialEndsAt: null,
    });
    expect(after.result.trial.last?.outcome).toBe("servedAsRecord");
  });

  it("reports no mode and no policies when no settings are stored", async () => {
    const { result } = await enabledSummary(
      "AUDITOR",
      fakePrisma({ versions: [] }),
    );
    expect(result.mode).toMatchObject({
      mode: null,
      version: null,
      lastChange: null,
    });
    expect(result.policies).toBeNull();
    expect(result.pods.agree).toBeNull();
    expect(result.history).toMatchObject({ shown: [], total: 0 });
  });

  it("computes the enforce share as the overview does", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.decisions).toMatchObject({
      checks: 32,
      enforcedChecks: 19,
      enforcedPct: (100 * 19) / 32,
      redactions: { enforced: 2, notEnforced: 3 },
    });
    const projectGroupBy = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([args]) => args)
      .find((args) => args.by.join() === "direction,action,gatewayMode");
    expect(projectGroupBy?.where).toMatchObject({
      projectId: PROJECT,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
  });

  it("splits each day's checks by the mode the gateway reported, in SQL scoped to the project", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.daily).toHaveLength(7);
    expect(result.daily[6]).toEqual({
      day: today(),
      checks: 32,
      enforceMode: 19,
      recordMode: 8,
      notReported: 5,
    });
    expect(result.daily[0]).toMatchObject({ checks: 0, notReported: 0 });
    const [first] = db.$queryRaw.mock.calls[0]!;
    expect(sqlText(first)).toMatch(
      /FILTER \(WHERE gateway_mode = 'enforce'\)\)::int AS "enforceMode"/,
    );
    expect(sqlText(first)).toMatch(
      /FILTER \(WHERE gateway_mode = 'record'\)\)::int AS "recordMode"/,
    );
    expect(sqlText(first)).toMatch(/WHERE project_id = \?/);
    expect(sqlValues(first)).toContain(PROJECT);
  });

  it("lists the changes of mode, newest first: when and to what, never who or why", async () => {
    const { result } = await enabledSummary("AUDITOR");
    expect(result.history).toEqual({
      shown: [
        {
          version: 5,
          at: VERSIONS[4]!.createdAt.toISOString(),
          from: "record",
          to: "enforce",
          switchBackAt: null,
          automatic: false,
          inPeriod: true,
        },
        {
          version: 3,
          at: VERSIONS[2]!.createdAt.toISOString(),
          from: "enforce",
          to: "record",
          switchBackAt: null,
          automatic: true,
          inPeriod: false,
        },
        {
          version: 2,
          at: VERSIONS[1]!.createdAt.toISOString(),
          from: "record",
          to: "enforce",
          switchBackAt: new Date(TRIAL_AT + 30 * MIN).toISOString(),
          automatic: false,
          inPeriod: false,
        },
      ],
      inPeriod: 1,
      total: 3,
      limit: MODE_CHANGES_SHOWN,
    });
    expect(result.trial).toEqual({
      last: {
        startedAt: new Date(TRIAL_AT).toISOString(),
        switchBackAt: new Date(TRIAL_AT + 30 * MIN).toISOString(),
        minutes: 30,
        outcome: "automatic",
        endedAt: VERSIONS[2]!.createdAt.toISOString(),
        endedTo: "record",
      },
      defaultMinutes: 30,
      options: [5, 15, 30, 60, 120],
    });
  });

  it.each(["OWNER", "SECURITY", "AUDITOR"])(
    "never returns who changed a setting, their email or the reason, to %s",
    async (role) => {
      const { result } = await enabledSummary(role);
      const json = JSON.stringify(result);
      expect(json).not.toContain("SECRET-");
      expect(json).not.toMatch(/createdBy|createdByEmail|"reason"/);
      expect(json).not.toContain("migration");
    },
  );

  it("tells pod agreement in settings versions, stale pods apart", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.pods).toEqual({
      pods: [
        {
          name: "guard-pod-a",
          appliedVersion: 5,
          lastReportAt: new Date(NOW - 10_000).toISOString(),
          status: "current",
        },
        {
          name: "guard-pod-b",
          appliedVersion: 4,
          lastReportAt: new Date(NOW - 20_000).toISOString(),
          status: "older",
        },
        {
          name: "guard-pod-c",
          appliedVersion: 4,
          lastReportAt: new Date(NOW - HOUR).toISOString(),
          status: "stale",
        },
      ],
      reporting: 2,
      onCurrent: 1,
      stale: 1,
      currentVersion: 5,
      staleAfterSeconds: 120,
      agree: false,
    });
    const [args] = db.acmeGuardrailSettingsPod.findMany.mock.calls[0]!;
    expect(Object.keys(args.select).sort()).toEqual(
      ["appliedVersion", "lastSyncAt", "pod"].sort(),
    );
    expect(args.take).toBe(MAX_LISTED_PODS);
    expect(args.where).toMatchObject({ lastSyncAt: { gte: expect.any(Date) } });
  });

  it("counts gateway replicas by reported mode, never by name", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.gateways).toEqual({
      replicas: 3,
      byMode: { enforce: 2, record: 1, notReported: 0 },
      versions: [4, 5],
      sameMode: false,
      // The replica last seen before the change to enforce is not compared.
      matchesServed: true,
      beforeLastChange: 1,
      lastSeenAt: new Date(NOW - MIN).toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain("gw-pod");
    const gatewayArgs = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([a]) => a)
      .find((a) => a.by.includes("gatewayPod"));
    expect(gatewayArgs?.where).toMatchObject({ projectId: PROJECT });
  });

  it("shows the policies in force with what each flagged, never the caller-set label", async () => {
    const { result, db } = await enabledSummary("AUDITOR");
    expect(result.policies).toEqual({
      version: 5,
      savedAt: CURRENT.createdAt.toISOString(),
      jailbreak: {
        enabled: true,
        refusals: { enforced: 2, notEnforced: 1, prompts: 3, answers: 0 },
      },
      topical: {
        enabled: false,
        refusals: { enforced: 0, notEnforced: 1, prompts: 0, answers: 1 },
      },
      personalData: {
        entities: ["EMAIL_ADDRESS", "BH_CPR"],
        available: 7,
        redactions: { enforced: 2, notEnforced: 3 },
      },
      oversized: {
        refusals: { enforced: 1, notEnforced: 0, prompts: 1, answers: 0 },
      },
      other: {
        refusals: { enforced: 0, notEnforced: 1, prompts: 1, answers: 0 },
        types: ["Other"],
      },
    });
    const refusals = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([a]) => a)
      .find((a) => a.by.includes("policyTriggered"));
    expect(refusals?.where).toMatchObject({
      projectId: PROJECT,
      action: BLOCK,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Jailbreak Detection|Topical Rail|Input too large/,
    );
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

  it("offers no switch: says only whether the viewer could switch on the Guardrails page", async () => {
    envRecord.CAIRO_GUARDRAIL_ADMINS = "guardrail-admin";
    envRecord.AUTH_DISABLE_SIGNUP = "true";
    const owner = await enabledSummary(
      "OWNER",
      fakePrisma(),
      "guardrail-admin",
    );
    expect(owner.result.viewerCanSwitch).toBe(true);
    // A listed administrator in a content-free role stays read-only.
    const security = await enabledSummary(
      "SECURITY",
      fakePrisma(),
      "guardrail-admin",
    );
    expect(security.result.viewerCanSwitch).toBe(false);
    const other = await enabledSummary("ADMIN", fakePrisma(), "someone-else");
    expect(other.result.viewerCanSwitch).toBe(false);
    expect(Object.keys(eyeonEnforcementRouter._def.procedures).sort()).toEqual(
      ["status", "summary"].sort(),
    );
  });

  it("selects, groups and queries no content column and no token hash, anywhere", async () => {
    const { result, db } = await enabledSummary("OWNER");
    for (const [args] of db.acmeGuardrailEvent.groupBy.mock.calls) {
      for (const column of CONTENT_COLUMNS) {
        expect(args.by).not.toContain(column);
        expect(JSON.stringify(args)).not.toContain(column);
      }
    }
    for (const [args] of db.acmeGuardrailSettingsPod.findMany.mock.calls) {
      for (const column of CONTENT_COLUMNS)
        expect(JSON.stringify(args)).not.toContain(column);
    }
    expect(db.acmeGuardrailEvent.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    for (const [first] of db.$queryRaw.mock.calls) {
      expect(sqlText(first)).not.toMatch(CONTENT_SQL);
      expect(sqlText(first)).toMatch(/WHERE project_id = \?/);
    }
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/tokenHash|token_hash/);
    for (const column of CONTENT_COLUMNS) expect(json).not.toContain(column);
  });

  it("reads a fixed number of times, with little data or much", async () => {
    const few = await enabledSummary(
      "OWNER",
      fakePrisma({
        versions: VERSIONS.slice(0, 1),
        pods: podRows(1),
        gateways: gatewayGroups(1),
      }),
    );
    const manyVersions = Array.from({ length: 60 }, (_, i) =>
      version(i + 1, NOW - (60 - i) * HOUR, i % 2 === 0 ? "record" : "enforce"),
    );
    const many = await enabledSummary(
      "OWNER",
      fakePrisma({
        versions: manyVersions,
        pods: podRows(30),
        gateways: gatewayGroups(40),
      }),
    );
    const expected = {
      settings: 1,
      settingsHistory: 1,
      pods: 1,
      groupBy: 4,
      events: 0,
      sql: 1,
    };
    expect(readCounts(few.db)).toEqual(expected);
    expect(readCounts(many.db)).toEqual(expected);
    expect(many.result.history.shown).toHaveLength(MODE_CHANGES_SHOWN);
    expect(many.result.history.total).toBeGreaterThan(MODE_CHANGES_SHOWN);
  });
});
