import { type ComponentProps } from "react";
import { fn } from "storybook/test";

import preview from "@/.storybook/preview";
import { EyeonGuardrailDecisionsContent } from "@/src/features/acme-enhancements/components/EyeonGuardrailDecisionsContent";

/**
 * CHG-2026-137 follow-up (owner, 2026-10-08: "the charts within Guardrail
 * decision are not getting displayed ... decision flow chart is too
 * large"). The Guardrail decisions page's content on fixed figures, so its
 * charts can be checked in a real browser: the six KPI tiles with their
 * charts, the decision flow at its natural size, decisions over time with
 * the gateway's mode per day, "Why" with a bar per policy cell, the enforce
 * versus record ring, the busiest callers and the personal-data types.
 * Story-only: no network call, no database; the page itself reads the same
 * figures from the server.
 *
 * Default follows the figures of the owner's screenshot: 348 checks (290
 * prompts, 58 answers), 106 prompts refused or would be (19 applied, 87
 * recorded), 33 answers withheld or would be, 27 redactions, the gateway in
 * record mode for five days, both modes on the sixth and enforce mode on the
 * last.
 */

type Data = ComponentProps<typeof EyeonGuardrailDecisionsContent>["data"];

const meta = preview.meta({ component: EyeonGuardrailDecisionsContent });

const split = (enforced: number, notEnforced: number) => ({
  enforced,
  notEnforced,
});

/** One UTC day of the fixture, with no filter chosen: every check matches. */
function day(
  date: string,
  d: {
    checks: number;
    enforcedChecks: number;
    promptsRefused: number;
    answersWithheld: number;
    allowed: number;
    blocked: number;
    wouldBlock: number;
    redacted: number;
    wouldRedact: number;
    noVerdict: number;
  },
): Data["daily"][number] {
  return {
    day: date,
    matching: d.checks,
    matchingEnforced: d.enforcedChecks,
    ...d,
  };
}

const zeroDay = {
  checks: 0,
  enforcedChecks: 0,
  promptsRefused: 0,
  answersWithheld: 0,
  allowed: 0,
  blocked: 0,
  wouldBlock: 0,
  redacted: 0,
  wouldRedact: 0,
  noVerdict: 0,
};

const DAYS = [
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
];

const CLAIMS = { lineageId: "lineage-claims", name: "Claims assistant" };
const HR = { lineageId: "lineage-hr", name: "HR helpdesk" };

