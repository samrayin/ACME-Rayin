import { render, screen } from "@testing-library/react";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import {
  EyeonDecisionChip,
  EyeonModeChip,
  EyeonRatingChip,
  ratingFromBand,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import {
  EyeonBullet,
  EyeonChartTable,
  EyeonRing,
  EyeonSparkline,
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
