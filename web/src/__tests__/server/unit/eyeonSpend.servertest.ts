import { describe, it, expect } from "vitest";
import { windowRange } from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";
import {
  BREAKDOWN_ROWS_SHOWN,
  SPEND_MODELS_SHOWN,
  monthToDate,
  monthWindow,
  previousTotals,
  spendBreakdowns,
  spendByModel,
  spendRatios,
  spendSeries,
  spendTotals,
} from "@/src/features/acme-enhancements/server/eyeonSpend";
import {
  budgetPeriodText,
  changeText,
  formatCount,
  formatPct,
  formatUsd,
  monthHeadline,
  monthName,
  monthSentence,
} from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";

// CHG-2026-143 (ADR-0027): the EYEON Cost and usage page's figures and
// wording, without a database. The month's run-rate is a straight line
// and is not drawn in the first day; a ratio with nothing to divide by is
// null, never zero; every list adds up to the period's spend; money never
// reads as nothing when it is above zero.

function bucket(i: number, over: Partial<Record<string, number>> = {}) {
  return {
    bucket: i,
    calls: 10,
    failed: 0,
    spend: 1,
    promptTokens: 80,
    completionTokens: 20,
    totalTokens: 100,
    cacheHits: 0,
    cacheReported: 0,
    newestReceivedAt: null,
    ...over,
  };
}

