/**
 * ACME (CHG-2026-147, ADR-0030): fixed figures for the command centre's
 * story and tests, shaped as the EYEON pages' summaries return them. Only
 * the fields the command centre reads are filled; the rest of each summary
 * is left out, hence the casts. Story and test use only: never imported by
 * the page.
 */
import {
  type CommandCentreInput,
  type HomeDecisions,
  type HomeEnforcement,
  type HomeHealth,
  type HomeOverview,
  type HomeSpend,
} from "@/src/features/acme-enhancements/utils/eyeonCommandCentre";

export const FIXTURE_NOW = "2026-10-09T09:30:00.000Z";

const days = (n: number, from = "2026-10-03") =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

export function overviewFixture(
  over: Partial<HomeOverview> = {},
): HomeOverview {
  const daily = days(7).map((day, i) => ({
    day,
    checks: 380 + i * 40,
    promptsRefused: [3, 5, 2, 7, 4, 6, 8][i] ?? 0,
    answersWithheld: [0, 1, 0, 1, 0, 2, 1][i] ?? 0,
    redactions: [9, 12, 7, 15, 11, 14, 18][i] ?? 0,
    noVerdict: i === 5 ? 3 : 0,
  }));
  return {
    enabled: true,
    windowDays: 7,
    generatedAt: FIXTURE_NOW,
    canSeeSpend: true,
    mode: {
      mode: "record",
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: {
        at: "2026-10-05T11:02:00.000Z",
        to: "record",
        automatic: true,
        createdByEmail: null,
        reason: "Enforce trial ended",
      },
    },
    decisions: {
      checks: 3500,
      promptChecks: 1760,
      answerChecks: 1740,
      allowed: 3361,
      promptsRefused: { enforced: 0, notEnforced: 35 },
      answersWithheld: { enforced: 0, notEnforced: 5 },
      redactions: { enforced: 0, notEnforced: 86 },
      noVerdict: 3,
      enforcedChecks: 0,
      enforcedPct: 0,
    },
    daily,
    judge: {
      windowHours: 24,
      checks: 640,
      noVerdict: 3,
      rate: 0.0047,
      alertRate: 0.05,
      alert: false,
    },
    applications: {
      total: 9,
      byOverall: { green: 5, amber: 2, red: 1, none: 1 },
      topRisks: {
        risks: [
          {
            name: "HR assistant",
            alias: "hr-assistant-1",
            dimension: "threats",
            band: "red",
            evidence: "6.2 refusals per 100 calls",
          },
          {
            name: "Claims triage",
            alias: "claims-triage-1",
            dimension: "dataProtection",
            band: "amber",
            evidence: "4.1 redactions per 100 calls",
          },
          {
            name: "Branch chatbot",
            alias: "branch-bot-1",
            dimension: "accessHygiene",
            band: "amber",
            evidence: "Key older than 90 days",
          },
        ],
        total: 3,
      },
      missingBudget: 3,
    },
    ...over,
  } as unknown as HomeOverview;
}

