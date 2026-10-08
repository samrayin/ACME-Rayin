import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonSpendPage from "@/src/features/acme-enhancements/pages/EyeonSpendPage";

// CHG-2026-143 (ADR-0027): the EYEON Cost and usage page on fixed figures.
// The month's run-rate is named as a straight line; a figure EYEON does not
// hold says "Not recorded", never a number; an application links to its
// screen only for a role that may open it; the switched-off page points to
// the LLM Gateway's Spend tab.

const h = vi.hoisted(() => ({ result: {} as unknown }));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonSpend: {
      summary: { useQuery: () => h.result },
    },
  },
}));
vi.mock("@/src/hooks/useProjectIdFromURL", () => ({
  default: () => "p1",
}));
vi.mock("@/src/components/layouts/page", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const NOW = "2026-10-08T12:00:00.000Z";

function series() {
  return Array.from({ length: 28 }, (_, i) => {
    const start = new Date(
      Date.parse("2026-10-01T18:00:00.000Z") + i * 6 * 3_600_000,
    ).toISOString();
    return {
      start,
      label: `${start.slice(0, 10)} ${start.slice(11, 16)}`,
      spendUsd: 5,
      calls: 20,
      totalTokens: 2_000,
    };
  });
}

function breakdown(rows: { id: string; name: string; lineageId?: string }[]) {
  return {
    rows: rows.map((r, i) => ({
      ...r,
      spendUsd: 100 - i * 40,
      calls: 300 - i * 100,
      totalTokens: 30_000,
      sharePct: 71.4 - i * 28.6,
    })),
    rest: { count: 0, spendUsd: 0, calls: 0 },
  };
}

function summary(opts: { links: boolean; cache: boolean; tokens: boolean }) {
  return {
    enabled: true as const,
    window: "7d",
    generatedAt: NOW,
    gatewayManagement: true,
    requestLog: true,
    links: { applications: opts.links, gatewayHealth: opts.links },
    mirror: {
      state: "withinLag",
      expectedLagMinutes: 7,
      completeTo: "2026-10-08T11:55:00.000Z",
      lastReconciledAt: "2026-10-08T11:57:00.000Z",
      lastGapCount: 0,
      newestArrival: "2026-10-08T11:59:00.000Z",
    },
    month: {
      month: "2026-10",
      daysInMonth: 31,
      dayOfMonth: 8,
      spentUsd: 207,
      calls: 900,
      dailyAverageUsd: 27.6,
      projectedUsd: 855.6,
      days: Array.from({ length: 8 }, (_, i) => ({
        day: `2026-10-0${i + 1}`,
        spendUsd: 25.875,
        calls: 112,
        cumulativeUsd: 25.875 * (i + 1),
      })),
    },
    period: {
      from: "2026-10-01T18:00:00.000Z",
      bucketMinutes: 360,
      series: series(),
      totals: {
        spendUsd: 140,
        calls: 560,
        failed: 33,
        promptTokens: opts.tokens ? 40_000 : 0,
        completionTokens: opts.tokens ? 16_000 : 0,
        totalTokens: opts.tokens ? 56_000 : 0,
        cacheHits: opts.cache ? 14 : 0,
        cacheReported: opts.cache ? 56 : 0,
      },
      previous: { spendUsd: 100, calls: 500, failed: 22 },
      costPer1kTokensUsd: opts.tokens ? 2.5 : null,
      failedPct: 5.9,
      failedBand: "red",
      cacheHitPct: opts.cache ? 25 : null,
    },
    breakdown: {
      model: breakdown([
        { id: "model:gpt-4o", name: "gpt-4o" },
        { id: "model:claude-sonnet", name: "claude-sonnet" },
      ]),
      application: breakdown([
        { id: "app:lineage-1", name: "Claims bot", lineageId: "lineage-1" },
        { id: "app:retired", name: "Keys no longer in use" },
      ]),
      team: breakdown([{ id: "team:none", name: "No team" }]),
      key: breakdown([
        { id: "key:lineage-1:2", name: "Claims bot (generation 2)" },
      ]),
    },
    budgets: {
      shown: [
        {
          lineageId: "lineage-1",
          name: "Claims bot",
          spentUsd: 120,
          budgetUsd: 100,
          budgetDuration: "30d",
          usedPct: 120,
          band: "red",
        },
      ],
      withBudget: 1,
      withoutBudget: 2,
    },
  };
}

function enabled(opts = { links: true, cache: true, tokens: true }) {
  h.result = { isPending: false, isError: false, data: summary(opts) };
}

describe("EYEON Cost and usage page (CHG-2026-143)", () => {
  beforeEach(() => enabled());

  it("says it is switched off and links to the LLM Gateway's Spend tab", () => {
    h.result = { isPending: false, isError: false, data: { enabled: false } };
    render(<EyeonSpendPage />);
    expect(screen.getByText(/is switched off on this deployment/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the LLM Gateway's Spend tab" }),
    ).toHaveAttribute("href", "/project/p1/acme-enhancements/llm-gateway");
  });

  it("answers the month with the run-rate, named as a straight line, and no project budget", () => {
    render(<EyeonSpendPage />);
    expect(
      screen.getByRole("heading", {
        name: "On pace to spend $855.60 in October.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/\$207\.00 spent by day 8 of 31 \(UTC\)/).textContent,
    ).toMatch(/A straight line, not a forecast\./);
    const budget = screen.getByText("Project budget").closest("div")!;
    expect(within(budget).getByText("Not recorded")).toBeTruthy();
    expect(screen.getAllByText("Calendar month, UTC").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByTitle(/Traffic that bypasses it is not seen/).textContent,
    ).toBe("Gateway traffic only");
    expect(
      screen.getAllByText("Within the expected lag").length,
    ).toBeGreaterThan(0);
  });

  it("shows the period's ribbon with the change and the reliability rating in words", () => {
    render(<EyeonSpendPage />);
    // In the Spend tile and in the chart's legend.
    expect(screen.getAllByText("$140.00")).toHaveLength(2);
    expect(screen.getByText("+40.0% on the previous 7 days")).toBeTruthy();
    expect(screen.getByText("+12.0% on the previous 7 days")).toBeTruthy();
    expect(screen.getByText("56K")).toBeTruthy();
    expect(screen.getByText("Act now: over 5% failed")).toBeTruthy();
    expect(screen.getAllByText("$2.50").length).toBeGreaterThan(0);
    expect(screen.getByText("25.0%")).toBeTruthy();
  });

  it("says Not recorded, not zero, where no tokens or cache field were reported", () => {
    enabled({ links: true, cache: false, tokens: false });
    render(<EyeonSpendPage />);
    const cache = screen.getByText("Cache-hit share").closest("div")!;
    expect(within(cache).getByText("Not recorded")).toBeTruthy();
    expect(within(cache).queryByText(/%/)).toBeNull();
    const cost = screen.getAllByText("Cost per 1K tokens")[0]!.closest("div")!;
    expect(within(cost).getByText("Not recorded")).toBeTruthy();
  });

  it("breaks spend down by model, then by application with a link for a role that may open it", () => {
    render(<EyeonSpendPage />);
    const group = screen.getByRole("group", { name: "Break spend down by" });
    expect(
      within(group).getByRole("button", { name: "Model" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
    fireEvent.click(within(group).getByRole("button", { name: "Application" }));
    expect(screen.getByRole("link", { name: "Claims bot" })).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/applications/lineage-1",
    );
    expect(screen.getAllByText("Keys no longer in use").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("gpt-4o")).toBeNull();
  });

  it("links no application, and no Gateway health, for a role that cannot open them", () => {
    enabled({ links: false, cache: true, tokens: true });
    render(<EyeonSpendPage />);
    const group = screen.getByRole("group", { name: "Break spend down by" });
    fireEvent.click(within(group).getByRole("button", { name: "Application" }));
    expect(screen.queryByRole("link", { name: "Claims bot" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "See what is failing" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open Applications" }),
    ).toBeNull();
  });

  it("rates each key budget in words and says the reset time is not recorded", () => {
    render(<EyeonSpendPage />);
    const list = screen.getByRole("list", { name: "Key budgets" });
    expect(within(list).getByText("Act now")).toBeTruthy();
    expect(within(list).getByText("Resets every 30 days")).toBeTruthy();
    expect(
      within(list).getByText(/\$120\.00 of \$100\.00 \(over\)/),
    ).toBeTruthy();
    expect(screen.getByText(/2 applications have no budget set/)).toBeTruthy();
    expect(
      screen.getByText(/Spend since each key's last reset/).textContent,
    ).toMatch(/Not recorded/);
  });

  it("lists what is not recorded, never as a number", () => {
    render(<EyeonSpendPage />);
    const list = screen.getByText("A project budget").closest("ul")!;
    expect(within(list).getAllByText("Not recorded")).toHaveLength(4);
    expect(list.textContent).not.toMatch(/\d/);
  });

  it("says so when the request log is off, rather than showing zeros", () => {
    h.result = {
      isPending: false,
      isError: false,
      data: {
        ...summary({ links: true, cache: true, tokens: true }),
        requestLog: false,
        mirror: null,
        month: null,
        period: null,
        breakdown: null,
        budgets: null,
      },
    };
    render(<EyeonSpendPage />);
    expect(
      screen.getByText(/EYEON holds no record of gateway spend to show/),
    ).toBeTruthy();
    expect(screen.queryByText("Where the money goes")).toBeNull();
  });
});
