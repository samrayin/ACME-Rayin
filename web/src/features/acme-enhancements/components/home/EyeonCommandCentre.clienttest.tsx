import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { EyeonCommandCentre } from "@/src/features/acme-enhancements/components/home/EyeonCommandCentre";
import {
  FIXTURE_NOW,
  commandCentreFixture,
} from "@/src/features/acme-enhancements/components/home/eyeonCommandCentre.fixtures";
import { type CommandCentreInput } from "@/src/features/acme-enhancements/utils/eyeonCommandCentre";
import { COMMAND_WIDGETS } from "@/src/features/acme-enhancements/utils/eyeonCommandLayout";

// CHG-2026-147 (ADR-0030): the command centre on fixed figures. The briefing
// and the attention queue link to the pages that show the evidence; a role
// without Spend sees no spend figure anywhere; a source that is loading, off
// or failed says so in its widget; and each person can move, resize, hide
// and show widgets, kept in this browser under their own key.

const KEY = "cairo.eyeonCommandCentre.v1:u1:project-1";

function renderCentre(input: CommandCentreInput = commandCentreFixture()) {
  return render(
    <EyeonCommandCentre
      input={input}
      userId="u1"
      viewerName="Sam Rayin"
      now={new Date(FIXTURE_NOW)}
      onWindowDaysChange={() => undefined}
    />,
  );
}

function groupNames(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="group"][aria-label]'),
  ).map((g) => g.getAttribute("aria-label") ?? "");
}