export function spendFixture(over: Partial<HomeSpend> = {}): HomeSpend {
  const monthDays = days(9, "2026-10-01").map((day, i) => ({
    day,
    spendUsd: [3.1, 4.2, 2.8, 5.6, 6.1, 4.9, 7.2, 6.4, 2.2][i] ?? 0,
    calls: 500 + i * 30,
    cumulativeUsd: [3.1, 7.3, 10.1, 15.7, 21.8, 26.7, 33.9, 40.3, 42.5][i] ?? 0,
  }));
  const series = days(7).map((label, i) => ({
    start: `${label}T00:00:00.000Z`,
    label,
    spendUsd: [4.2, 2.8, 5.6, 6.1, 4.9, 7.2, 6.4][i] ?? 0,
    calls: [520, 480, 610, 640, 590, 700, 660][i] ?? 0,
    totalTokens: 900_000 + i * 50_000,
  }));
  return {
    enabled: true,
    window: "7d",
    generatedAt: FIXTURE_NOW,
    gatewayManagement: true,
    requestLog: true,
    links: { applications: true, gatewayHealth: true },
    mirror: null,
    month: {
      month: "2026-10",
      daysInMonth: 31,
      dayOfMonth: 9,
      spentUsd: 42.5,
      calls: 5040,
      dailyAverageUsd: 4.72,
      projectedUsd: 146.4,
      days: monthDays,
    },
    period: {
      from: "2026-10-02T09:30:00.000Z",
      bucketMinutes: 1440,
      series,
      totals: {
        spendUsd: 37.2,
        calls: 4200,
        failed: 126,
        promptTokens: 4_100_000,
        completionTokens: 2_300_000,
        totalTokens: 6_400_000,
        cacheHits: 380,
        cacheReported: 4200,
      },
      previous: { spendUsd: 31.9, calls: 3650, failed: 40 },
      failedPct: 3,
      failedBand: "amber",
      cacheHitPct: 9.0,
    },
    breakdown: {
      model: {
        rows: [
          {
            id: "model:cairo-chat",
            name: "cairo-chat",
            spendUsd: 21.4,
            calls: 2100,
            totalTokens: 3_900_000,
            sharePct: 57.5,
          },
          {
            id: "model:groq-safeguard",
            name: "groq-safeguard",
            spendUsd: 9.8,
            calls: 1500,
            totalTokens: 1_600_000,
            sharePct: 26.3,
          },
          {
            id: "model:cairo-evaluator",
            name: "cairo-evaluator",
            spendUsd: 6.0,
            calls: 600,
            totalTokens: 900_000,
            sharePct: 16.1,
          },
        ],
        rest: { count: 0, spendUsd: 0, calls: 0 },
      },
      application: {
        rows: [
          {
            id: "app:1",
            name: "HR assistant",
            spendUsd: 14.1,
            calls: 1500,
            totalTokens: 2_000_000,
            sharePct: 37.9,
          },
          {
            id: "app:2",
            name: "Claims triage",
            spendUsd: 9.6,
            calls: 1100,
            totalTokens: 1_600_000,
            sharePct: 25.8,
          },
          {
            id: "app:3",
            name: "Branch chatbot",
            spendUsd: 6.2,
            calls: 800,
            totalTokens: 1_100_000,
            sharePct: 16.7,
          },
          {
            id: "app:4",
            name: "Guardrail judge",
            spendUsd: 4.1,
            calls: 500,
            totalTokens: 900_000,
            sharePct: 11.0,
          },
          {
            id: "app:retired",
            name: "Keys no longer in use",
            spendUsd: 3.2,
            calls: 300,
            totalTokens: 800_000,
            sharePct: 8.6,
          },
        ],
        rest: { count: 0, spendUsd: 0, calls: 0 },
      },
      team: { rows: [], rest: { count: 0, spendUsd: 0, calls: 0 } },
      key: { rows: [], rest: { count: 0, spendUsd: 0, calls: 0 } },
    },
    budgets: {
      shown: [
        {
          lineageId: "l1",
          name: "HR assistant",
          spentUsd: 52,
          budgetUsd: 50,
          budgetDuration: "30d",
          usedPct: 104,
          band: "red",
        },
        {
          lineageId: "l2",
          name: "Claims triage",
          spentUsd: 41,
          budgetUsd: 50,
          budgetDuration: "30d",
          usedPct: 82,
          band: "amber",
        },
        {
          lineageId: "l3",
          name: "Guardrail judge",
          spentUsd: 12,
          budgetUsd: 50,
          budgetDuration: "30d",
          usedPct: 24,
          band: "green",
        },
      ],
      withBudget: 6,
      withoutBudget: 3,
    },
    ...over,
  } as unknown as HomeSpend;
}

export function healthFixture(over: Partial<HomeHealth> = {}): HomeHealth {
  return {
    enabled: true,
    window: "7d",
    generatedAt: FIXTURE_NOW,
    gatewayManagement: true,
    requestLog: true,
    canCheckHealth: true,
    health: {
      checkedAt: "2026-10-09T09:21:00.000Z",
      fresh: false,
      cacheMinutes: 5,
      models: [
        {
          model: "claude-sonnet",
          providers: ["anthropic"],
          status: "unhealthy",
          cause: "keyOrCredit",
          routes: [],
        },
        {
          model: "gemini-judge",
          providers: ["gemini"],
          status: "unhealthy",
          cause: "notFound",
          routes: [],
        },
        {
          model: "nvidia-nemotron",
          providers: ["openrouter"],
          status: "unhealthy",
          cause: "notFound",
          routes: [],
        },
        {
          model: "cairo-chat",
          providers: ["openrouter"],
          status: "healthy",
          cause: null,
          routes: [],
        },
        {
          model: "cairo-evaluator",
          providers: ["groq"],
          status: "healthy",
          cause: null,
          routes: [],
        },
        {
          model: "groq-judge",
          providers: ["groq"],
          status: "healthy",
          cause: null,
          routes: [],
        },
        {
          model: "groq-safeguard",
          providers: ["openrouter"],
          status: "healthy",
          cause: null,
          routes: [],
        },
      ],
      counts: { total: 7, healthy: 4, unhealthy: 3, unknown: 0 },
      more: 0,
    },
    applications: 9,
    mirror: {
      state: "withinLag",
      expectedLagMinutes: 5,
      completeTo: "2026-10-09T09:25:00.000Z",
      lastReconciledAt: "2026-10-09T09:26:00.000Z",
      lastGapCount: 0,
      newestArrival: "2026-10-09T09:28:00.000Z",
    },
    failures: {
      from: "2026-10-02T09:30:00.000Z",
      bucketMinutes: 1440,
      calls: 4200,
      failed: 126,
      previous: { calls: 3650, failed: 40 },
      limitRefusals: 0,
      series: days(7).map((label, i) => ({
        start: `${label}T00:00:00.000Z`,
        label,
        calls: [520, 480, 610, 640, 590, 700, 660][i] ?? 0,
        failed: [10, 12, 30, 20, 14, 22, 18][i] ?? 0,
      })),
      byModel: [],
      byClass: [],
      latest: null,
    },
    ...over,
  } as unknown as HomeHealth;
}