const ownerView = {
  enabled: true,
  windowDays: 7,
  generatedAt: "2026-10-08T09:00:00.000Z",
  mode: { mode: "enforce", ceiling: "enforce" },
  scope: { checks: 348, promptChecks: 290, answerChecks: 58 },
  totals: {
    checks: 348,
    promptChecks: 290,
    answerChecks: 58,
    allowed: 178,
    promptsRefused: split(19, 87),
    answersWithheld: split(6, 27),
    redactions: split(5, 22),
    noVerdict: 4,
    enforcedChecks: 78,
    enforcedPct: (100 * 78) / 348,
  },
  byDirection: {
    prompts: {
      checks: 290,
      allowed: 159,
      blocked: split(19, 87),
      redacted: split(4, 18),
      noVerdict: 3,
    },
    answers: {
      checks: 58,
      allowed: 19,
      blocked: split(6, 27),
      redacted: split(1, 4),
      noVerdict: 1,
    },
  },
  daily: [
    day(DAYS[0]!, {
      ...zeroDay,
      checks: 40,
      promptsRefused: 10,
      answersWithheld: 4,
      allowed: 23,
      wouldBlock: 14,
      wouldRedact: 3,
    }),
    day(DAYS[1]!, {
      ...zeroDay,
      checks: 52,
      promptsRefused: 16,
      answersWithheld: 5,
      allowed: 26,
      wouldBlock: 21,
      wouldRedact: 4,
      noVerdict: 1,
    }),
    day(DAYS[2]!, {
      ...zeroDay,
      checks: 45,
      promptsRefused: 13,
      answersWithheld: 4,
      allowed: 25,
      wouldBlock: 17,
      wouldRedact: 3,
    }),
    day(DAYS[3]!, {
      ...zeroDay,
      checks: 58,
      promptsRefused: 20,
      answersWithheld: 6,
      allowed: 25,
      wouldBlock: 26,
      wouldRedact: 5,
      noVerdict: 2,
    }),
    day(DAYS[4]!, {
      ...zeroDay,
      checks: 50,
      promptsRefused: 18,
      answersWithheld: 5,
      allowed: 23,
      wouldBlock: 23,
      wouldRedact: 4,
    }),
    day(DAYS[5]!, {
      checks: 55,
      enforcedChecks: 30,
      promptsRefused: 19,
      answersWithheld: 5,
      allowed: 26,
      blocked: 11,
      wouldBlock: 13,
      redacted: 1,
      wouldRedact: 3,
      noVerdict: 1,
    }),
    day(DAYS[6]!, {
      ...zeroDay,
      checks: 48,
      enforcedChecks: 48,
      promptsRefused: 10,
      answersWithheld: 4,
      allowed: 30,
      blocked: 14,
      redacted: 4,
    }),
  ],
  policyByDirection: [
    {
      type: "jailbreak",
      label: "Jailbreak or misuse",
      count: 67,
      prompts: { blocked: split(12, 55), redacted: split(0, 0) },
      answers: { blocked: split(0, 0), redacted: split(0, 0) },
    },
    {
      type: "offTopic",
      label: "Off-topic or outside policy",
      count: 54,
      prompts: { blocked: split(5, 25), redacted: split(0, 0) },
      answers: { blocked: split(4, 20), redacted: split(0, 0) },
    },
    {
      type: "personalData",
      label: "Personal data",
      count: 27,
      prompts: { blocked: split(0, 0), redacted: split(4, 18) },
      answers: { blocked: split(0, 0), redacted: split(1, 4) },
    },
    {
      type: "other",
      label: "Other",
      count: 18,
      prompts: { blocked: split(2, 7), redacted: split(0, 0) },
      answers: { blocked: split(2, 7), redacted: split(0, 0) },
    },
  ],
  busiest: {
    shown: [
      {
        alias: "sample-claims-key",
        application: CLAIMS,
        matched: split(12, 48),
        checks: 160,
        per100: 37.5,
      },
      {
        alias: "sample-test-key",
        application: null,
        matched: split(5, 26),
        checks: 68,
        per100: (100 * 31) / 68,
      },
      {
        alias: "sample-helpdesk-key",
        application: HR,
        matched: split(8, 40),
        checks: 120,
        per100: 40,
      },
    ],
    total: 3,
    verdict: "block",
    limit: 5,
    linksApplications: true,
  },
  entityTypes: [
    { type: "EMAIL_ADDRESS", count: 14 },
    { type: "PHONE_NUMBER", count: 8 },
    { type: "BH_CPR", count: 6 },
    { type: "CREDIT_CARD", count: 2 },
  ],
  callers: {
    listed: [
      {
        alias: "sample-claims-key",
        checks: 160,
        application: CLAIMS,
      },
      { alias: "sample-helpdesk-key", checks: 120, application: HR },
      { alias: "sample-test-key", checks: 68, application: null },
    ],
    limit: 50,
  },
  judge: {
    windowHours: 24,
    checks: 51,
    noVerdict: 0,
    rate: 0,
    alertRate: 0.01,
    alert: false,
  },
} satisfies Data;

const noChecks = {
  ...ownerView,
  mode: { mode: "record", ceiling: "enforce" },
  scope: { checks: 0, promptChecks: 0, answerChecks: 0 },
  totals: {
    checks: 0,
    promptChecks: 0,
    answerChecks: 0,
    allowed: 0,
    promptsRefused: split(0, 0),
    answersWithheld: split(0, 0),
    redactions: split(0, 0),
    noVerdict: 0,
    enforcedChecks: 0,
    enforcedPct: null,
  },
  byDirection: {
    prompts: {
      ...ownerView.byDirection.prompts,
      checks: 0,
      allowed: 0,
      blocked: split(0, 0),
      redacted: split(0, 0),
      noVerdict: 0,
    },
    answers: {
      ...ownerView.byDirection.answers,
      checks: 0,
      allowed: 0,
      blocked: split(0, 0),
      redacted: split(0, 0),
      noVerdict: 0,
    },
  },
  daily: DAYS.map((d) => day(d, zeroDay)),
  policyByDirection: [],
  busiest: { ...ownerView.busiest, shown: [], total: 0 },
  entityTypes: [],
  callers: { listed: [], limit: 50 },
  judge: { ...ownerView.judge, checks: 0, noVerdict: 0, rate: null },
} satisfies Data;

/** The owner's view: every chart drawn, the gateway now in enforce mode. */
export const Default = meta.story({
  args: {
    data: ownerView,
    projectId: "demo-project",
    view: { windowDays: 7, filters: {} },
    onViewChange: fn(),
  },
});

/** A period without a check: each chart says so instead of drawing zeros. */
export const NoChecks = meta.story({
  args: {
    data: noChecks,
    projectId: "demo-project",
    view: { windowDays: 7, filters: {} },
    onViewChange: fn(),
  },
});
