import { describe, it, expect } from "vitest";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  AcmeLitellmKeyStatus,
} from "@langfuse/shared/src/db";
import {
  applicationsByAlias,
  busiestApplications,
  dailyVerdicts,
  decisionsByDirection,
  policyByDirection,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  decisionsHeadline,
  perHundred,
  splitText,
  tileSeries,
} from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";
import {
  sparklinePaths,
  stackSegments,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonChartGeometry";

// CHG-2026-133 (ADR-0027): the EYEON Guardrail decisions page's pure
// functions: its figures, its wording, and the stacked charts' geometry.

const { INPUT, OUTPUT } = AcmeGuardrailEventDirection;
const { ALLOW, BLOCK, REDACT, UNAVAILABLE } = AcmeGuardrailEventAction;

function group(
  direction: AcmeGuardrailEventDirection,
  action: AcmeGuardrailEventAction,
  gatewayMode: string | null,
  n: number,
) {
  return { direction, action, gatewayMode, _count: { _all: n } };
}

describe("decisionsByDirection", () => {
  it("is all zeros without decisions", () => {
    const empty = {
      checks: 0,
      allowed: 0,
      blocked: { enforced: 0, notEnforced: 0 },
      redacted: { enforced: 0, notEnforced: 0 },
      noVerdict: 0,
    };
    expect(decisionsByDirection([])).toEqual({
      prompts: empty,
      answers: empty,
    });
  });

  it("splits prompts from answers, and applied from recorded by the reported mode", () => {
    const { prompts, answers } = decisionsByDirection([
      group(INPUT, ALLOW, "enforce", 10),
      group(INPUT, BLOCK, "enforce", 2),
      group(INPUT, BLOCK, "record", 3),
      // An unknown or missing mode is not enforced: nothing says it was.
      group(INPUT, BLOCK, "ENFORCE", 1),
      group(INPUT, BLOCK, null, 1),
      group(OUTPUT, BLOCK, "enforce", 4),
      group(OUTPUT, REDACT, "record", 5),
      group(INPUT, REDACT, "enforce", 6),
      group(INPUT, UNAVAILABLE, null, 7),
      group(OUTPUT, ALLOW, null, 8),
    ]);
    expect(prompts).toEqual({
      checks: 30,
      allowed: 10,
      blocked: { enforced: 2, notEnforced: 5 },
      redacted: { enforced: 6, notEnforced: 0 },
      noVerdict: 7,
    });
    expect(answers).toEqual({
      checks: 17,
      allowed: 8,
      blocked: { enforced: 4, notEnforced: 0 },
      redacted: { enforced: 0, notEnforced: 5 },
      noVerdict: 0,
    });
  });
});

describe("dailyVerdicts", () => {
  const zero = {
    checks: 0,
    enforcedChecks: 0,
    matching: 0,
    matchingEnforced: 0,
    promptsRefused: 0,
    answersWithheld: 0,
    allowed: 0,
    blocked: 0,
    wouldBlock: 0,
    redacted: 0,
    wouldRedact: 0,
    noVerdict: 0,
  };

  it("has one point per UTC day, zeros where nothing happened, and ignores other days", () => {
    const start = new Date("2026-10-01T00:00:00.000Z");
    const points = dailyVerdicts(start, 3, [
      {
        ...zero,
        day: "2026-10-02",
        checks: 9,
        enforcedChecks: 4,
        matching: 9,
        matchingEnforced: 4,
        promptsRefused: 2,
        answersWithheld: 1,
        blocked: 1,
        wouldBlock: 2,
      },
      { ...zero, day: "2026-10-02", checks: 1, matching: 1, noVerdict: 1 },
      { ...zero, day: "2026-09-30", checks: 50 },
      { ...zero, day: "2026-10-04", checks: 50 },
    ]);
    expect(points.map((p) => p.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(points[0]).toEqual({ ...zero, day: "2026-10-01" });
    expect(points[1]).toEqual({
      ...zero,
      day: "2026-10-02",
      checks: 10,
      enforcedChecks: 4,
      matching: 10,
      matchingEnforced: 4,
      promptsRefused: 2,
      answersWithheld: 1,
      blocked: 1,
      wouldBlock: 2,
      noVerdict: 1,
    });
  });
});

// CHG-2026-137 follow-up (owner, 2026-10-08): a chart in every KPI tile,
// counted as the tile's figure is; a share without a base is a gap.
describe("tileSeries", () => {
  const day = {
    checks: 0,
    matching: 0,
    matchingEnforced: 0,
    promptsRefused: 0,
    answersWithheld: 0,
    redacted: 0,
    wouldRedact: 0,
    noVerdict: 0,
  };

  it("gives each tile one point per day, counted as its figure", () => {
    const s = tileSeries([
      {
        ...day,
        day: "2026-10-01",
        checks: 50,
        matching: 40,
        matchingEnforced: 10,
        promptsRefused: 6,
        answersWithheld: 2,
        redacted: 1,
        wouldRedact: 3,
        noVerdict: 1,
      },
      // No check at all: the counts are 0, the shares are not known.
      { ...day, day: "2026-10-02" },
      // Checks, but none matches the filters: no share decided in enforce.
      { ...day, day: "2026-10-03", checks: 8 },
    ]);
    const values = (points: { value: number | null }[]) =>
      points.map((p) => p.value);
    expect(s.checks.map((p) => p.label)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(values(s.checks)).toEqual([50, 0, 8]);
    expect(values(s.promptsRefused)).toEqual([6, 0, 0]);
    expect(values(s.answersWithheld)).toEqual([2, 0, 0]);
    // Applied and recorded alike, as the tile's figure.
    expect(values(s.redactions)).toEqual([4, 0, 0]);
    // Per 100 of every check of the day, as the period's figure.
    expect(values(s.noVerdictPct)).toEqual([2, null, 0]);
    // Of the matching decisions, as the tile's figure.
    expect(values(s.enforcedPct)).toEqual([25, null, null]);
  });

  it("has no point without days", () => {
    expect(tileSeries([]).enforcedPct).toEqual([]);
  });
});

describe("sparklinePaths with gaps (CHG-2026-137 follow-up)", () => {
  it("breaks the line at a day without a value, rather than drawing a zero", () => {
    const { line, area } = sparklinePaths([0, 10, null, 5, 10], 100, 20, 2);
    expect(line).toBe("M0 18 L25 2 M75 10 L100 2");
    expect(area).toBe(
      "M0 18 L25 2 L25 20 L0 20 Z M75 10 L100 2 L100 20 L75 20 Z",
    );
  });

  it("draws a value alone between gaps as a short flat stroke", () => {
    expect(sparklinePaths([null, 4, null], 100, 20, 2).line).toBe(
      "M37.5 2 L62.5 2",
    );
    // At an edge, the stroke stays inside the box.
    expect(sparklinePaths([4, null, null], 100, 20, 2).line).toBe(
      "M0 2 L12.5 2",
    );
    expect(sparklinePaths([null, null], 100, 20)).toEqual({
      line: "",
      area: "",
    });
  });

  it("scales to a fixed ceiling, such as 100 for a share, unless a value is larger", () => {
    expect(sparklinePaths([50, 100], 10, 10, 1, 100).line).toBe("M0 5 L10 1");
    expect(sparklinePaths([0, 25], 10, 10, 1, 100).line).toBe("M0 9 L10 7");
    expect(sparklinePaths([0, 200], 10, 10, 1, 100).line).toBe("M0 9 L10 1");
  });

  it("draws as before without gaps or a ceiling", () => {
    expect(sparklinePaths([0, 10, 5], 100, 20, 2).line).toBe(
      "M0 18 L50 2 L100 10",
    );
    expect(sparklinePaths([5], 100, 20).line).toBe("M0 2 L100 2");
  });
});

describe("policyByDirection (CHG-2026-137)", () => {
  function labelled(
    policyTriggered: string | null,
    direction: AcmeGuardrailEventDirection,
    action: AcmeGuardrailEventAction,
    gatewayMode: string | null,
    n: number,
  ) {
    return {
      policyTriggered,
      direction,
      action,
      gatewayMode,
      _count: { _all: n },
    };
  }
  const none = { enforced: 0, notEnforced: 0 };

  it("is empty without refusals or redactions", () => {
    expect(policyByDirection([])).toEqual([]);
    expect(
      policyByDirection([
        labelled(null, INPUT, ALLOW, "enforce", 10),
        labelled(null, INPUT, UNAVAILABLE, null, 2),
      ]),
    ).toEqual([]);
  });

  it("maps labels to types, most frequent first, by direction, verdict and mode", () => {
    const rows = policyByDirection([
      labelled("Topical Rail", OUTPUT, BLOCK, "enforce", 2),
      labelled("Jailbreak Detection", INPUT, BLOCK, "record", 3),
      labelled("jailbreak detection", INPUT, BLOCK, "enforce", 1),
      labelled("Input too large for inspection", INPUT, BLOCK, null, 1),
      labelled("something new", INPUT, BLOCK, "enforce", 1),
      labelled(null, OUTPUT, BLOCK, "record", 1),
      labelled("PII Redaction", INPUT, REDACT, "record", 2),
      labelled("PII Redaction", OUTPUT, REDACT, "ENFORCE", 1),
      // Allowed checks carry no policy reason, whatever their label.
      labelled("PII Redaction", INPUT, ALLOW, "enforce", 50),
    ]);
    expect(rows).toEqual([
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 4,
        prompts: {
          blocked: { enforced: 1, notEnforced: 3 },
          redacted: none,
        },
        answers: { blocked: none, redacted: none },
      },
      {
        type: "personalData",
        label: "Personal data",
        count: 3,
        prompts: {
          blocked: none,
          redacted: { enforced: 0, notEnforced: 2 },
        },
        // "ENFORCE" is not the reported "enforce": not applied.
        answers: {
          blocked: none,
          redacted: { enforced: 0, notEnforced: 1 },
        },
      },
      {
        type: "offTopic",
        label: "Off-topic or outside policy",
        count: 2,
        prompts: { blocked: none, redacted: none },
        answers: {
          blocked: { enforced: 2, notEnforced: 0 },
          redacted: none,
        },
      },
      {
        type: "other",
        label: "Other",
        count: 2,
        prompts: {
          blocked: { enforced: 1, notEnforced: 0 },
          redacted: none,
        },
        answers: {
          blocked: { enforced: 0, notEnforced: 1 },
          redacted: none,
        },
      },
      {
        type: "oversized",
        label: "Too large to check",
        count: 1,
        prompts: {
          blocked: { enforced: 0, notEnforced: 1 },
          redacted: none,
        },
        answers: { blocked: none, redacted: none },
      },
    ]);
    // The caller-set labels are never passed on.
    expect(JSON.stringify(rows)).not.toMatch(/Detection|Rail|something new/);
  });
});

describe("applicationsByAlias", () => {
  const key = (
    lineageId: string,
    alias: string,
    generation: number,
    status: AcmeLitellmKeyStatus,
    displayName = `App ${lineageId}`,
  ) => ({
    lineageId,
    generation,
    displayName,
    litellmKeyAlias: alias,
    status,
  });

  it("maps every alias of a lineage with an active key to that application, by its current name", () => {
    const apps = applicationsByAlias([
      key("l1", "a-1", 1, AcmeLitellmKeyStatus.ROTATED, "Old name"),
      key("l1", "a-2", 2, AcmeLitellmKeyStatus.ACTIVE, "Claims bot"),
      key("l2", "b-1", 1, AcmeLitellmKeyStatus.REVOKED),
    ]);
    expect(apps.get("a-1")).toEqual({ lineageId: "l1", name: "Claims bot" });
    expect(apps.get("a-2")).toEqual({ lineageId: "l1", name: "Claims bot" });
    // No active key: not an application (as on the Applications page).
    expect(apps.has("b-1")).toBe(false);
  });
});

describe("busiestApplications", () => {
  it("keeps the order read, resolves known aliases, and rates only with enough checks", () => {
    const apps = new Map([["a-2", { lineageId: "l1", name: "Claims bot" }]]);
    const result = busiestApplications(
      [
        {
          alias: "a-2",
          checks: 40,
          matched: 6,
          matchedEnforced: 4,
          withMatches: 7,
        },
        {
          alias: "probe",
          checks: 9,
          matched: 5,
          matchedEnforced: 0,
          withMatches: 7,
        },
      ],
      apps,
    );
    expect(result).toEqual({
      shown: [
        {
          alias: "a-2",
          application: { lineageId: "l1", name: "Claims bot" },
          matched: { enforced: 4, notEnforced: 2 },
          checks: 40,
          per100: 15,
        },
        {
          alias: "probe",
          application: null,
          matched: { enforced: 0, notEnforced: 5 },
          checks: 9,
          per100: null,
        },
      ],
      total: 7,
    });
  });

  it("links nothing without the applications, and counts none without rows", () => {
    const result = busiestApplications(
      [
        {
          alias: "a-2",
          checks: 10,
          matched: 1,
          matchedEnforced: 1,
          withMatches: 1,
        },
      ],
      null,
    );
    expect(result.shown[0]?.application).toBeNull();
    expect(busiestApplications([], null)).toEqual({ shown: [], total: 0 });
  });
});

describe("Guardrail decisions wording", () => {
  it("names a split with the decision log's words", () => {
    expect(splitText("block", { enforced: 8, notEnforced: 4 })).toBe(
      "8 blocked, 4 would block",
    );
    expect(splitText("block", { enforced: 0, notEnforced: 2 })).toBe(
      "2 would block",
    );
    expect(splitText("redact", { enforced: 3, notEnforced: 0 })).toBe(
      "3 redacted",
    );
    expect(splitText("redact", { enforced: 0, notEnforced: 0 })).toBe("None");
  });

  it("says whether a period's interventions were applied, would have been, or both", () => {
    const h = (enforced: number, notEnforced: number, checks = 200) =>
      decisionsHeadline({
        checks,
        interventions: { enforced, notEnforced },
        windowDays: 7,
      });
    expect(h(0, 0, 0)).toBe("No guardrail checks in the last 7 days.");
    expect(h(0, 0)).toBe(
      "None of 200 guardrail checks was refused or redacted.",
    );
    expect(h(10, 0)).toBe(
      "5% of 200 guardrail checks were refused or redacted.",
    );
    expect(h(0, 10)).toBe(
      "5% of 200 guardrail checks would have been refused or redacted.",
    );
    expect(h(1, 1, 1000)).toBe(
      "<1% of 1,000 guardrail checks were refused or redacted, or would have been.",
    );
  });

  it("gives a rate per 100 checks, and a dash without checks", () => {
    expect(perHundred(1, 3)).toBe("33.3");
    expect(perHundred(0, 10)).toBe("0.0");
    expect(perHundred(5, 0)).toBe("–");
  });
});

describe("stackSegments", () => {
  it("stacks each value from where the previous one ends, on the scale of max", () => {
    expect(stackSegments([1, 2, 1], 8, 80)).toEqual([
      { start: 0, size: 10 },
      { start: 10, size: 20 },
      { start: 30, size: 10 },
    ]);
  });

  it("treats negative and non-finite values as zero, and draws nothing without a max", () => {
    expect(stackSegments([-3, Number.NaN, 2], 2, 10)).toEqual([
      { start: 0, size: 0 },
      { start: 0, size: 0 },
      { start: 0, size: 10 },
    ]);
    expect(stackSegments([1, 2], 0, 10)).toEqual([
      { start: 0, size: 0 },
      { start: 0, size: 0 },
    ]);
  });

  it("never runs past the bar", () => {
    const segments = stackSegments([5, 5, 5], 10, 100);
    expect(segments[2]).toEqual({ start: 100, size: 0 });
    expect(segments.reduce((sum, s) => sum + s.size, 0)).toBe(100);
  });
});