function arrange() {
  fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("what a leader sees first", () => {
  it("briefs in sentences, with the mode and the rings", () => {
    renderCentre();
    const briefing = screen.getByRole("region", { name: "Briefing" });
    expect(
      within(briefing).getByRole("heading", {
        name: "4 things need your attention.",
      }),
    ).toBeInTheDocument();
    expect(briefing).toHaveTextContent(
      "4,200 AI calls from 4 applications went through the gateway in the last 7 days.",
    );
    expect(briefing).toHaveTextContent("Record mode");
    const rings = within(briefing).getByRole("list", { name: "Posture rings" });
    expect(within(rings).getAllByRole("img")).toHaveLength(3);
  });

  it("lists what needs attention, each with the page that shows it", () => {
    renderCentre();
    const queue = screen.getByRole("list", { name: "Needs your attention" });
    const items = within(queue).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent(
      "Act now: 40 risky prompts and answers not stopped",
    );
    expect(
      within(items[0]!).getByRole("link", { name: /Review enforcement/ }),
    ).toHaveAttribute(
      "href",
      "/project/project-1/acme-enhancements/enforcement",
    );
  });

  it("shows the headline figures, each opening its page", () => {
    renderCentre();
    const strip = screen.getByRole("region", { name: "Headline figures" });
    expect(within(strip).getAllByRole("link")).toHaveLength(6);
    expect(strip).toHaveTextContent("Spend this month");
    expect(strip).toHaveTextContent("$42.50");
    expect(strip).toHaveTextContent("40 let through");
  });
});

describe("each role sees only what its pages show", () => {
  it("a role without Spend gets no spend figure, widget or hidden entry", () => {
    renderCentre(commandCentreFixture({ spend: { state: "noAccess" } }));
    expect(document.body).not.toHaveTextContent("$");
    expect(groupNames()).toEqual([]);
    arrange();
    const names = groupNames();
    expect(names).not.toContain("Spend this month");
    expect(names).not.toContain("Closest to budget");
    expect(names).not.toContain("Model mix");
    // Adoption still shows, from Gateway health.
    expect(names).toContain("AI adoption");
    expect(screen.getByText("Nothing is hidden.")).toBeInTheDocument();
  });

  it("a role without the guardrail pages gets no policy or integrity widget", () => {
    renderCentre(
      commandCentreFixture({
        decisions: { state: "noAccess" },
        enforcement: { state: "noAccess" },
      }),
    );
    arrange();
    expect(groupNames()).not.toContain("What the guardrails caught");
    expect(groupNames()).not.toContain("Control integrity");
  });
});

describe("honest states", () => {
  it("says a widget is loading, switched off or failed instead of showing zeros", () => {
    renderCentre(
      commandCentreFixture({
        spend: {
          state: "off",
          reason:
            "The gateway's request log is switched off, so calls and spend are not recorded.",
        },
        decisions: { state: "loading" },
        enforcement: { state: "error", message: "timeout" },
      }),
    );
    expect(
      screen.getAllByText(
        "The gateway's request log is switched off, so calls and spend are not recorded.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(screen.getByText("Could not load: timeout")).toBeInTheDocument();
    expect(
      screen.getByText("Not checked here: control integrity."),
    ).toBeInTheDocument();
  });

  it("names what EYEON cannot see", () => {
    renderCentre();
    expect(
      screen.getByText("AI traffic that bypasses the gateway"),
    ).toBeInTheDocument();
  });
});

describe("arranging, for oneself", () => {
  it("moves a widget and keeps focus on it", () => {
    renderCentre();
    arrange();
    expect(groupNames().slice(0, 3)).toEqual([
      "Needs your attention",
      "Guardrail posture",
      "Risks stopped and let through",
    ]);
    const later = screen.getByRole("button", {
      name: "Move Needs your attention later",
    });
    later.focus();
    fireEvent.click(later);
    expect(groupNames().slice(0, 2)).toEqual([
      "Guardrail posture",
      "Needs your attention",
    ]);
    expect(
      screen.getByRole("button", { name: "Move Needs your attention later" }),
    ).toHaveFocus();
    expect(
      screen.getByText("Needs your attention moved to place 2 of 13."),
    ).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(stored.lens).toBe("custom");
    expect(stored.widgets.order.slice(0, 2)).toEqual(["posture", "attention"]);
  });

  it("resizes a widget one step at a time", () => {
    renderCentre();
    arrange();
    const wider = screen.getByRole("button", {
      name: "Make Guardrail posture wider (now a third of the width)",
    });
    fireEvent.click(wider);
    expect(
      screen.getByText(
        "Guardrail posture now takes two thirds of the width on large screens.",
      ),
    ).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(stored.sizes).toEqual({ posture: 2 });
    expect(
      screen.getByRole("button", {
        name: "Make Guardrail posture narrower (now two thirds of the width)",
      }),
    ).toBeEnabled();
  });

  it("hides a widget, lists it, shows it again, and resets", () => {
    renderCentre();
    arrange();
    fireEvent.click(screen.getByRole("button", { name: "Hide Model mix" }));
    expect(groupNames()).not.toContain("Model mix");
    const hiddenList = screen.getByRole("list", { name: "Hidden widgets" });
    fireEvent.click(
      within(hiddenList).getByRole("button", { name: "Show Model mix" }),
    );
    expect(groupNames()).toContain("Model mix");
    fireEvent.click(screen.getByRole("button", { name: "Hide Model mix" }));
    fireEvent.click(screen.getByRole("button", { name: /Reset to default/ }));
    expect(groupNames()).toContain("Model mix");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("makes widget content inert while arranging", () => {
    const { container } = renderCentre();
    expect(container.querySelectorAll("[inert]")).toHaveLength(0);
    arrange();
    const group = screen.getByRole("group", { name: "Guardrail posture" });
    expect(
      within(group)
        .getByRole("link", { name: "Open enforcement", hidden: true })
        .closest("[inert]"),
    ).not.toBeNull();
  });

  it("reads back the person's arrangement", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        lens: "custom",
        widgets: {
          order: [
            "notRecorded",
            ...COMMAND_WIDGETS.filter((id) => id !== "notRecorded"),
          ],
          hidden: ["attention"],
        },
        sizes: {},
      }),
    );
    renderCentre();
    arrange();
    expect(groupNames()[0]).toBe("What EYEON cannot see");
    expect(groupNames()).not.toContain("Needs your attention");
  });
});