describe("the month to date (CHG-2026-143)", () => {
  it("is the calendar month in UTC, whatever the period", () => {
    const m = monthWindow(new Date("2026-02-10T23:30:00.000Z"));
    expect(m.start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(m.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(m.daysInMonth).toBe(28);
    expect(m.dayOfMonth).toBe(10);
  });

  it("fills every day up to today, keeps a running total and carries the daily average to the month's end", () => {
    // 8 October, 12:00 UTC: 7.5 days have passed.
    const now = new Date("2026-10-08T12:00:00.000Z");
    const m = monthToDate(
      [
        { day: "2026-10-02", spend: 60, calls: 10 },
        { day: "2026-10-08", spend: 15, calls: 5 },
      ],
      now,
    );
    expect(m.month).toBe("2026-10");
    expect(m.days).toHaveLength(8);
    expect(m.days[0]).toEqual({
      day: "2026-10-01",
      spendUsd: 0,
      calls: 0,
      cumulativeUsd: 0,
    });
    expect(m.days[1]?.cumulativeUsd).toBe(60);
    expect(m.days[7]?.cumulativeUsd).toBe(75);
    expect(m.spentUsd).toBe(75);
    expect(m.calls).toBe(15);
    expect(m.dailyAverageUsd).toBeCloseTo(10);
    expect(m.projectedUsd).toBeCloseTo(310);
  });

  it("counts a day stamped past today in today, and draws no run-rate in the first day", () => {
    const now = new Date("2026-10-01T09:00:00.000Z");
    const m = monthToDate(
      [
        { day: "2026-10-01", spend: 3, calls: 1 },
        { day: "2026-10-02", spend: 2, calls: 1 },
      ],
      now,
    );
    expect(m.days).toHaveLength(1);
    expect(m.spentUsd).toBe(5);
    expect(m.dailyAverageUsd).toBeNull();
    expect(m.projectedUsd).toBeNull();
    expect(monthHeadline(m)).toBe("$5.00 spent so far in October.");
    expect(monthSentence(m)).toMatch(/no run-rate is drawn yet/);
  });
});

describe("the period (CHG-2026-143)", () => {
  const now = new Date("2026-10-08T12:30:00.000Z");

  it("has every bucket, zero where nothing was logged, and drops none of the period's calls", () => {
    const range = windowRange("24h", now);
    const series = spendSeries(range, [
      bucket(0),
      bucket(23, { spend: 2 }),
      // A call a little ahead of the console's clock counts in the last
      // bucket; one before the period is dropped.
      bucket(24, { spend: 4 }),
      bucket(-1, { spend: 100 }),
    ]);
    expect(series).toHaveLength(24);
    expect(series[0]?.spendUsd).toBe(1);
    expect(series[1]?.spendUsd).toBe(0);
    expect(series[23]?.spendUsd).toBe(6);
    expect(series[0]?.label).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:00$/);
    expect(spendSeries(windowRange("30d", now), [])[0]?.label).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(spendTotals([bucket(0), bucket(-1)]).spendUsd).toBe(1);
  });

  it("gives no ratio where there is nothing to divide by", () => {
    const empty = spendTotals([]);
    expect(spendRatios(empty)).toEqual({
      costPer1kTokensUsd: null,
      failedPct: null,
      failedBand: "none",
      cacheHitPct: null,
    });
  });

  it("rates the failed share as the Applications check, from 10 calls", () => {
    const few = spendTotals([bucket(0, { calls: 9, failed: 9 })]);
    expect(spendRatios(few)).toMatchObject({
      failedPct: 100,
      failedBand: "none",
    });
    expect(
      spendRatios(spendTotals([bucket(0, { calls: 100, failed: 2 })]))
        .failedBand,
    ).toBe("amber");
    expect(
      spendRatios(spendTotals([bucket(0, { calls: 100, failed: 1 })]))
        .failedBand,
    ).toBe("green");
    expect(
      spendRatios(spendTotals([bucket(0, { calls: 100, failed: 6 })]))
        .failedBand,
    ).toBe("red");
  });

  it("works out cost per 1K tokens and the cache share from what was reported", () => {
    const t = spendTotals([
      bucket(0, {
        spend: 3,
        totalTokens: 1_500,
        cacheHits: 2,
        cacheReported: 8,
      }),
    ]);
    const r = spendRatios(t);
    expect(r.costPer1kTokensUsd).toBeCloseTo(2);
    expect(r.cacheHitPct).toBe(25);
  });

  it("counts the previous period's failures as any status but success", () => {
    expect(
      previousTotals([
        { status: "success", _count: { _all: 9 }, _sum: { spend: 4 } },
        { status: "failure", _count: { _all: 1 }, _sum: { spend: null } },
        { status: "", _count: { _all: 2 }, _sum: { spend: 1 } },
      ]),
    ).toEqual({ spendUsd: 5, calls: 12, failed: 3 });
  });
});

describe("where the money goes (CHG-2026-143)", () => {
  it("lists the costliest models and sums the rest, so the list adds up", () => {
    const rows = Array.from({ length: SPEND_MODELS_SHOWN }, (_, i) => ({
      model: i === 3 ? null : `m-${i}`,
      calls: 10,
      failed: 0,
      spend: 10 - i,
      totalTokens: 100,
      models: 14,
    }));
    const listed = rows.reduce((s, r) => s + r.spend, 0);
    const b = spendByModel(rows, { spendUsd: listed + 7, calls: 130 });
    expect(b.rows).toHaveLength(SPEND_MODELS_SHOWN);
    expect(b.rows[3]?.name).toBe("Model not reported");
    expect(b.rows[0]?.sharePct).toBeCloseTo((100 * 10) / (listed + 7));
    expect(b.rest).toEqual({ count: 4, spendUsd: 7, calls: 30 });
  });

  it("gives no share when the period spent nothing", () => {
    const b = spendByModel(
      [
        {
          model: "m",
          calls: 3,
          failed: 0,
          spend: 0,
          totalTokens: 0,
          models: 1,
        },
      ],
      { spendUsd: 0, calls: 3 },
    );
    expect(b.rows[0]?.sharePct).toBeNull();
    expect(b.rest.count).toBe(0);
  });

  it("lists at most the shown rows per breakdown and sums the rest", () => {
    const keys = Array.from({ length: BREAKDOWN_ROWS_SHOWN + 3 }, (_, i) => ({
      lineageId: `l-${i}`,
      generation: 1,
      displayName: `App ${i}`,
      litellmKeyAlias: `a-${i}`,
      status: "ACTIVE" as const,
      litellmTeamId: null,
      maxBudget: null,
      budgetDuration: null,
    }));
    const rows = keys.map((k, i) => ({
      keyAlias: k.litellmKeyAlias,
      _count: { _all: 1 },
      _sum: { spend: i + 1, totalTokens: 10 },
    }));
    const total = rows.reduce((s, r) => s + r._sum.spend, 0);
    const b = spendBreakdowns(keys, [], rows, total);
    expect(b.application.rows).toHaveLength(BREAKDOWN_ROWS_SHOWN);
    expect(b.application.rows[0]?.name).toBe(`App ${BREAKDOWN_ROWS_SHOWN + 2}`);
    expect(b.application.rest).toEqual({ count: 3, spendUsd: 6, calls: 3 });
    expect(b.team.rows).toEqual([
      expect.objectContaining({ name: "No team", spendUsd: total }),
    ]);
  });

  it("counts calls without a known key, never under the alias", () => {
    const b = spendBreakdowns(
      [],
      [],
      [
        {
          keyAlias: null,
          _count: { _all: 2 },
          _sum: { spend: 1, totalTokens: 5 },
        },
        {
          keyAlias: "stray-alias",
          _count: { _all: 1 },
          _sum: { spend: 2, totalTokens: null },
        },
      ],
      3,
    );
    expect(b.key.rows).toEqual([
      expect.objectContaining({
        name: "Key not in use",
        spendUsd: 3,
        calls: 3,
      }),
    ]);
    expect(JSON.stringify(b)).not.toContain("stray-alias");
  });
});

describe("the wording (CHG-2026-143)", () => {
  it("writes money to the cent, and never a sliver as nothing", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.0042)).toBe("$0.0042");
  });

  it("shortens large counts and small shares", () => {
    expect(formatCount(9_999)).toBe("9,999");
    expect(formatCount(12_400)).toBe("12.4K");
    expect(formatPct(0.04)).toBe("<0.1%");
    expect(formatPct(12.345)).toBe("12.3%");
  });

  it("states the change from the previous period in words", () => {
    expect(changeText(110, 100, "7d")).toBe("+10.0% on the previous 7 days");
    expect(changeText(90, 100, "24h")).toBe("−10.0% on the previous 24 hours");
    expect(changeText(5, 0, "30d")).toBe("None in the previous 30 days");
    expect(changeText(0, 0, "7d")).toBe("No change on the previous 7 days");
  });

  it("names the month and the run-rate as a straight line", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(
      monthHeadline({ month: "2026-10", spentUsd: 75, projectedUsd: 310 }),
    ).toBe("On pace to spend $310.00 in October.");
    expect(
      monthSentence({
        spentUsd: 75,
        dayOfMonth: 8,
        daysInMonth: 31,
        dailyAverageUsd: 10,
        projectedUsd: 310,
      }),
    ).toBe(
      "$75.00 spent by day 8 of 31 (UTC). At the month-to-date daily average of $10.00, the month closes at about $310.00. A straight line, not a forecast.",
    );
  });

  it("puts a key's budget period in words", () => {
    expect(budgetPeriodText("30d")).toBe("Resets every 30 days");
    expect(budgetPeriodText("1mo")).toBe("Resets every month");
    expect(budgetPeriodText("24h")).toBe("Resets every 24 hours");
    expect(budgetPeriodText(null)).toBe("No reset: a lifetime budget");
  });
});
