import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { EyeonFlow } from "@/src/features/acme-enhancements/components/eyeon/EyeonFlow";
import { EyeonStackedBars } from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";

// CHG-2026-137 (ADR-0027): the EYEON flow chart and the stacked bars' own
// legend values. Every node is named in words with its value and share, the
// chart has an accessible name, a hover title on each node and ribbon, and
// a table view; with a handler, each node is a button.

const nodes = [
  {
    id: "checks",
    column: 0,
    name: "Checks",
    value: 100,
    tone: "neutral" as const,
  },
  {
    id: "prompts",
    column: 1,
    name: "Prompts",
    value: 90,
    tone: "neutral" as const,
  },
  {
    id: "answers",
    column: 1,
    name: "Answers",
    value: 10,
    tone: "neutral" as const,
  },
  {
    id: "block",
    column: 2,
    name: "Block verdict",
    value: 4,
    tone: "block" as const,
  },
  {
    id: "allow",
    column: 2,
    name: "Allowed",
    value: 96,
    tone: "allow" as const,
  },
  {
    id: "wouldBlock",
    column: 3,
    name: "Would block",
    value: 4,
    tone: "block" as const,
    muted: true,
    selected: true,
  },
  {
    id: "blocked",
    column: 3,
    name: "Blocked",
    value: 0,
    tone: "block" as const,
  },
];
const links = [
  { source: "checks", target: "prompts", value: 90 },
  { source: "checks", target: "answers", value: 10 },
  { source: "prompts", target: "block", value: 4 },
  { source: "prompts", target: "allow", value: 86 },
  { source: "answers", target: "allow", value: 10 },
  { source: "block", target: "wouldBlock", value: 4 },
  { source: "block", target: "blocked", value: 0 },
];
const columns = ["Checks", "Direction", "Verdict", "Applied or recorded"];

describe("EyeonFlow", () => {
  it("is an image with the caller's accessible name, a title on every node and ribbon, and no zero node drawn", () => {
    const { container } = render(
      <EyeonFlow
        label="Decision flow: 100 checks; 4 would block."
        columns={columns}
        nodes={nodes}
        links={links}
        total={100}
        totalName="checks"
        tableCaption="Decision flow"
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Decision flow: 100 checks; 4 would block.",
      }),
    ).toBeInTheDocument();
    const titles = [...container.querySelectorAll("svg title")].map(
      (t) => t.textContent,
    );
    expect(titles).toContain("Would block: 4, 4% of checks");
    expect(titles).toContain("Prompts to Block verdict: 4, 4% of checks");
    // "Blocked" has no value: not drawn, and no ribbon to it.
    expect(titles.some((t) => t?.startsWith("Blocked"))).toBe(false);
    expect(titles.some((t) => t?.includes("to Blocked"))).toBe(false);
    // Every drawn node is named in words beside its bar.
    // Testing Library's queries are typed for HTML elements; an SVG root
    // behaves the same for these text and role queries.
    const svg = container.querySelector("svg") as unknown as HTMLElement;
    for (const name of [
      "Checks",
      "Prompts",
      "Answers",
      "Allowed",
      "Would block",
    ])
      expect(within(svg).getAllByText(name).length).toBeGreaterThan(0);
    expect(within(svg).getAllByText("4 · 4%")).toHaveLength(2);
    expect(within(svg).getByText("90 · 90%")).toBeInTheDocument();
    // A recorded-only step is drawn lighter, never hidden.
    const muted = [...svg.querySelectorAll("rect")].filter(
      (r) => r.getAttribute("fill-opacity") === "0.4",
    );
    expect(muted).toHaveLength(1);
    expect(within(svg).queryAllByRole("button")).toHaveLength(0);
  });

  // CHG-2026-137 follow-up (owner, 2026-10-08: "decision flow chart is too
  // large.. reduce it to medium"): drawn at its natural size, one unit to
  // one pixel, so its text is never enlarged on a wide screen.
  it("is drawn at its natural size, centred, and scrolls where the card is narrower", () => {
    const { container } = render(
      <EyeonFlow
        label="Decision flow"
        columns={columns}
        nodes={nodes}
        links={links}
        total={100}
        totalName="checks"
        tableCaption="Decision flow"
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 720 288");
    expect(svg).toHaveAttribute("width", "720");
    expect(svg).toHaveAttribute("height", "288");
    const classes = svg.getAttribute("class") ?? "";
    expect(classes).not.toMatch(/\bw-full\b|\bh-auto\b|min-w-/);
    expect(classes).toMatch(/\bmx-auto\b/);
    expect(svg.parentElement?.getAttribute("class")).toMatch(
      /\boverflow-x-auto\b/,
    );
    // Every label is anchored inside the drawing (jsdom measures no text, so
    // this checks the anchors only, not the labels' widths).
    for (const text of svg.querySelectorAll("text")) {
      const x = Number(text.getAttribute("x"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(720);
    }
  });

  it("has a table view with every step, its count and share", () => {
    render(
      <EyeonFlow
        label="Decision flow"
        columns={columns}
        nodes={nodes}
        links={links}
        total={100}
        totalName="checks"
        tableCaption="Decision flow, last 7 days"
      />,
    );
    expect(screen.getByText("Show as table")).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Decision flow, last 7 days",
    });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(nodes.length + 1);
    expect(rows[0]?.textContent).toBe("StageStepCountShare of checks");
    expect(rows[7]?.textContent).toBe("Applied or recordedBlocked00%");
    expect(rows[2]?.textContent).toBe("DirectionPrompts9090%");
  });

  it("makes each node a button that selects it, by click or keyboard", () => {
    const onSelect = vi.fn();
    render(
      <EyeonFlow
        label="Decision flow"
        columns={columns}
        nodes={nodes}
        links={links}
        total={100}
        totalName="checks"
        tableCaption="Decision flow"
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByRole("group", { name: "Decision flow" }),
    ).toBeInTheDocument();
    const prompts = screen.getByRole("button", {
      name: "Prompts: 90, 90% of checks. Press to filter the page.",
    });
    expect(prompts).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(prompts);
    expect(onSelect).toHaveBeenLastCalledWith("prompts");
    const selected = screen.getByRole("button", {
      name: "Would block: 4, 4% of checks. Selected; press to clear.",
    });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(selected, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("wouldBlock");
    fireEvent.keyDown(selected, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});

describe("EyeonStackedBars legend values (CHG-2026-137)", () => {
  it("states the caller's values in the legend and the accessible name, where a sum means nothing", () => {
    render(
      <EyeonStackedBars
        label="Interventions per 100 checks per UTC day"
        series={[
          { name: "Blocked", tone: "block" },
          { name: "Would block", tone: "block", muted: true },
        ]}
        points={[
          { label: "2026-10-01", values: [1.5, 0.5] },
          { label: "2026-10-02", values: [2, 0] },
        ]}
        legendValues={["1.7 per 100", "0.3 per 100"]}
      />,
    );
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toBe(
      "Blocked1.7 per 100Would block0.3 per 100",
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Interventions per 100 checks per UTC day, 2 bars from 2026-10-01 to 2026-10-02: Blocked 1.7 per 100, Would block 0.3 per 100; at most 2 in one bar.",
    );
  });
});
