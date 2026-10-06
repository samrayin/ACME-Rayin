import { describe, expect, it } from "vitest";
import {
  type ScorecardInput,
  SCORECARD_THRESHOLDS,
  scoreApplication,
  summarise,
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
