import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonGatewayHealthPage from "@/src/features/acme-enhancements/pages/EyeonGatewayHealthPage";
import {
  EyeonMirrorChip,
  EyeonModelHealthChip,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonHealthChips";

// CHG-2026-139 (ADR-0027): the EYEON Gateway health page on fixed figures.
// Model health is point in time and says so; an unhealthy model gets its
// steps, read-only for a role that cannot act; what is not recorded says so;
// a failed call links to its application only where the server resolved
// one; the switched-off page points to the LLM Gateway.

const h = vi.hoisted(() => ({ result: {} as unknown }));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonGatewayHealth: {
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

const NOW = "2026-10-07T12:00:00.000Z";

function series() {
  return Array.from({ length: 28 }, (_, i) => {
    const start = new Date(
      Date.parse("2026-09-30T18:00:00.000Z") + i * 6 * 3_600_000,
    ).toISOString();
    return {
      start,
      label: `${start.slice(0, 10)} ${start.slice(11, 16)}`,
      calls: 20,
      failed: i === 27 ? 6 : 1,
    };
  });
}

function summary(opts: { canCheckHealth: boolean; latest: boolean }) {
  return {
    enabled: true as const,
    window: "7d",
    generatedAt: NOW,
    gatewayManagement: true,
    requestLog: true,
    canCheckHealth: opts.canCheckHealth,
    health: {
      checkedAt: "2026-10-07T11:57:00.000Z",
      fresh: true,
      cacheMinutes: 5,
      models: [
        {
          model: "claude-sonnet",
          providers: ["anthropic"],
          status: "unhealthy",
          cause: "keyOrCredit",
        },
        {
          model: "gemini-judge",
          providers: ["gemini"],
          status: "unknown",
          cause: null,
        },
        {
          model: "gpt-4o",
          providers: ["openai"],
          status: "healthy",
          cause: null,
        },
      ],
      counts: { total: 3, healthy: 1, unhealthy: 1, unknown: 1 },
      more: 0,
    },
    applications: 4,
    mirror: {
      state: "withinLag",
      expectedLagMinutes: 7,
      completeTo: "2026-10-07T11:55:00.000Z",
      lastReconciledAt: "2026-10-07T11:57:00.000Z",
      lastGapCount: 0,
      newestArrival: "2026-10-07T11:59:00.000Z",
    },
    failures: {
      from: "2026-09-30T18:00:00.000Z",
      bucketMinutes: 360,
      calls: 560,
      failed: 33,
      previous: { calls: 500, failed: 22 },
      limitRefusals: 9,
      series: series(),
      byModel: {
        shown: [
          {
            model: "claude-sonnet",
            calls: 300,
            failed: 30,
            band: "red",
            p50Ms: 1_250,
            p95Ms: 4_800,
            timedCalls: 240,
          },
          {
            model: "gpt-4o",
            calls: 255,
            failed: 3,
            band: "green",
            p50Ms: 640,
            p95Ms: 1_900,
            timedCalls: 250,
          },
          {
            model: "tiny-model",
            calls: 5,
            failed: 0,
            band: "none",
            p50Ms: null,
            p95Ms: null,
            timedCalls: 5,
          },
        ],
        total: 4,
      },
      byClass: [
        { group: "auth", failed: 20 },
        { group: "rateLimited", failed: 8 },
        { group: "budget", failed: 1 },
        { group: "notReported", failed: 4 },
      ],
      latest: opts.latest
        ? [
            {
              time: "2026-10-07T11:58:12.000Z",
              model: "claude-sonnet",
              alias: "claims-bot-1-r2",
              application: { lineageId: "lineage-1", name: "Claims bot" },
              group: "auth",
            },
            {
              time: "2026-10-07T11:40:00.000Z",
              model: "gpt-4o",
              alias: "probe-key",
              application: null,
              group: "rateLimited",
            },
          ]
        : null,
    },
  };
}

function enabled(opts = { canCheckHealth: true, latest: true }) {
  h.result = { isPending: false, isError: false, data: summary(opts) };
}

describe("EYEON Gateway health page (CHG-2026-139)", () => {
  beforeEach(() => enabled());

  it("says it is switched off and links to the LLM Gateway", () => {
    h.result = { isPending: false, isError: false, data: { enabled: false } };
    render(<EyeonGatewayHealthPage />);
    expect(screen.getByText(/is switched off on this deployment/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the LLM Gateway" }),
    ).toHaveAttribute("href", "/project/p1/acme-enhancements/llm-gateway");
  });

  it("answers the health question as a point in time, with every model's state in words", () => {
    render(<EyeonGatewayHealthPage />);
    expect(
      screen.getByRole("heading", {
        name: "1 of 3 models failed the last health check; 1 was not in the check.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Point in time, no history kept")).toBeTruthy();
    expect(
      screen.getByTitle(/Traffic that bypasses it is not seen/).textContent,
    ).toBe("Gateway traffic only");
    const models = screen.getByRole("list", { name: "Models" });
    expect(within(models).getByText("Unhealthy")).toBeTruthy();
    expect(within(models).getByText("Healthy")).toBeTruthy();
    expect(within(models).getByText("Not in the check")).toBeTruthy();
    expect(
      within(models).getByText("Key or credit refused · anthropic"),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/Checked 2026-10-07 11:57 UTC, 3 min ago/).length,
    ).toBeGreaterThan(0);
  });

  it("gives steps for an unhealthy model and points to where a check can run", () => {
    render(<EyeonGatewayHealthPage />);
    expect(screen.getByText("1 unhealthy model")).toBeTruthy();
    expect(
      screen.getByText(/check the provider account behind this model/i),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Request log: 30 failed of 300 calls in the last 7 days (10.0%).",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Read-only for your role/)).toBeNull();
    expect(
      screen.getByRole("link", {
        name: "Check health on the LLM Gateway page",
      }),
    ).toHaveAttribute("href", "/project/p1/acme-enhancements/llm-gateway");
  });

  it("marks the steps read-only for a role that cannot act", () => {
    enabled({ canCheckHealth: false, latest: true });
    render(<EyeonGatewayHealthPage />);
    expect(screen.getByText(/Read-only for your role/)).toBeTruthy();
    expect(
      screen.queryByRole("link", {
        name: "Check health on the LLM Gateway page",
      }),
    ).toBeNull();
  });

  it("shows the failure analysis from the request log, with the change and the classes", () => {
    render(<EyeonGatewayHealthPage />);
    const failedTile = screen
      .getByText("5.9% of calls, last 7 days")
      .closest("a")!;
    expect(within(failedTile).getByText("Failed calls")).toBeTruthy();
    expect(within(failedTile).getByText("33")).toBeTruthy();
    expect(
      screen.getByText("+50% against the previous 7 days (22)"),
    ).toBeTruthy();
    expect(screen.getByText("Rate-limit and budget refusals")).toBeTruthy();
    expect(
      screen.getAllByText("Key or permission refused").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("No class reported").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Within the expected lag").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Too few calls to show")).toBeTruthy();
    expect(screen.getByText("1.3 s")).toBeTruthy();
    expect(screen.getByText("1 more model had calls.")).toBeTruthy();
  });

  it("links a failed call to its application only where the server resolved one", () => {
    render(<EyeonGatewayHealthPage />);
    expect(screen.getByRole("link", { name: "Claims bot" })).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/applications/lineage-1",
    );
    expect(screen.getByText("probe-key")).toBeTruthy();
    expect(screen.getByText("2026-10-07 11:58:12")).toBeTruthy();
  });

  it("says individual calls need the request log's access when they were not read", () => {
    enabled({ canCheckHealth: false, latest: false });
    render(<EyeonGatewayHealthPage />);
    expect(
      screen.getByText(/Individual gateway calls need access/),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Claims bot" })).toBeNull();
  });

  it("lists what is not recorded, never as a number", () => {
    render(<EyeonGatewayHealthPage />);
    const list = screen.getByText("Model health over time").closest("ul")!;
    expect(within(list).getAllByText("Not recorded")).toHaveLength(6);
    expect(within(list).getByText("Health of each gateway pod")).toBeTruthy();
    expect(list.textContent).not.toMatch(/\d/);
  });

  it("says so when gateway management is off, rather than showing zeros", () => {
    h.result = {
      isPending: false,
      isError: false,
      data: {
        ...summary({ canCheckHealth: true, latest: true }),
        gatewayManagement: false,
        requestLog: false,
        health: null,
        applications: null,
        mirror: null,
        failures: null,
      },
    };
    render(<EyeonGatewayHealthPage />);
    expect(
      screen.getByRole("heading", {
        name: /Gateway management is switched off on this deployment/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/EYEON holds no models, keys or gateway calls/),
    ).toBeTruthy();
    expect(screen.queryByText("What to do")).toBeNull();
  });
});

describe("EYEON kit: health chips (CHG-2026-139)", () => {
  it.each([
    ["healthy", "Healthy"],
    ["unhealthy", "Unhealthy"],
    ["unknown", "Not in the check"],
  ] as const)("names the %s state in words", (status, label) => {
    render(<EyeonModelHealthChip status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it.each([
    ["withinLag", "Within the expected lag"],
    ["behind", "Behind: completeness unknown"],
    ["noReconciliation", "No reconciliation recorded"],
  ] as const)("names the mirror's %s state in words", (state, label) => {
    render(<EyeonMirrorChip state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
