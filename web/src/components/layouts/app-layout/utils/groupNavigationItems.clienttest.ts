import { describe, expect, it } from "vitest";
import { RouteGroup, RouteSection } from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { groupNavigationItems } from "./groupNavigationItems";

const item = (title: string, group?: RouteGroup): NavigationItem =>
  ({
    title,
    pathname: `/${title}`,
    url: `/${title}`,
    isActive: false,
    section: RouteSection.Main,
    group,
  }) as NavigationItem;

describe("groupNavigationItems (CHG-2026-081)", () => {
  // Listed out of order on purpose: the section order must not depend on it.
  const items = [
    item("Home"),
    item("UI Customization", RouteGroup.Settings),
    item("Logs", RouteGroup.ReportsLogs),
    item("Support", RouteGroup.Support),
    item("Prompts", RouteGroup.PromptManagement),
    item("Scores", RouteGroup.Evaluation),
    item("Tracing", RouteGroup.Observability),
    item("Guardrails", RouteGroup.GovernanceControls),
  ];

  it("orders sections as the owner set them, whatever the route order", () => {
    const { grouped } = groupNavigationItems(items);
    expect(Object.keys(grouped ?? {})).toEqual([
      "Governance Controls",
      "Observability",
      "Evaluation",
      "Prompt Management",
      "Reports / Logs",
      "Settings",
      "Support",
    ]);
  });

  it("the flattened list (the Ctrl K menu) covers every section, in order", () => {
    const { flattened } = groupNavigationItems(items);
    expect(flattened.map((i) => i.title)).toEqual([
      "Home",
      "Guardrails",
      "Tracing",
      "Scores",
      "Prompts",
      "Logs",
      "UI Customization",
      "Support",
    ]);
  });

  it("leaves out sections with nothing visible", () => {
    const { grouped } = groupNavigationItems([
      item("Home"),
      item("Logs", RouteGroup.ReportsLogs),
    ]);
    expect(Object.keys(grouped ?? {})).toEqual(["Reports / Logs"]);
    expect(groupNavigationItems([item("Home")]).grouped).toBeNull();
  });
});
