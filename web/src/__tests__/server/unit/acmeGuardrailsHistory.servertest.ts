import { describe, expect, it } from "vitest";
import {
  buildHiddenTestTrafficWhere,
  buildHistoryWhere,
  GuardrailHistoryFilterSchema,
  TEST_TRAFFIC_AGENT_PREFIXES,
} from "@/src/features/acme-enhancements/server/acmeGuardrailsHistory";

// The guardrail history list and its CSV export share one `where` builder, so
// what a viewer sees on screen is exactly what they export (ADR-0013).

const filter = (input: unknown) => GuardrailHistoryFilterSchema.parse(input);

describe("guardrail history filter", () => {
  it("always scopes to the project, with no other condition by default", () => {
    expect(buildHistoryWhere("p1", filter({}))).toEqual({
      projectId: "p1",
      AND: [],
    });
  });

  it("shows test traffic unless the viewer hides it", () => {
    // Agent names are caller-asserted: hiding by default would let a caller
    // keep events out of the default view by choosing such a name.
    expect(filter({}).hideTestTraffic).toBe(false);
    expect(buildHiddenTestTrafficWhere("p1", filter({}))).toBeNull();
  });

  it("maps every filter to its column", () => {
    const from = new Date("2026-09-16T00:00:00Z");
    const to = new Date("2026-09-25T00:00:00Z");
    expect(
      buildHistoryWhere(
        "p1",
        filter({
          from,
          to,
          actions: ["block", "redact"],
          direction: "input",
          agent: " gateway ",
          user: "anees",
        }),
      ),
    ).toEqual({
      projectId: "p1",
      AND: [
        { eventTime: { gte: from, lt: to } },
        { action: { in: ["BLOCK", "REDACT"] } },
        { direction: "INPUT" },
        { agentId: { contains: "gateway", mode: "insensitive" } },
        { userId: { contains: "anees", mode: "insensitive" } },
      ],
    });
  });

  it("an open-ended date range sets only the bound given", () => {
    const from = new Date("2026-09-20T00:00:00Z");
    expect(buildHistoryWhere("p1", filter({ from })).AND).toEqual([
      { eventTime: { gte: from } },
    ]);
  });

  it("hiding test traffic excludes every test agent prefix, and the hidden count selects exactly those", () => {
    const hidden = filter({ hideTestTraffic: true, actions: ["block"] });
    const testTraffic = {
      OR: TEST_TRAFFIC_AGENT_PREFIXES.map((prefix) => ({
        agentId: { startsWith: prefix },
      })),
    };
    expect(buildHistoryWhere("p1", hidden)).toEqual({
      projectId: "p1",
      AND: [{ action: { in: ["BLOCK"] } }, { NOT: testTraffic }],
    });
    expect(buildHiddenTestTrafficWhere("p1", hidden)).toEqual({
      projectId: "p1",
      AND: [{ action: { in: ["BLOCK"] } }, testTraffic],
    });
  });

  it("rejects oversized free-text filters", () => {
    expect(() => filter({ agent: "x".repeat(201) })).toThrow();
  });
});
