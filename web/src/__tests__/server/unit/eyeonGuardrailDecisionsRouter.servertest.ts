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
  CALLERS_LISTED,
  eyeonGuardrailDecisionsRouter,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisionsRouter";
import { ENTITY_TYPES_SHOWN } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";

// CHG-2026-133 (ADR-0027): the EYEON Guardrail decisions page's access rules
// and reads, against a mocked Prisma. A role without projectGuardrails:read
// is refused before the database is touched; with the flag off nothing is
// read; keys are read only for a viewer who may open Applications; no content
// column is ever selected, grouped or queried; only a reported "enforce"
// counts as applied; the number of reads does not grow with the data.
// CHG-2026-137: the page filters are validated, applied in the same reads,
// and never change how many reads there are; the personal-data types leave
// the database as (type, count) only, and no finding reaches the page.

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
/** What a finding holds besides its type, and what no SQL here may name. */
const NEVER_SQL =
  /redacted_text|raw_content_encrypted|token_hash|user_id|client_host|'start'|'end'|'score'|'text'/;

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

/** The decisions by direction, verdict, the reported mode and policy label. */
const PROJECT_GROUPS = [
  { d: INPUT, a: ALLOW, m: "enforce", p: null, n: 15 },
  { d: INPUT, a: ALLOW, m: null, p: null, n: 5 },
  { d: OUTPUT, a: ALLOW, m: "record", p: null, n: 4 },
  { d: INPUT, a: BLOCK, m: "enforce", p: "Jailbreak Detection", n: 2 },
  { d: INPUT, a: BLOCK, m: "record", p: "Jailbreak Detection", n: 1 },
  // No mode reported: nothing says it was applied, so a Would block. No
  // label either: Other.
  { d: INPUT, a: BLOCK, m: null, p: null, n: 1 },
  { d: OUTPUT, a: BLOCK, m: "record", p: "Topical Rail", n: 1 },
  { d: OUTPUT, a: BLOCK, m: "enforce", p: "Topical Rail", n: 1 },
  { d: INPUT, a: REDACT, m: "record", p: "PII Redaction", n: 3 },
  { d: OUTPUT, a: REDACT, m: "enforce", p: "PII Redaction", n: 2 },
  { d: INPUT, a: UNAVAILABLE, m: null, p: null, n: 1 },
].map(({ d, a, m, p, n }) => ({
  direction: d,
  action: a,
  gatewayMode: m,
  policyTriggered: p,
  _count: { _all: n },
}));

/** The callers in the period, busiest first, as the capped read returns them. */
const CALLER_ROWS = [
  { agentId: V2, _count: { _all: 30 } },
  { agentId: OLD, _count: { _all: 12 } },
  { agentId: PROBE, _count: { _all: 4 } },
];

/** The agents ranked by the counted verdict, as the capped query returns them. */
function busiestRows(count = 4) {
  const rows = [
    { alias: V2, checks: 30, matched: 4, matchedEnforced: 2 },
    { alias: OLD, checks: 12, matched: 1, matchedEnforced: 0 },
    { alias: PROBE, checks: 4, matched: 1, matchedEnforced: 0 },
    { alias: V1, checks: 2, matched: 1, matchedEnforced: 1 },
  ].slice(0, count);
  return rows.map((r) => ({ ...r, withMatches: count }));
}

/**
 * Entity-type rows as a careless query might return them: with a finding's
 * position, score and text, and a type that is not a known name. None of it
 * may reach the page.
 */
const ENTITY_ROWS = [
  {
    type: "EMAIL_ADDRESS",
    count: 4,
    start: 3,
    end: 20,
    score: 0.91,
    text: "SECRET-PII-value",
  },
  { type: "SECRET-PII-type-text", count: 1 },
  { type: "PHONE_NUMBER", count: 2 },
  { type: "OTHER", count: 1 },
];

type GroupByArgs = {
  by: string[];
  where: Record<string, unknown>;
  [key: string]: unknown;
};

