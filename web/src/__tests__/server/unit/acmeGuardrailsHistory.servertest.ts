import { describe, expect, it } from "vitest";
import { AcmeGuardrailEventAction } from "@langfuse/shared/src/db";
import {
  buildHiddenTestTrafficWhere,
  buildHistoryWhere,
  countHistoryVerdicts,
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

  // CHG-2026-125 (ADR-0023 §3.5): an application's keys, exactly.
  it("matches the agent exactly against a list, beside the other filters", () => {
    const from = new Date("2026-09-20T00:00:00Z");
    expect(
      buildHistoryWhere(
        "p1",
        filter({
          from,
          agents: [" cairo-hr-bot-1a2b3c4d ", "cairo-hr-bot-1a2b3c4d-r2"],
          hideTestTraffic: true,
        }),
      ),
    ).toEqual({
      projectId: "p1",
      AND: [
        { eventTime: { gte: from } },
        {
          agentId: {
            in: ["cairo-hr-bot-1a2b3c4d", "cairo-hr-bot-1a2b3c4d-r2"],
          },
        },
        {
          NOT: {
            OR: TEST_TRAFFIC_AGENT_PREFIXES.map((prefix) => ({
              agentId: { startsWith: prefix },
            })),
          },
        },
      ],
    });
  });

  it("leaves every other filter as it was when no agent list is given", () => {
    const parsed = filter({ agent: "gateway" });
    expect(parsed.agents).toBeUndefined();
    expect(buildHistoryWhere("p1", parsed).AND).toEqual([
      { agentId: { contains: "gateway", mode: "insensitive" } },
    ]);
  });

  it("caps the agent list and each agent's length, and refuses an empty one", () => {
    expect(() => filter({ agents: [] })).toThrow();
    expect(() => filter({ agents: ["  "] })).toThrow();
    expect(() => filter({ agents: ["x".repeat(201)] })).toThrow();
    expect(() =>
      filter({ agents: Array.from({ length: 21 }, (_, i) => `a${i}`) }),
    ).toThrow();
    expect(
      filter({ agents: Array.from({ length: 20 }, (_, i) => `a${i}`) }).agents,
    ).toHaveLength(20);
  });
});

describe("guardrail history counts (CHG-2026-116)", () => {
  it("splits block and redact verdicts by whether the gateway enforced them", () => {
    const g = (
      action: AcmeGuardrailEventAction,
      gatewayMode: string | null,
      n: number,
    ) => ({ action, gatewayMode, _count: { _all: n } });
    expect(
      countHistoryVerdicts([
        g(AcmeGuardrailEventAction.BLOCK, "enforce", 2),
        g(AcmeGuardrailEventAction.BLOCK, "record", 5),
        g(AcmeGuardrailEventAction.BLOCK, null, 1),
        g(AcmeGuardrailEventAction.REDACT, "enforce", 3),
        g(AcmeGuardrailEventAction.REDACT, null, 4),
        g(AcmeGuardrailEventAction.ALLOW, "enforce", 10),
        g(AcmeGuardrailEventAction.ALLOW, null, 6),
        g(AcmeGuardrailEventAction.UNAVAILABLE, "enforce", 1),
      ]),
    ).toEqual({
      total: 32,
      blocked: 8,
      blockedEnforced: 2,
      redacted: 7,
      redactedEnforced: 3,
      allowed: 16,
      unavailable: 1,
    });
  });
});
