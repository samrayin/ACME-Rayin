import { describe, it, expect } from "vitest";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
} from "@langfuse/shared/src/db";
import {
  budgetUse,
  dailyDecisions,
  decisionTotals,
  overviewMode,
} from "@/src/features/acme-enhancements/server/eyeonOverview";
import {
  type GuardrailModeChange,
  type GuardrailSettingsVersion,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  budgetPeriodLabel,
  formatRate,
  formatShare,
  interventionLabel,
  modeSplitNote,
} from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";
import {
  bulletScale,
  clampFraction,
  ringArcPath,
  sparklinePaths,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonChartGeometry";

// CHG-2026-132 (ADR-0027): the EYEON overview's pure functions: its figures,
// its wording, and the geometry of the kit's charts.

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

describe("decisionTotals", () => {
  it("is all zeros, with no enforced share, without checks", () => {
    expect(decisionTotals([])).toEqual({
      checks: 0,
      promptChecks: 0,
      answerChecks: 0,
      allowed: 0,
      promptsRefused: { enforced: 0, notEnforced: 0 },
      answersWithheld: { enforced: 0, notEnforced: 0 },
      redactions: { enforced: 0, notEnforced: 0 },
      noVerdict: 0,
      enforcedChecks: 0,
      enforcedPct: null,
    });
  });

  it("splits refusals, withheld answers and redactions by the reported mode", () => {
    const t = decisionTotals([
      group(INPUT, ALLOW, "enforce", 6),
      group(INPUT, BLOCK, "enforce", 2),
      group(INPUT, BLOCK, "record", 1),
      group(OUTPUT, BLOCK, "enforce", 1),
      group(OUTPUT, REDACT, "record", 3),
      group(INPUT, REDACT, "enforce", 4),
      group(INPUT, UNAVAILABLE, null, 3),
    ]);
    expect(t.checks).toBe(20);
    expect(t.promptChecks).toBe(16);
    expect(t.answerChecks).toBe(4);
    expect(t.allowed).toBe(6);
    expect(t.promptsRefused).toEqual({ enforced: 2, notEnforced: 1 });
    expect(t.answersWithheld).toEqual({ enforced: 1, notEnforced: 0 });
    expect(t.redactions).toEqual({ enforced: 4, notEnforced: 3 });
    expect(t.noVerdict).toBe(3);
    expect(t.enforcedChecks).toBe(13);
    expect(t.enforcedPct).toBeCloseTo(65);
  });

  it("counts an unreported or unknown mode as not enforced", () => {
    const t = decisionTotals([
      group(INPUT, BLOCK, null, 2),
      group(INPUT, BLOCK, "ENFORCE", 1),
      group(INPUT, BLOCK, "enforced", 1),
    ]);
    expect(t.promptsRefused).toEqual({ enforced: 0, notEnforced: 4 });
    expect(t.enforcedPct).toBe(0);
  });
});

describe("dailyDecisions", () => {
  const start = new Date("2026-10-01T00:00:00.000Z");
  const row = (day: string, checks: number) => ({
    day,
    checks,
    promptsRefused: 1,
    answersWithheld: 0,
    redactions: 2,
    noVerdict: 0,
  });

  it("has one point per UTC day, zeros where nothing happened", () => {
    const points = dailyDecisions(start, 3, [row("2026-10-02", 5)]);
    expect(points.map((p) => [p.day, p.checks, p.redactions])).toEqual([
      ["2026-10-01", 0, 0],
      ["2026-10-02", 5, 2],
      ["2026-10-03", 0, 0],
    ]);
  });

  it("ignores rows outside the range and adds rows for the same day", () => {
    const points = dailyDecisions(start, 2, [
      row("2026-09-30", 9),
      row("2026-10-01", 1),
      row("2026-10-01", 2),
      row("2026-10-05", 9),
    ]);
    expect(points.map((p) => p.checks)).toEqual([3, 0]);
    expect(points[0]?.promptsRefused).toBe(2);
  });
});

describe("overviewMode", () => {
  const now = new Date("2026-10-07T10:00:00.000Z");
  const version = (
    mode: "record" | "enforce",
    revertAt: Date | null = null,
  ): GuardrailSettingsVersion => ({
    version: 3,
    mode,
    revertAt,
    automatic: false,
    piiEntities: [],
    jailbreakEnabled: true,
    topicalEnabled: true,
    reason: "a reason",
    createdBy: "someone",
    createdByEmail: null,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
  });
  const change = (
    mode: "record" | "enforce",
    at: string,
    automatic = false,
  ): GuardrailModeChange => ({
    version: 2,
    mode,
    previousMode: null,
    revertAt: null,
    automatic,
    reason: "a reason",
    createdBy: "someone",
    createdByEmail: null,
    createdAt: new Date(at),
  });

  it("is not reported without stored settings", () => {
    expect(overviewMode(null, [], now, "enforce")).toEqual({
      mode: null,
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: null,
    });
  });

  it("serves enforce under an enforce ceiling, with the trial's end", () => {
    const revertAt = new Date("2026-10-07T10:30:00.000Z");
    const m = overviewMode(version("enforce", revertAt), [], now, "enforce");
    expect(m.mode).toBe("enforce");
    expect(m.trialEndsAt).toBe("2026-10-07T10:30:00.000Z");
  });

  it("caps enforce at a record ceiling, and an ended trial reads as record", () => {
    expect(overviewMode(version("enforce"), [], now, "record")).toMatchObject({
      mode: "record",
      ceiling: "record",
      trialEndsAt: null,
    });
    const ended = new Date("2026-10-07T09:00:00.000Z");
    expect(
      overviewMode(version("enforce", ended), [], now, "enforce"),
    ).toMatchObject({ mode: "record", trialEndsAt: null });
  });

  it("names the newest change, without who made it", () => {
    const m = overviewMode(
      version("record"),
      [
        change("enforce", "2026-10-05T09:00:00.000Z"),
        change("record", "2026-10-05T09:30:00.000Z", true),
      ],
      now,
      "enforce",
    );
    expect(m.lastChange).toEqual({
      at: "2026-10-05T09:30:00.000Z",
      to: "record",
      automatic: true,
    });
    expect(JSON.stringify(m)).not.toContain("someone");
  });
});

describe("budgetUse", () => {
  const app = (
    name: string,
    spendUsd: number | null,
    maxBudget: number | null,
  ) => ({
    name,
    alias: `${name}-key`,
    budgetDuration: "30d",
    spendUsd,
    maxBudget,
  });

  it("lists the most used first, up to the limit, and counts the rest", () => {
    const b = budgetUse(
      [
        app("Alpha", 5, 10),
        app("Bravo", 12, 10),
        app("Charlie", 1, 100),
        app("Delta", 3, null),
        app("Echo", 2, 0),
      ],
      2,
    );
    expect(b.shown.map((s) => [s.name, s.usedPct])).toEqual([
      ["Bravo", 120],
      ["Alpha", 50],
    ]);
    expect(b.withBudget).toBe(3);
    expect(b.withoutBudget).toBe(2);
    expect(b.totalUsd).toBe(23);
  });

  it("leaves out an application whose spend was withheld", () => {
    const b = budgetUse([app("Alpha", null, 10), app("Bravo", 1, 10)], 5);
    expect(b.shown.map((s) => s.name)).toEqual(["Bravo"]);
    expect(b.totalUsd).toBe(1);
  });

  it("breaks ties by name", () => {
    const b = budgetUse([app("Zulu", 5, 10), app("Alpha", 1, 2)], 5);
    expect(b.shown.map((s) => s.name)).toEqual(["Alpha", "Zulu"]);
  });
});

describe("overview wording", () => {
  it("names a count by how much of it was applied", () => {
    const none = { enforced: 0, notEnforced: 0 };
    const applied = { enforced: 3, notEnforced: 0 };
    const unapplied = { enforced: 0, notEnforced: 2 };
    const mixed = { enforced: 3, notEnforced: 2 };
    expect(interventionLabel("promptsRefused", none)).toBe("Prompts refused");
    expect(interventionLabel("promptsRefused", applied)).toBe(
      "Prompts refused",
    );
    expect(interventionLabel("promptsRefused", unapplied)).toBe(
      "Prompts that would be refused",
    );
    expect(interventionLabel("answersWithheld", mixed)).toBe(
      "Answers withheld or would be",
    );
    expect(interventionLabel("redactions", unapplied)).toBe(
      "Personal data that would be redacted",
    );
    expect(modeSplitNote(none)).toBe("None in this period");
    expect(modeSplitNote(applied)).toBe("All applied, in enforce mode");
    expect(modeSplitNote(unapplied)).toBe(
      "Recorded, not applied: record mode or mode not reported",
    );
    expect(modeSplitNote(mixed)).toBe(
      "3 applied in enforce mode, 2 recorded only",
    );
  });

  it("never rounds a share up to 100% or down to 0%", () => {
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(0.4)).toBe("<1%");
    expect(formatShare(42.6)).toBe("43%");
    expect(formatShare(99.6)).toBe(">99%");
    expect(formatShare(100)).toBe("100%");
  });

  it("shows a rate with two decimals below 10%", () => {
    expect(formatRate(0)).toBe("0.00%");
    expect(formatRate(0.00001)).toBe("<0.01%");
    expect(formatRate(0.01)).toBe("1.00%");
    expect(formatRate(0.125)).toBe("12.5%");
  });

  it("says a key's budget period in words", () => {
    expect(budgetPeriodLabel("30d")).toBe("per 30 days");
    expect(budgetPeriodLabel("1d")).toBe("per day");
    expect(budgetPeriodLabel("1mo")).toBe("per month");
    expect(budgetPeriodLabel("12h")).toBe("per 12 hours");
    expect(budgetPeriodLabel(null)).toBe("with no reset period");
    expect(budgetPeriodLabel("weekly")).toBe("per weekly");
  });
});

