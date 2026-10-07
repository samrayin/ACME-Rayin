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
  refusalsByType,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  decisionsHeadline,
  perHundred,
  splitText,
} from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";
import { stackSegments } from "@/src/features/acme-enhancements/components/eyeon/eyeonChartGeometry";

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
      { ...zero, day: "2026-10-02", checks: 9, blocked: 1, wouldBlock: 2 },
      { ...zero, day: "2026-10-02", checks: 1, noVerdict: 1 },
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
      blocked: 1,
      wouldBlock: 2,
      noVerdict: 1,
    });
  });
});

describe("refusalsByType", () => {
  function refusal(
    policyTriggered: string | null,
    direction: AcmeGuardrailEventDirection,
    gatewayMode: string | null,
    n: number,
  ) {
    return { policyTriggered, direction, gatewayMode, _count: { _all: n } };
  }

  it("is empty without refusals", () => {
    expect(refusalsByType([])).toEqual([]);
  });

  it("maps labels to types, most frequent first, with the mode and direction split", () => {
    const types = refusalsByType([
      refusal("Topical Rail", OUTPUT, "enforce", 2),
      refusal("Jailbreak Detection", INPUT, "record", 3),
      refusal("jailbreak detection", INPUT, "enforce", 1),
      refusal("Input too large for inspection", INPUT, null, 1),
      refusal("something new", INPUT, "enforce", 1),
      refusal(null, OUTPUT, "record", 1),
    ]);
    expect(types).toEqual([
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 4,
        split: { enforced: 1, notEnforced: 3 },
        prompts: 4,
        answers: 0,
      },
      {
        type: "offTopic",
        label: "Off-topic or outside policy",
        count: 2,
        split: { enforced: 2, notEnforced: 0 },
        prompts: 0,
        answers: 2,
      },
      {
        type: "other",
        label: "Other",
        count: 2,
        split: { enforced: 1, notEnforced: 1 },
        prompts: 1,
        answers: 1,
      },
      {
        type: "oversized",
        label: "Too large to check",
        count: 1,
        split: { enforced: 0, notEnforced: 1 },
        prompts: 1,
        answers: 0,
      },
    ]);
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
          refusals: 6,
          refusalsEnforced: 4,
          withRefusals: 7,
        },
        {
          alias: "probe",
          checks: 9,
          refusals: 5,
          refusalsEnforced: 0,
          withRefusals: 7,
        },
      ],
      apps,
    );
    expect(result).toEqual({
      shown: [
        {
          alias: "a-2",
          application: { lineageId: "l1", name: "Claims bot" },
          refusals: { enforced: 4, notEnforced: 2 },
          checks: 40,
          per100: 15,
        },
        {
          alias: "probe",
          application: null,
          refusals: { enforced: 0, notEnforced: 5 },
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
          refusals: 1,
          refusalsEnforced: 1,
          withRefusals: 1,
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
