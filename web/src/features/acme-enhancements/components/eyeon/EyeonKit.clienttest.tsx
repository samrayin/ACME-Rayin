import { render, screen } from "@testing-library/react";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import {
  EyeonDecisionChip,
  EyeonModeChip,
  EyeonRatingChip,
  ratingFromBand,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import {
  EyeonBarList,
  EyeonBullet,
  EyeonChartTable,
  EyeonRing,
  EyeonSparkline,
  EyeonStackBar,
  EyeonStackedBars,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import { EyeonCard } from "@/src/features/acme-enhancements/components/eyeon/EyeonCard";

// CHG-2026-132 (ADR-0027): the EYEON kit. The honest states are part of the
// figure, so an unmeasured figure cannot render as a number; chips name the
// mode and decision in words; every chart has a text alternative.

describe("EyeonKpiTile", () => {
  it("shows Not recorded, with its reason, and no number", () => {
    const { container } = render(
      <EyeonKpiTile
        label="Guardrail latency"
        figure={{
          state: "notRecorded",
          reason: "EYEON does not store it.",
        }}
        subtitle="Added by the guardrail"
      />,
    );
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByTitle("EYEON does not store it.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("tags a preview figure", () => {
    render(
      <EyeonKpiTile
        label="Entity types"
        figure={{ state: "preview", value: "12", reason: "Not built yet." }}
        subtitle="Personal-data types"
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("opens the page behind the figure, and says a status in words", () => {
    render(
      <EyeonKpiTile
        label="Guardrail checks"
        figure={{ state: "measured", value: "1,234" }}
        subtitle="Prompts and answers, last 7 days"
        delta={{ text: "Below the 1.00% alert", tone: "good" }}
        href="/project/p/acme-enhancements/guardrails"
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/project/p/acme-enhancements/guardrails",
    );
    expect(screen.getByText("Below the 1.00% alert")).toBeInTheDocument();
    expect(
      screen.getByTitle("Prompts and answers, last 7 days"),
    ).toBeInTheDocument();
  });
});

describe("EYEON chips", () => {
  it("names the mode with its ceiling, and Not reported without one", () => {
    const { rerender } = render(
      <EyeonModeChip mode="enforce" ceiling="enforce" />,
    );
    expect(screen.getByText("Enforce mode")).toBeInTheDocument();
    rerender(<EyeonModeChip mode={null} ceiling="record" />);
    expect(screen.getByText("Not reported")).toBeInTheDocument();
    expect(screen.getByText("Record")).toBeInTheDocument();
  });

  it("says Blocked only where the gateway enforced", () => {
    const { rerender } = render(
      <EyeonDecisionChip action="block" mode="enforce" />,
    );
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    rerender(<EyeonDecisionChip action="block" mode="record" />);
    expect(screen.getByText("Would block")).toBeInTheDocument();
    rerender(<EyeonDecisionChip action="redact" mode="record" long />);
    expect(screen.getByText("Would redact (record mode)")).toBeInTheDocument();
    rerender(<EyeonDecisionChip action="unavailable" mode={null} long />);
    expect(screen.getByText("No verdict")).toBeInTheDocument();
  });

  it("shows a scorecard band as its rating, with a count", () => {
    expect(ratingFromBand("red")).toBe("actnow");
    expect(ratingFromBand("amber")).toBe("watch");
    expect(ratingFromBand("green")).toBe("ontrack");
    expect(ratingFromBand("none")).toBe("notrated");
    render(<EyeonRatingChip rating="actnow" count={3} />);
    expect(screen.getByText("Act now")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("EYEON charts", () => {
  it("give every chart an accessible name that states the figures", () => {
    render(
      <>
        <EyeonSparkline
          label="Checks per UTC day"
          points={[
            { label: "2026-10-01", value: 4 },
            { label: "2026-10-02", value: 6 },
          ]}
        />
        <EyeonRing
          label="40% of checks decided in enforce mode."
          fraction={0.4}
          centerText="40%"
        />
        <EyeonBullet
          label="Claims bot"
          value={12}
          target={10}
          valueText="$12.00"
          targetText="$10.00 per 30 days"
          tone="block"
        />
      </>,
    );
    const names = screen
      .getAllByRole("img")
      .map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual([
      "Checks per UTC day, 2 points from 2026-10-01 to 2026-10-02: 10 in total, at most 6.",
      "40% of checks decided in enforce mode.",
      "Claims bot: $12.00 against $10.00 per 30 days, over the target.",
    ]);
  });

  // CHG-2026-137 follow-up: a share per day, where a sum means nothing and a
  // day without a base has no value.
  it("states a rate's range, not a total, and names a point without a value", () => {
    const { container } = render(
      <EyeonSparkline
        label="Share decided in enforce mode per UTC day"
        points={[
          { label: "2026-10-01", value: 0 },
          { label: "2026-10-02", value: null },
          { label: "2026-10-03", value: 87.5 },
        ]}
        rate={{
          format: (v) => `${Math.round(v)}%`,
          max: 100,
          missing: "no checks",
        }}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Share decided in enforce mode per UTC day, 3 points from 2026-10-01 to 2026-10-03: 2 with a value, from 0% to 88%.",
    );
    expect(
      [...container.querySelectorAll("title")].map((t) => t.textContent),
    ).toEqual(["2026-10-01: 0%", "2026-10-02: no checks", "2026-10-03: 88%"]);
    // The line breaks at the gap; 87.5 sits below the top, on a 0..100 scale.
    const line = container.querySelectorAll("path")[1]!.getAttribute("d");
    // A value alone between gaps is a short flat stroke, a quarter step wide
    // to each side, kept inside the box.
    expect(line).toBe("M0 30 L15 30 M105 5.5 L120 5.5");
  });

  it("says when a rate has no value at all, and draws nothing", () => {
    const { container } = render(
      <EyeonSparkline
        label="No verdict per 100 checks"
        points={[
          { label: "2026-10-01", value: null },
          { label: "2026-10-02", value: null },
        ]}
        rate={{ format: (v) => `${v}%`, missing: "no checks" }}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "No verdict per 100 checks, 2 points from 2026-10-01 to 2026-10-02: none with a value (no checks).",
    );
    expect(
      [...container.querySelectorAll("path")].map((p) => p.getAttribute("d")),
    ).toEqual(["", ""]);
  });

  it("draws an empty ring for a share that does not exist", () => {
    const { container } = render(
      <EyeonRing label="No checks." fraction={null} centerText="No checks" />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(0);
    expect(screen.getByText("No checks")).toBeInTheDocument();
  });

  it("offers a chart's numbers as a table", () => {
    render(
      <EyeonChartTable
        caption="Checks per day"
        columns={["Day", "Checks"]}
        rows={[{ key: "2026-10-01", cells: ["2026-10-01", 1200] }]}
      />,
    );
    expect(screen.getByText("Show as table")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Checks per day" }),
    ).toBeInTheDocument();
    expect(screen.getByText((1200).toLocaleString())).toBeInTheDocument();
  });
});

describe("EyeonCard", () => {
  it("has a title, one line on what it tells, and a link to the deeper page", () => {
    render(
      <EyeonCard
        title="Enforcement"
        subtitle="The guardrail mode now."
        link={{
          href: "/project/p/acme-enhancements/guardrails",
          label: "Open Guardrails",
        }}
        footnote="Gateway traffic only"
      >
        <span>body</span>
      </EyeonCard>,
    );
    expect(screen.getByText("Enforcement")).toBeInTheDocument();
    expect(screen.getByText("The guardrail mode now.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Guardrails" }),
    ).toHaveAttribute("href", "/project/p/acme-enhancements/guardrails");
    expect(screen.getByText("Gateway traffic only")).toBeInTheDocument();
  });
});

// CHG-2026-133 (ADR-0027): the stacked bars and the bar list, for the
// Guardrail decisions page. Every colour comes with words: a legend with
// totals, or the value written beside the bar; "Would block" is named apart
// from "Blocked"; every chart has an accessible name that states its figures.

describe("EyeonStackedBars", () => {
  const series = [
    { name: "Blocked", tone: "block" as const },
    { name: "Would block", tone: "block" as const, muted: true },
    { name: "No verdict", tone: "neutral" as const },
  ];

  it("names its figures, draws one segment per non-zero value, and titles each bar", () => {
    const { container } = render(
      <EyeonStackedBars
        label="Interventions per UTC day"
        series={series}
        points={[
          { label: "2026-10-01", values: [2, 1, 0] },
          { label: "2026-10-02", values: [0, 3, 1] },
        ]}
      />,
    );
    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute(
      "aria-label",
      "Interventions per UTC day, 2 bars from 2026-10-01 to 2026-10-02: Blocked 2, Would block 4, No verdict 1; at most 4 in one bar.",
    );
    const filled = chart.querySelectorAll('rect[fill="currentColor"]');
    expect(filled).toHaveLength(4);
    const muted = [...filled].filter(
      (r) => r.getAttribute("fill-opacity") === "0.4",
    );
    expect(muted).toHaveLength(2);
    expect(
      [...container.querySelectorAll("title")].map((t) => t.textContent),
    ).toEqual([
      "2026-10-01: Blocked 2, Would block 1, No verdict 0",
      "2026-10-02: Blocked 0, Would block 3, No verdict 1",
    ]);
  });

  it("has a legend that names every series with its total", () => {
    render(
      <EyeonStackedBars
        label="Interventions per UTC day"
        series={series}
        points={[{ label: "2026-10-01", values: [2, 5, 0] }]}
      />,
    );
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend.textContent).toBe("Blocked2Would block5No verdict0");
  });

  it("says when there is no data", () => {
    render(
      <EyeonStackedBars label="Interventions" series={series} points={[]} />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Interventions: no data.",
    );
  });

  // CHG-2026-137 follow-up: a card's main chart, and an honest empty state.
  it("draws a card's main chart tall and full width, with its scale written around it", () => {
    const { container } = render(
      <EyeonStackedBars
        label="Interventions per UTC day"
        series={series}
        points={[
          { label: "2026-10-01", values: [2, 1, 0] },
          { label: "2026-10-02", values: [0, 3, 1] },
        ]}
        size="lg"
      />,
    );
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("class")).toMatch(/\bh-56\b/);
    expect(chart).toHaveAttribute("viewBox", "0 0 300 224");
    expect(chart.getAttribute("class")).toMatch(/\bw-full\b/);
    // The top of the scale (a dashed line, its value above the plot) and
    // the first and last day: hidden from the accessible name, which states
    // the figures already.
    expect(chart.querySelectorAll('line[stroke-dasharray="4 4"]')).toHaveLength(
      1,
    );
    const scale = [...container.querySelectorAll('[aria-hidden="true"]')]
      .filter((el) => el.tagName.toLowerCase() !== "svg")
      .map((el) => [...el.childNodes].map((n) => n.textContent));
    expect(scale).toEqual([["4"], ["2026-10-01", "2026-10-02"]]);
  });

  it("says so, in place of an empty plot, when every value is zero", () => {
    render(
      <EyeonStackedBars
        label="Interventions per UTC day"
        series={series}
        points={[{ label: "2026-10-01", values: [0, 0, 0] }]}
        size="lg"
        emptyText="No interventions in this view."
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByText("No interventions in this view."),
    ).toBeInTheDocument();
    // The legend still names what was counted.
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toBe(
      "Blocked0Would block0No verdict0",
    );
  });
});

describe("EyeonStackBar (CHG-2026-137 follow-up)", () => {
  it("is one named bar of segments, on the caller's scale", () => {
    render(
      <EyeonStackBar
        title="Personal data on prompts"
        segments={[
          { name: "Redacted", value: 2, tone: "redact" },
          { name: "Would redact", value: 3, tone: "redact", muted: true },
        ]}
        max={10}
      />,
    );
    const bar = screen.getByRole("img", {
      name: "Personal data on prompts: Redacted 2, Would redact 3.",
    });
    expect(
      [...bar.querySelectorAll('rect[fill="currentColor"]')].map((r) => [
        r.getAttribute("x"),
        r.getAttribute("width"),
        r.getAttribute("fill-opacity"),
      ]),
    ).toEqual([
      ["0", "40", "1"],
      ["40", "60", "0.4"],
    ]);
  });
});

describe("EyeonBarList", () => {
  it("writes each item's figures beside a named bar, on one scale", () => {
    const { container } = render(
      <EyeonBarList
        label="Refusals by policy label"
        items={[
          {
            key: "jailbreak",
            name: "Jailbreak or misuse",
            title: "Jailbreak or misuse",
            valueText: "6 · 4 blocked, 2 would block",
            segments: [
              { name: "Blocked", value: 4, tone: "block" },
              { name: "Would block", value: 2, tone: "block", muted: true },
            ],
            note: <span>6 prompts refused</span>,
          },
          {
            key: "other",
            name: <a href="/x">Other</a>,
            title: "Other",
            valueText: "3 · 3 would block",
            segments: [
              { name: "Blocked", value: 0, tone: "block" },
              { name: "Would block", value: 3, tone: "block", muted: true },
            ],
          },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Refusals by policy label" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(
      screen.getAllByRole("img").map((el) => el.getAttribute("aria-label")),
    ).toEqual([
      "Jailbreak or misuse: Blocked 4, Would block 2.",
      "Other: Blocked 0, Would block 3.",
    ]);
    expect(
      screen.getByText("6 · 4 blocked, 2 would block"),
    ).toBeInTheDocument();
    expect(screen.getByText("6 prompts refused")).toBeInTheDocument();
    expect(screen.getByTitle("Jailbreak or misuse")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Other" })).toBeInTheDocument();
    // The larger item fills its row; the smaller one half of it.
    const widths = [
      ...container.querySelectorAll('rect[fill="currentColor"]'),
    ].map((r) => Number(r.getAttribute("width")));
    expect(widths.map((w) => Math.round(w))).toEqual([133, 67, 100]);
  });
});