function groupsFor(args: GroupByArgs, callers: object[]) {
  if (args.by.includes("policyTriggered")) return PROJECT_GROUPS;
  if (args.by.length === 1 && args.by[0] === "agentId") return callers;
  if (args.by.length === 1 && args.by[0] === "action") {
    // The judge's no-verdict rate over 24 hours.
    return [
      { action: "ALLOW", _count: { _all: 99 } },
      { action: "UNAVAILABLE", _count: { _all: 1 } },
    ];
  }
  throw new Error(`unexpected groupBy: ${JSON.stringify(args.by)}`);
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

const isDaily = (sql: string) => sql.includes('"wouldBlock"');
const isBusiest = (sql: string) => sql.includes('"withMatches"');
const isEntities = (sql: string) => sql.includes("jsonb_array_elements");

const today = () => new Date().toISOString().slice(0, 10);

const DAILY_ROW = {
  checks: 36,
  enforcedChecks: 20,
  matching: 36,
  matchingEnforced: 20,
  promptsRefused: 4,
  answersWithheld: 2,
  allowed: 24,
  blocked: 3,
  wouldBlock: 3,
  redacted: 2,
  wouldRedact: 3,
  noVerdict: 1,
};

function fakePrisma(
  opts: {
    keys?: object[];
    busiest?: object[];
    callers?: object[];
    entities?: object[];
  } = {},
) {
  const keys = opts.keys ?? KEY_ROWS;
  const busiest = opts.busiest ?? busiestRows();
  const callers = opts.callers ?? CALLER_ROWS;
  const entities = opts.entities ?? ENTITY_ROWS;
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
        groupsFor(args, callers),
      ),
      findMany: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async (first: unknown) => {
      const sql = sqlText(first);
      if (isDaily(sql)) return [{ day: today(), ...DAILY_ROW }];
      if (isBusiest(sql)) return busiest;
      if (isEntities(sql)) return entities;
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

type SummaryInput = Parameters<ReturnType<typeof callerFor>["summary"]>[0];

async function enabledSummary(
  role: string,
  db = fakePrisma(),
  input: SummaryInput = INPUT_7,
) {
  const result = await callerFor(role, db).summary(input);
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

function rawQuery(
  db: ReturnType<typeof fakePrisma>,
  which: (sql: string) => boolean,
) {
  const call = db.$queryRaw.mock.calls.find(([q]) => which(sqlText(q)));
  if (!call) throw new Error("query not made");
  return { sql: sqlText(call[0]), values: sqlValues(call[0]) };
}

function mainGroupBy(db: ReturnType<typeof fakePrisma>) {
  return db.acmeGuardrailEvent.groupBy.mock.calls
    .map(([args]) => args)
    .find((args) => args.by.includes("policyTriggered"))!;
}

/** Every filter at once, and each alone: none may change the reads. */
const FILTER_SETS = [
  {},
  { direction: "prompts" as const },
  { verdict: "redact" as const },
  { caller: V2 },
  { policyType: "jailbreak" as const },
  { policyType: "other" as const },
  { applied: "recorded" as const },
  {
    direction: "answers" as const,
    verdict: "block" as const,
    caller: PROBE,
    policyType: "offTopic" as const,
    applied: "applied" as const,
  },
];

describe("EYEON Guardrail decisions: access and reads (CHG-2026-133, CHG-2026-137)", () => {
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
    "refuses %s before the database is touched, on both queries, with or without filters",
    async (role) => {
      await expect(callerFor(role).summary(INPUT_7)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        callerFor(role).summary({
          ...INPUT_7,
          filters: FILTER_SETS[FILTER_SETS.length - 1],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
      callerFor("SECURITY").summary({
        ...INPUT_7,
        filters: { verdict: "block", caller: V2 },
      }),
    ).resolves.toEqual({ enabled: false });
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

  it.each([
    ["an unknown direction", { direction: "sideways" }],
    ["an unknown verdict", { verdict: "blocked" }],
    ["a verdict in another case", { verdict: "BLOCK" }],
    ["an unknown policy type", { policyType: "Jailbreak Detection" }],
    ["an unknown mode", { applied: "enforce" }],
    ["an empty caller", { caller: "   " }],
    ["an over-long caller", { caller: "x".repeat(201) }],
    ["a caller that is not text", { caller: ["a", "b"] }],
    ["a filter the page does not know", { policyLabel: "Topical Rail" }],
  ])("refuses %s before any read", async (_name, filters) => {
    await expect(
      callerFor("OWNER").summary({
        ...INPUT_7,
        filters: filters as SummaryInput["filters"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(touched).not.toHaveBeenCalled();
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
    expect(result.scope).toEqual({
      checks: 36,
      promptChecks: 28,
      answerChecks: 8,
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
    expect(mainGroupBy(db).where).toEqual({
      projectId: PROJECT,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
  });

  it("splits each day by verdict, applied apart from recorded, in SQL that applies the same rule", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.daily).toHaveLength(7);
    expect(result.daily[6]).toEqual({ day: today(), ...DAILY_ROW });
    expect(result.daily[0]).toMatchObject({ checks: 0, wouldBlock: 0 });
    const { sql } = rawQuery(db, isDaily);
    expect(sql).toMatch(
      /FILTER \(WHERE gateway_mode = 'enforce'\)\)::int AS "enforcedChecks"/,
    );
    expect(sql).toMatch(
      /action = 'block' AND gateway_mode = 'enforce'\)\)::int AS blocked/,
    );
    expect(sql).toMatch(
      /action = 'block' AND gateway_mode IS DISTINCT FROM 'enforce'\)\)::int AS "wouldBlock"/,
    );
    expect(sql).toMatch(
      /action = 'redact' AND gateway_mode IS DISTINCT FROM 'enforce'\)\)::int AS "wouldRedact"/,
    );
    // Without a filter, the condition on what was decided is just TRUE.
    expect(sql).toMatch(/FILTER \(WHERE TRUE AND action = 'allow'\)/);
  });

  // CHG-2026-137 follow-up (owner, 2026-10-08): the KPI tiles' charts come
  // from the same daily read, as counts of metadata columns only.
  it("counts, in the same daily read, the matching decisions, those in enforce mode, and refusals by direction", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.daily[6]).toMatchObject({
      matching: 36,
      matchingEnforced: 20,
      promptsRefused: 4,
      answersWithheld: 2,
    });
    expect(result.daily[0]).toMatchObject({
      matching: 0,
      matchingEnforced: 0,
      promptsRefused: 0,
      answersWithheld: 0,
    });
    const { sql } = rawQuery(db, isDaily);
    expect(sql).toMatch(/FILTER \(WHERE TRUE\)\)::int AS matching,/);
    // Only a reported enforce counts as applied.
    expect(sql).toMatch(
      /FILTER \(WHERE TRUE AND gateway_mode = 'enforce'\)\)::int AS "matchingEnforced"/,
    );
    expect(sql).toMatch(
      /FILTER \(WHERE TRUE AND action = 'block' AND direction = 'input'\)\)::int AS "promptsRefused"/,
    );
    expect(sql).toMatch(
      /FILTER \(WHERE TRUE AND action = 'block' AND direction = 'output'\)\)::int AS "answersWithheld"/,
    );
    // Still one daily read among the three statements.
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
    expect(
      db.$queryRaw.mock.calls.filter(([q]) => isDaily(sqlText(q))),
    ).toHaveLength(1);
  });

  it("applies the filters to the tiles' daily counts, as to the tiles' figures", async () => {
    const { db } = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { direction: "answers", applied: "applied" },
    });
    const { sql } = rawQuery(db, isDaily);
    const kind = String.raw`\(direction = 'output'\) AND \(gateway_mode = 'enforce'\)`;
    for (const column of [
      "matching",
      '"matchingEnforced"',
      '"promptsRefused"',
      '"answersWithheld"',
    ])
      expect(sql).toMatch(
        new RegExp(
          String.raw`FILTER \(WHERE ${kind}[^)]*\)\)::int AS ${column}`,
        ),
      );
    // The day's checks stay every check: the base of a rate.
    expect(sql).toMatch(/COUNT\(\*\)::int AS checks,/);
  });

  it("names refusals and redactions by policy type and direction, from the label only", async () => {
    const { result } = await enabledSummary("SECURITY");
    expect(result.policyByDirection).toEqual([
      {
        type: "personalData",
        label: "Personal data",
        count: 5,
        prompts: {
          blocked: { enforced: 0, notEnforced: 0 },
          redacted: { enforced: 0, notEnforced: 3 },
        },
        answers: {
          blocked: { enforced: 0, notEnforced: 0 },
          redacted: { enforced: 2, notEnforced: 0 },
        },
      },
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 3,
        prompts: {
          blocked: { enforced: 2, notEnforced: 1 },
          redacted: { enforced: 0, notEnforced: 0 },
        },
        answers: {
          blocked: { enforced: 0, notEnforced: 0 },
          redacted: { enforced: 0, notEnforced: 0 },
        },
      },
      {
        type: "offTopic",
        label: "Off-topic or outside policy",
        count: 2,
        prompts: {
          blocked: { enforced: 0, notEnforced: 0 },
          redacted: { enforced: 0, notEnforced: 0 },
        },
        answers: {
          blocked: { enforced: 1, notEnforced: 1 },
          redacted: { enforced: 0, notEnforced: 0 },
        },
      },
      {
        type: "other",
        label: "Other",
        count: 1,
        prompts: {
          blocked: { enforced: 0, notEnforced: 1 },
          redacted: { enforced: 0, notEnforced: 0 },
        },
        answers: {
          blocked: { enforced: 0, notEnforced: 0 },
          redacted: { enforced: 0, notEnforced: 0 },
        },
      },
    ]);
    // The caller-set label itself is never returned.
    expect(JSON.stringify(result)).not.toMatch(
      /Jailbreak Detection|Topical Rail|PII Redaction/,
    );
  });

  it("applies the filters on what was decided to the grouped read, keeping every check as the base", async () => {
    const { result, db } = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { direction: "prompts", verdict: "block", applied: "recorded" },
    });
    // Prompts with a block verdict, in record mode or with no mode.
    expect(result.totals).toMatchObject({
      checks: 2,
      promptsRefused: { enforced: 0, notEnforced: 2 },
      answersWithheld: { enforced: 0, notEnforced: 0 },
      redactions: { enforced: 0, notEnforced: 0 },
      allowed: 0,
    });
    expect(result.scope).toEqual({
      checks: 36,
      promptChecks: 28,
      answerChecks: 8,
    });
    // Same read, same scope: the filters are applied to its groups.
    expect(mainGroupBy(db).where).toEqual({
      projectId: PROJECT,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    for (const which of [isDaily, isBusiest, isEntities]) {
      const { sql } = rawQuery(db, which);
      expect(sql).toContain("(direction = 'input')");
      expect(sql).toContain("(action = 'block')");
      expect(sql).toContain("(gateway_mode IS DISTINCT FROM 'enforce')");
    }
  });

  it("counts only a reported enforce as applied when filtering by mode", async () => {
    const applied = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { applied: "applied" },
    });
    // Only the rows reported as "enforce": a missing mode is not applied.
    expect(applied.result.totals.checks).toBe(20);
    expect(applied.result.totals.enforcedChecks).toBe(20);
    expect(rawQuery(applied.db, isDaily).sql).toContain(
      "(gateway_mode = 'enforce')",
    );
    const recorded = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { applied: "recorded" },
    });
    expect(recorded.result.totals.checks).toBe(16);
    expect(recorded.result.totals.enforcedChecks).toBe(0);
  });

  it("narrows every read to one caller, as a bound parameter", async () => {
    const { db } = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { caller: V2 },
    });
    expect(mainGroupBy(db).where).toMatchObject({ agentId: V2 });
    for (const which of [isDaily, isBusiest, isEntities]) {
      const { sql, values } = rawQuery(db, which);
      expect(sql).toMatch(/AND agent_id = \?/);
      expect(sql).not.toContain(V2);
      expect(values).toContain(V2);
    }
    // The caller list stays the whole period's, so another can be chosen.
    const callers = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([args]) => args)
      .find((args) => args.by[0] === "agentId")!;
    expect(callers.where).toEqual({
      projectId: PROJECT,
      eventTime: { gte: expect.any(Date), lte: expect.any(Date) },
    });
  });

  it("matches a policy type through the scorecard's mapping, then by its labels in SQL", async () => {
    const { result, db } = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { policyType: "jailbreak" },
    });
    expect(result.totals).toMatchObject({
      checks: 3,
      promptsRefused: { enforced: 2, notEnforced: 1 },
      allowed: 0,
      noVerdict: 0,
    });
    for (const which of [isDaily, isBusiest, isEntities]) {
      const { sql, values } = rawQuery(db, which);
      expect(sql).toContain(
        "(action IN ('block', 'redact') AND policy_triggered = ANY(?::text[]))",
      );
      expect(values).toContainEqual(["Jailbreak Detection"]);
      expect(sql).not.toContain("Jailbreak Detection");
    }
    // Other: an unknown or missing label; here only missing ones exist.
    const other = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { policyType: "other" },
    });
    expect(other.result.totals.checks).toBe(1);
    expect(rawQuery(other.db, isDaily).sql).toContain(
      "(action IN ('block', 'redact') AND policy_triggered IS NULL)",
    );
    // A type with no label in the period matches nothing.
    const none = await enabledSummary("SECURITY", fakePrisma(), {
      ...INPUT_7,
      filters: { policyType: "sectorRules" },
    });
    expect(none.result.totals.checks).toBe(0);
    expect(rawQuery(none.db, isDaily).sql).toContain("(FALSE)");
  });

  it("lists the busiest callers by refusals, capped in the database, with applied and recorded ones", async () => {
    const { result, db } = await enabledSummary("OWNER");
    expect(result.busiest).toEqual({
      shown: [
        {
          alias: V2,
          application: { lineageId: "lineage-1", name: "App lineage-1" },
          matched: { enforced: 2, notEnforced: 2 },
          checks: 30,
          per100: (100 * 4) / 30,
        },
        {
          alias: OLD,
          application: null,
          matched: { enforced: 0, notEnforced: 1 },
          checks: 12,
          per100: (100 * 1) / 12,
        },
        {
          alias: PROBE,
          application: null,
          matched: { enforced: 0, notEnforced: 1 },
          checks: 4,
          per100: null,
        },
        {
          // A rotated key's alias still belongs to its application.
          alias: V1,
          application: { lineageId: "lineage-1", name: "App lineage-1" },
          matched: { enforced: 1, notEnforced: 0 },
          checks: 2,
          per100: null,
        },
      ],
      total: 4,
      verdict: "block",
      limit: BUSIEST_SHOWN,
      linksApplications: true,
    });
    const { sql, values } = rawQuery(db, isBusiest);
    expect(sql).toMatch(/ORDER BY matched DESC, alias ASC\s+LIMIT \?/);
    expect(sql).toMatch(/WHERE project_id = \?/);
    expect(sql).toMatch(
      /FILTER \(WHERE action = 'block' AND TRUE AND gateway_mode = 'enforce'\)\)::int AS "matchedEnforced"/,
    );
    expect(values).toContain(PROJECT);
    expect(values).toContain(BUSIEST_SHOWN);
    const [keysArgs] = db.acmeLitellmKey.findMany.mock.calls[0]!;
    expect(keysArgs.where).toMatchObject({ projectId: PROJECT });
  });

  it("ranks the busiest callers by the verdict chosen", async () => {
    const { result, db } = await enabledSummary("OWNER", fakePrisma(), {
      ...INPUT_7,
      filters: { verdict: "redact" },
    });
    expect(result.busiest.verdict).toBe("redact");
    expect(rawQuery(db, isBusiest).sql).toMatch(
      /FILTER \(WHERE action = 'redact' AND \(action = 'redact'\)\)\)::int AS matched/,
    );
  });

  it("offers the period's callers for the filter, busiest first, capped in the database", async () => {
    const { result, db } = await enabledSummary("OWNER");
    expect(result.callers).toEqual({
      listed: [
        {
          alias: V2,
          checks: 30,
          application: { lineageId: "lineage-1", name: "App lineage-1" },
        },
        { alias: OLD, checks: 12, application: null },
        { alias: PROBE, checks: 4, application: null },
      ],
      limit: CALLERS_LISTED,
    });
    const callers = db.acmeGuardrailEvent.groupBy.mock.calls
      .map(([args]) => args)
      .find((args) => args.by[0] === "agentId")!;
    expect(callers).toMatchObject({
      by: ["agentId"],
      take: CALLERS_LISTED,
      orderBy: [{ _count: { agentId: "desc" } }, { agentId: "asc" }],
    });
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
      expect(result.callers.listed.map((c) => c.application)).toEqual([
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

  it("reads no key when no caller is in the period", async () => {
    const { result, db } = await enabledSummary(
      "OWNER",
      fakePrisma({ busiest: [], callers: [] }),
    );
    expect(result.busiest).toMatchObject({ shown: [], total: 0 });
    expect(result.callers.listed).toEqual([]);
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

  it("reports the judge's no-verdict rate over 24 hours against the 1% alert, whatever the filters", async () => {
    for (const filters of FILTER_SETS) {
      const { result } = await enabledSummary("SECURITY", fakePrisma(), {
        ...INPUT_7,
        filters,
      });
      expect(result.judge).toEqual({
        windowHours: 24,
        checks: 100,
        noVerdict: 1,
        rate: 0.01,
        alertRate: 0.01,
        alert: true,
      });
    }
  });

  it("counts redactions per personal-data type in SQL, and only a known type and a count reach the page", async () => {
    const { result, db } = await enabledSummary("SECURITY");
    expect(result.entityTypes).toEqual([
      { type: "EMAIL_ADDRESS", count: 4 },
      { type: "PHONE_NUMBER", count: 2 },
      // The unknown type and the database's own OTHER, together.
      { type: "OTHER", count: 2 },
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("SECRET-PII");
    expect(json).not.toMatch(/"start"|"end"|"score"|"text"/);

    const { sql, values } = rawQuery(db, isEntities);
    // The select list is the type and the count, nothing else.
    const select = sql.slice(
      sql.indexOf("SELECT") + "SELECT".length,
      sql.indexOf("FROM acme_guardrail_events"),
    );
    expect(select.match(/\bAS\b/g)).toHaveLength(2);
    expect(select).toMatch(
      /END AS type,\s+COUNT\(DISTINCT e\.id\)::int AS count\s*$/,
    );
    // A finding is read for its entity type only.
    const findingUses = sql
      .replace("findings(finding)", "")
      .match(/\bfinding\b.{0,20}/g);
    expect(findingUses).not.toBeNull();
    for (const use of findingUses ?? [])
      expect(use).toMatch(/^finding ->> 'entity_type'/);
    expect(sql.replace(/->> 'entity_type'/g, "")).not.toContain("->");
    // The findings column only feeds the array of findings.
    expect(sql.match(/pii_findings/g)).toHaveLength(2);
    expect(sql).toContain("jsonb_typeof(e.pii_findings) = 'array'");
    expect(sql).toContain("THEN e.pii_findings ELSE '[]'::jsonb END");
    expect(sql).not.toMatch(NEVER_SQL);
    // Unknown types become OTHER inside the database; the known ones are
    // bound parameters.
    expect(sql).toMatch(
      /IN \(\?(,\s*\?)+\)\s+THEN finding ->> 'entity_type'\s+ELSE 'OTHER' END/,
    );
    expect(values).toEqual(
      expect.arrayContaining(["EMAIL_ADDRESS", "BH_CPR", ENTITY_TYPES_SHOWN]),
    );
    expect(sql).toMatch(/AND action = 'redact'/);
    expect(sql).toMatch(/LIMIT \?$/);
  });

  it("selects, groups and queries no content column and no token hash, anywhere else", async () => {
    for (const filters of FILTER_SETS) {
      const { result, db } = await enabledSummary("OWNER", fakePrisma(), {
        ...INPUT_7,
        filters,
      });
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
      expect(db.$queryRaw).toHaveBeenCalledTimes(3);
      for (const [first] of db.$queryRaw.mock.calls) {
        const sql = sqlText(first);
        expect(sql).toMatch(/WHERE project_id = \?/);
        expect(sql).not.toMatch(NEVER_SQL);
        // Only the entity-type count may name the findings column (above).
        if (!isEntities(sql)) expect(sql).not.toMatch(CONTENT_SQL);
      }
      const json = JSON.stringify(result);
      expect(json).not.toContain(TOKEN_HASH);
      expect(json).not.toMatch(/tokenHash|token_hash/);
    }
  });

  it("reads a fixed number of times, with few events or many, and whatever the filters", async () => {
    const expected = {
      keys: 1,
      settings: 1,
      settingsHistory: 0,
      groupBy: 3,
      events: 0,
      sql: 3,
    };
    const few = await enabledSummary(
      "OWNER",
      fakePrisma({ busiest: busiestRows(1), keys: KEY_ROWS.slice(0, 2) }),
    );
    const manyKeys = Array.from({ length: 40 }, (_, i) =>
      keyRow(`lineage-x${i}`, `cairo-app-${i}`, 1, AcmeLitellmKeyStatus.ACTIVE),
    );
    const manyCallers = Array.from({ length: CALLERS_LISTED }, (_, i) => ({
      agentId: `cairo-app-${i}`,
      _count: { _all: 100 - i },
    }));
    const many = await enabledSummary(
      "OWNER",
      fakePrisma({
        busiest: busiestRows(4),
        keys: [...KEY_ROWS, ...manyKeys],
        callers: manyCallers,
      }),
    );
    expect(readCounts(few.db)).toEqual(expected);
    expect(readCounts(many.db)).toEqual(expected);
    for (const filters of FILTER_SETS) {
      const filtered = await enabledSummary("OWNER", fakePrisma(), {
        ...INPUT_7,
        filters,
      });
      expect(readCounts(filtered.db)).toEqual(expected);
    }
    // Without the right to open Applications, one read fewer.
    const security = await enabledSummary(
      "SECURITY",
      fakePrisma({ busiest: busiestRows(4) }),
      { ...INPUT_7, filters: FILTER_SETS[FILTER_SETS.length - 1] },
    );
    expect(readCounts(security.db)).toEqual({ ...expected, keys: 0 });
  });
});
