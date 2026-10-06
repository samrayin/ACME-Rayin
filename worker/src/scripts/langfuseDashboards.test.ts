import { describe, expect, it } from "vitest";
import langfuseDashboards from "../constants/langfuse-dashboards.json";

describe("langfuse template dashboards", () => {
  it("ranks Top 20 Called Tools by per-tool invocations, not observation count", () => {
    const widget = langfuseDashboards.widgets.find(
      (entry) => entry.name === "Top 20 Called Tools",
    );

    expect(widget).toMatchObject({
      view: "OBSERVATIONS",
      dimensions: [{ field: "calledToolNames" }],
      metrics: [{ agg: "sum", measure: "toolCallInvocations" }],
    });
    expect(widget?.description).not.toMatch(/observations that called/i);
  });
});

// CHG-2026-085 d / ADR-0019 §13: the built-in dashboards carry the product name,
// EYEON since CHG-2026-121 (it was CAIRO).
// (The Home dashboard lives in @langfuse/shared and is checked there.)
describe("built-in dashboard names", () => {
  it("names every template dashboard EYEON, never CAIRO, RayIn or Langfuse", () => {
    expect(langfuseDashboards.dashboards.map((d) => d.name).sort()).toEqual([
      "EYEON Agent Dashboard",
      "EYEON Cost Dashboard",
      "EYEON Latency Dashboard",
      "EYEON Usage Management",
    ]);
  });

  it("bumps updatedAt with the rename, so the worker upsert rewrites the rows", () => {
    // The upsert skips a row whose stored updatedAt equals this one.
    for (const dashboard of langfuseDashboards.dashboards) {
      expect(new Date(dashboard.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date("2026-10-06T00:00:00.000Z").getTime(),
      );
    }
  });
});
