import { describe, expect, it } from "vitest";
import {
  type ScorecardInput,
  SCORECARD_THRESHOLDS,
  dailyTrend,
  enforcedShare,
  rankTopRisks,
  scoreApplication,
  summarise,
  threatType,
  threatTypeBreakdown,
  trendStart,
  utcDay,
  worstBand,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";

// CHG-2026-122 (ADR-0023): the application scorecard's bands. Pure functions,
// so every boundary is pinned here without a database.

const NOW = new Date("2026-10-06T12:00:00.000Z");

function input(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    key: {
      models: ["hr-assistant"],
      rpmLimit: 20,
      maxBudget: 50,
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      issuedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    calls: 200,
    failedCalls: 0,
    spendUsd: 5,
    guard: {
      promptChecks: 200,
      answerChecks: 190,
      promptBlocks: 0,
      answerBlocks: 0,
      redactions: 0,
      noVerdict: 0,
      enforcedChecks: 390,
    },
    mode: "enforce",
    now: NOW,
    ...overrides,
  };
}

function band(i: ScorecardInput, dimension: string) {
  return scoreApplication(i).dimensions.find((d) => d.dimension === dimension)!
    .band;
}

describe("application scorecard", () => {
  it("rates a well-run application on track in every dimension", () => {
    const score = scoreApplication(input());
    expect(score.dimensions.map((d) => d.band)).toEqual([
      "green",
      "green",
      "green",
      "green",
      "green",
      "green",
    ]);
    expect(score.overall).toBe("green");
  });

  it("protection: red when calls were never checked by the guardrail", () => {
    const i = input({
      guard: { ...input().guard, promptChecks: 0, answerChecks: 0 },
    });
    expect(band(i, "protection")).toBe("red");
    expect(scoreApplication(i).overall).toBe("red");
  });

  it("protection: amber in record mode, where decisions are not applied", () => {
    expect(band(input({ mode: "record" }), "protection")).toBe("amber");
  });

  it("protection: bands the share of checks without a verdict", () => {
    const g = input().guard;
    // 390 checks: 4 without a verdict is about 1.0% (amber), 20 is 5.1% (red)
    expect(band(input({ guard: { ...g, noVerdict: 3 } }), "protection")).toBe(
      "green",
    );
    expect(band(input({ guard: { ...g, noVerdict: 4 } }), "protection")).toBe(
      "amber",
    );
    expect(band(input({ guard: { ...g, noVerdict: 20 } }), "protection")).toBe(
      "red",
    );
  });

  it("protection: bands the share of calls whose prompt was checked", () => {
    const g = input().guard;
    expect(
      band(input({ guard: { ...g, promptChecks: 180 } }), "protection"),
    ).toBe("amber");
    expect(
      band(input({ guard: { ...g, promptChecks: 150 } }), "protection"),
    ).toBe("red");
  });

  it("threats: refused prompts per 100 calls against 1 and 5", () => {
    const g = input().guard;
    expect(band(input({ guard: { ...g, promptBlocks: 1 } }), "threats")).toBe(
      "green",
    );
    expect(band(input({ guard: { ...g, promptBlocks: 2 } }), "threats")).toBe(
      "amber",
    );
    expect(band(input({ guard: { ...g, promptBlocks: 10 } }), "threats")).toBe(
      "amber",
    );
    expect(band(input({ guard: { ...g, promptBlocks: 11 } }), "threats")).toBe(
      "red",
    );
  });

  it("data protection: redactions per 100 calls against 2 and 10", () => {
    const g = input().guard;
    expect(
      band(input({ guard: { ...g, redactions: 3 } }), "dataProtection"),
    ).toBe("green");
    expect(
      band(input({ guard: { ...g, redactions: 4 } }), "dataProtection"),
    ).toBe("amber");
    expect(
      band(input({ guard: { ...g, redactions: 21 } }), "dataProtection"),
    ).toBe("red");
  });

  it("does not rate rates on too little traffic", () => {
    const i = input({
      calls: SCORECARD_THRESHOLDS.minCallsForRates - 1,
      guard: { ...input().guard, promptChecks: 9, promptBlocks: 5 },
    });
    expect(band(i, "threats")).toBe("none");
    expect(band(i, "dataProtection")).toBe("none");
    expect(band(i, "reliability")).toBe("none");
  });

  it("protection is not rated with no calls at all", () => {
    expect(band(input({ calls: 0 }), "protection")).toBe("none");
  });

  it("access hygiene: green with all five checks, amber with 3 or 4, red below", () => {
    const k = input().key;
    expect(
      band(input({ key: { ...k, maxBudget: null } }), "accessHygiene"),
    ).toBe("amber");
    expect(
      band(
        input({ key: { ...k, maxBudget: null, expiresAt: null } }),
        "accessHygiene",
      ),
    ).toBe("amber");
    expect(
      band(
        input({
          key: { ...k, maxBudget: null, expiresAt: null, rpmLimit: null },
        }),
        "accessHygiene",
      ),
    ).toBe("red");
    const old = input({
      key: { ...k, issuedAt: new Date("2026-06-01T00:00:00.000Z") },
    });
    expect(
      scoreApplication(old).hygiene.find((c) => c.id === "rotation")!.ok,
    ).toBe(false);
  });

  it("access hygiene names the missing checks", () => {
    const score = scoreApplication(
      input({ key: { ...input().key, maxBudget: null } }),
    );
    const hygiene = score.dimensions.find(
      (d) => d.dimension === "accessHygiene",
    )!;
    expect(hygiene.evidence).toContain("Budget set");
  });

  it("spend: against the budget at 80% and 100%, and not rated without one", () => {
    expect(band(input({ spendUsd: 39 }), "spend")).toBe("green");
    expect(band(input({ spendUsd: 40 }), "spend")).toBe("amber");
    expect(band(input({ spendUsd: 51 }), "spend")).toBe("red");
    expect(
      band(input({ key: { ...input().key, maxBudget: null } }), "spend"),
    ).toBe("none");
  });

  it("spend: hidden for a role that may not see it", () => {
    const score = scoreApplication(input({ spendUsd: null }));
    const spend = score.dimensions.find((d) => d.dimension === "spend")!;
    expect(spend.band).toBe("none");
    expect(spend.evidence).toBe("Not shown for your role.");
  });

  it("reliability: failed calls against 2% and 5%", () => {
    expect(band(input({ failedCalls: 3 }), "reliability")).toBe("green");
    expect(band(input({ failedCalls: 4 }), "reliability")).toBe("amber");
    expect(band(input({ failedCalls: 11 }), "reliability")).toBe("red");
  });

  it("the overall band is the worst dimension, never an average", () => {
    expect(worstBand(["green", "none", "amber", "green"])).toBe("amber");
    expect(worstBand(["none", "none"])).toBe("none");
    expect(worstBand(["green", "red", "amber"])).toBe("red");
  });

  it("summarises the project and hides spend for a role without it", () => {
    const a = input();
    const b = input({
      key: { ...a.key, maxBudget: null },
      guard: { ...a.guard, promptBlocks: 30 },
    });
    const apps = [a, b].map((i) => ({ input: i, score: scoreApplication(i) }));
    const shown = summarise(apps, true);
    expect(shown.applications).toBe(2);
    expect(shown.byOverall.green).toBe(1);
    expect(shown.byOverall.red).toBe(1);
    expect(shown.promptBlocks).toBe(30);
    expect(shown.missingBudget).toBe(1);
    expect(shown.spendUsd).toBe(10);
    expect(summarise(apps, false).spendUsd).toBeNull();
  });
});

// CHG-2026-122 (ADR-0023), second iteration: the executive summary's top
// risks and enforced share, threat activity by type, and the daily trend.

function dimension(i: ScorecardInput, name: string) {
  return scoreApplication(i).dimensions.find((d) => d.dimension === name)!;
}

describe("how far past its threshold a dimension is", () => {
  it("is zero when on track or not rated", () => {
    for (const d of scoreApplication(input()).dimensions)
      expect(d.excess).toBe(0);
    expect(dimension(input({ calls: 5 }), "threats").excess).toBe(0);
  });

  it("is measured against the threshold of the band it reached", () => {
    const g = input().guard;
    // 200 calls: 15 refused is 7.5 per 100, half again past the red 5
    expect(
      dimension(input({ guard: { ...g, promptBlocks: 15 } }), "threats").excess,
    ).toBeCloseTo(0.5);
    // 4 refused is 2 per 100, once past the amber 1
    expect(
      dimension(input({ guard: { ...g, promptBlocks: 4 } }), "threats").excess,
    ).toBeCloseTo(1);
    // $60 of $50 is 120%, a fifth past the red 100%
    expect(dimension(input({ spendUsd: 60 }), "spend").excess).toBeCloseTo(0.2);
  });

  it("protection: no checks at all is fully past; record mode sits at its threshold", () => {
    const g = input().guard;
    expect(
      dimension(
        input({ guard: { ...g, promptChecks: 0, answerChecks: 0 } }),
        "protection",
      ).excess,
    ).toBe(1);
    expect(dimension(input({ mode: "record" }), "protection").excess).toBe(0);
    // 120 of 200 calls checked is 60%, a quarter below the red 80%
    expect(
      dimension(input({ guard: { ...g, promptChecks: 120 } }), "protection")
        .excess,
    ).toBeCloseTo(0.25);
  });

  it("access hygiene counts missing checks from one (amber) and three (red)", () => {
    const k = input().key;
    expect(
      dimension(input({ key: { ...k, maxBudget: null } }), "accessHygiene")
        .excess,
    ).toBe(0);
    expect(
      dimension(
        input({ key: { ...k, maxBudget: null, expiresAt: null } }),
        "accessHygiene",
      ).excess,
    ).toBe(1);
    expect(
      dimension(
        input({
          key: {
            ...k,
            maxBudget: null,
            expiresAt: null,
            rpmLimit: null,
            models: [],
          },
        }),
        "accessHygiene",
      ).excess,
    ).toBeCloseTo(1 / 3);
  });
});

describe("top risks", () => {
  const g = input().guard;
  const app = (name: string, i: ScorecardInput) => ({
    name,
    alias: `cairo-${name}`,
    score: scoreApplication(i),
  });

  it("lists red before amber, then the furthest past its threshold", () => {
    const { risks, total } = rankTopRisks(
      [
        // amber: protection in record mode (0 past)
        app("alpha", input({ mode: "record" })),
        // red: 15 refused per 200 calls (0.5 past red)
        app("bravo", input({ guard: { ...g, promptBlocks: 15 } })),
        // red: $90 of $50 is 180% (0.8 past red)
        app("charlie", input({ spendUsd: 90 })),
        // amber: 4 failed of 200 (0 past amber); on track otherwise
        app("delta", input({ failedCalls: 4 })),
        app("echo", input()),
      ],
      10,
    );
    expect(risks.map((r) => [r.name, r.dimension, r.band])).toEqual([
      ["charlie", "spend", "red"],
      ["bravo", "threats", "red"],
      ["alpha", "protection", "amber"],
      ["delta", "reliability", "amber"],
    ]);
    expect(total).toBe(4);
    expect(risks[0]!.evidence).toBe("$90.00 of a $50.00 budget (180%).");
  });

  it("caps the list but counts every risk", () => {
    const apps = ["a", "b", "c"].map((n) => app(n, input({ mode: "record" })));
    const { risks, total } = rankTopRisks(apps, 2);
    expect(risks.map((r) => r.name)).toEqual(["a", "b"]);
    expect(total).toBe(3);
  });

  it("is empty when every dimension is on track or not rated", () => {
    expect(
      rankTopRisks([app("a", input()), app("b", input({ calls: 0 }))], 5),
    ).toEqual({ risks: [], total: 0 });
  });
});

describe("traffic EYEON enforced", () => {
  it("is the share of checks decided in enforce mode, none without checks", () => {
    expect(enforcedShare(400, 300)).toBe(75);
    expect(enforcedShare(0, 0)).toBeNull();
  });

  it("is summed across applications", () => {
    const a = input();
    const b = input({ guard: { ...a.guard, enforcedChecks: 0 } });
    const s = summarise(
      [a, b].map((i) => ({ input: i, score: scoreApplication(i) })),
      true,
    );
    expect(s.checks).toBe(780);
    expect(s.enforcedChecks).toBe(390);
    expect(s.enforcedPct).toBe(50);
  });
});

describe("threat activity by type", () => {
  it("maps the labels the guardrail sends today", () => {
    expect(threatType("Jailbreak Detection")).toBe("jailbreak");
    expect(threatType("Topical Rail")).toBe("offTopic");
    expect(threatType("PII Redaction")).toBe("personalData");
    expect(threatType("Input too large for inspection")).toBe("oversized");
  });

  it("maps finer labels by keyword, case-insensitively", () => {
    expect(threatType("Prompt injection")).toBe("jailbreak");
    expect(threatType("Harmful content")).toBe("harmfulContent");
    expect(threatType("self-harm")).toBe("harmfulContent");
    expect(threatType("SECTOR RULES: banking")).toBe("sectorRules");
    expect(threatType("Off-topic")).toBe("offTopic");
    expect(threatType("Personal data")).toBe("personalData");
  });

  it("counts a missing or unknown label as Other, never by its text", () => {
    expect(threatType(null)).toBe("other");
    expect(threatType("")).toBe("other");
    expect(threatType("Pharmacy scope")).toBe("other");
    expect(threatType("something new")).toBe("other");
  });

  it("groups refusals by type, most frequent first, ties in a fixed order", () => {
    expect(
      threatTypeBreakdown([
        { policyTriggered: "Jailbreak Detection", count: 3 },
        { policyTriggered: "Topical Rail", count: 5 },
        { policyTriggered: "jailbreak", count: 2 },
        { policyTriggered: null, count: 5 },
        { policyTriggered: "Input too large for inspection", count: 1 },
      ]),
    ).toEqual([
      { type: "jailbreak", label: "Jailbreak or misuse", count: 5 },
      { type: "offTopic", label: "Off-topic or outside policy", count: 5 },
      { type: "other", label: "Other", count: 5 },
      { type: "oversized", label: "Too large to check", count: 1 },
    ]);
    expect(threatTypeBreakdown([])).toEqual([]);
  });
});

describe("daily trend", () => {
  it("starts at midnight UTC so that the last day is today", () => {
    const start = trendStart(NOW, 7);
    expect(start.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(utcDay(start)).toBe("2026-09-30");
  });

  it("has one point per day, zero-filled, summing rows for the same day", () => {
    const start = trendStart(NOW, 7);
    const points = dailyTrend(start, 7, [
      { day: "2026-09-30", calls: 10, refused: 0 },
      { day: "2026-10-06", calls: 4, refused: 0 },
      { day: "2026-10-06", calls: 0, refused: 2 },
      { day: "2026-10-06", calls: 3, refused: 1 },
      // outside the trend: ignored
      { day: "2026-09-29", calls: 99, refused: 99 },
    ]);
    expect(points.map((p) => p.day)).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(points[0]).toEqual({ day: "2026-09-30", calls: 10, refused: 0 });
    expect(points[3]).toEqual({ day: "2026-10-03", calls: 0, refused: 0 });
    expect(points[6]).toEqual({ day: "2026-10-06", calls: 7, refused: 3 });
  });

  it("covers a 30-day period across a month end", () => {
    const points = dailyTrend(trendStart(NOW, 30), 30, []);
    expect(points).toHaveLength(30);
    expect(points[0]!.day).toBe("2026-09-07");
    expect(points[29]!.day).toBe("2026-10-06");
  });
});