describe("EYEON chart geometry", () => {
  it("draws no sparkline without values, and a flat line for one", () => {
    expect(sparklinePaths([], 100, 20)).toEqual({ line: "", area: "" });
    expect(sparklinePaths([5], 100, 20).line).toBe("M0 2 L100 2");
  });

  it("scales a series into the box, zero at the bottom, the peak at the top", () => {
    const { line, area } = sparklinePaths([0, 10, 5], 100, 20, 2);
    expect(line).toBe("M0 18 L50 2 L100 10");
    expect(area).toBe("M0 18 L50 2 L100 10 L100 20 L0 20 Z");
  });

  it("keeps an all-zero series on the baseline and ignores negatives", () => {
    expect(sparklinePaths([0, 0], 10, 10, 1).line).toBe("M0 9 L10 9");
    expect(sparklinePaths([-3, 2], 10, 10, 1).line).toBe("M0 9 L10 1");
  });

  it("draws a ring's arc clockwise from 12 o'clock", () => {
    expect(ringArcPath(60, 60, 50, 0)).toBe("");
    expect(ringArcPath(60, 60, 50, 0.25)).toBe("M60 10 A50 50 0 0 1 110 60");
    expect(ringArcPath(60, 60, 50, 0.75)).toBe("M60 10 A50 50 0 1 1 10 60");
    expect(ringArcPath(60, 60, 50, 1)).toBe(
      "M60 10 A50 50 0 1 1 60 110 A50 50 0 1 1 60 10",
    );
    expect(ringArcPath(60, 60, 50, 7)).toBe(ringArcPath(60, 60, 50, 1));
  });

  it("clamps a fraction to 0..1, and anything not finite to 0", () => {
    expect(clampFraction(-1)).toBe(0);
    expect(clampFraction(0.3)).toBe(0.3);
    expect(clampFraction(2)).toBe(1);
    expect(clampFraction(Number.NaN)).toBe(0);
    expect(clampFraction(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("puts a bullet's value and target on a scale 15% past the larger", () => {
    expect(bulletScale(50, 100, 230)).toEqual({
      max: 115,
      valueX: 100,
      targetX: 200,
    });
    const over = bulletScale(200, 100, 230);
    expect(over.max).toBe(230);
    expect(over.valueX).toBe(200);
    expect(over.targetX).toBe(100);
    expect(bulletScale(0, 0, 100)).toEqual({ max: 1, valueX: 0, targetX: 0 });
  });
});