function decisionsFixture(
  over: Partial<HomeDecisions> = {},
): HomeDecisions {
  const split = (notEnforced: number) => ({ enforced: 0, notEnforced });
  const cell = (blocked: number, redacted: number) => ({
    blocked: split(blocked),
    redacted: split(redacted),
  });
  return {
    enabled: true,
    windowDays: 7,
    generatedAt: FIXTURE_NOW,
    policyByDirection: [
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 24,
        prompts: cell(22, 0),
        answers: cell(2, 0),
      },
      {
        type: "personalData",
        label: "Personal data",
        count: 86,
        prompts: cell(0, 61),
        answers: cell(0, 25),
      },
      {
        type: "harmfulContent",
        label: "Harmful content",
        count: 9,
        prompts: cell(6, 0),
        answers: cell(3, 0),
      },
      {
        type: "offTopic",
        label: "Off topic",
        count: 7,
        prompts: cell(7, 0),
        answers: cell(0, 0),
      },
    ],
    entityTypes: [
      { type: "EMAIL_ADDRESS", count: 31 },
      { type: "PHONE_NUMBER", count: 22 },
      { type: "PERSON", count: 18 },
      { type: "IBAN_CODE", count: 9 },
      { type: "CREDIT_CARD", count: 4 },
    ],
    busiest: {
      shown: [
        {
          alias: "hr-assistant-1",
          application: { lineageId: "l1", name: "HR assistant" },
          matched: split(19),
          checks: 610,
          per100: 3.1,
        },
        {
          alias: "claims-triage-1",
          application: { lineageId: "l2", name: "Claims triage" },
          matched: split(11),
          checks: 480,
          per100: 2.3,
        },
      ],
      total: 2,
      verdict: "block",
      limit: 5,
      linksApplications: true,
    },
    ...over,
  } as unknown as HomeDecisions;
}

export function enforcementFixture(
  over: Partial<HomeEnforcement> = {},
): HomeEnforcement {
  return {
    enabled: true,
    windowDays: 7,
    generatedAt: FIXTURE_NOW,
    pods: {
      reporting: 2,
      onCurrent: 2,
      older: 0,
      unknown: 0,
      stale: 0,
      currentVersion: 14,
      staleAfterSeconds: 300,
      agree: true,
    },
    gateways: {
      replicas: 2,
      byMode: { enforce: 0, record: 2, notReported: 0 },
      versions: [14],
      sameMode: true,
      matchesServed: true,
      beforeLastChange: 0,
      lastSeenAt: "2026-10-09T09:29:00.000Z",
    },
    judge: {
      windowHours: 24,
      checks: 640,
      noVerdict: 3,
      rate: 0.0047,
      alertRate: 0.05,
      alert: false,
    },
    ...over,
  } as unknown as HomeEnforcement;
}

/** Everything ready, as an Owner sees it in dev on 2026-10-09. */
export function commandCentreFixture(
  over: Partial<CommandCentreInput> = {},
): CommandCentreInput {
  return {
    projectId: "project-1",
    windowDays: 7,
    overview: { state: "ready", data: overviewFixture() },
    spend: { state: "ready", data: spendFixture() },
    health: { state: "ready", data: healthFixture() },
    decisions: { state: "ready", data: decisionsFixture() },
    enforcement: { state: "ready", data: enforcementFixture() },
    ...over,
  };
}
