import { describe, it, expect, vi } from "vitest";
import { AcmeLitellmKeyStatus } from "@langfuse/shared/src/db";
import {
  CATALOGUE_SNAPSHOT_KEY,
  HEALTH_CACHE_MINUTES,
  HEALTH_MODELS_SHOWN,
  LATEST_FAILED_SHOWN,
  MODELS_SHOWN,
  applicationIndex,
  callTotals,
  errorClassGroup,
  failureSeries,
  failuresByClass,
  failuresByModel,
  healthCause,
  healthView,
  latestFailures,
  limitRefusals,
  ROUTE_APPLICATIONS_SHOWN,
  mirrorView,
  modelRoutes,
  newestArrival,
  windowRange,
} from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";
import {
  ROUTE_GAP_PX,
  ROUTE_GATEWAY_PX,
  ROUTE_ROW_PX,
  routeLayout,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayRouteGeometry";
import {
  ERROR_CLASS,
  ERROR_CLASS_ORDER,
  ageText,
  failedDelta,
  formatCallShare,
  formatDurationMs,
  routeHeadline,
  utcTime,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";
import {
  type LitellmServiceDeps,
  getCatalogue,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmService";

// CHG-2026-139 (ADR-0027): the EYEON Gateway health page's pure functions:
// its periods, model health from the last check, the failure analysis from
// the request log, the mirror's freshness, and its wording.

const NOW = new Date("2026-10-07T12:34:56.000Z");
const MINUTE = 60_000;
const PROVIDER_MESSAGE =
  "litellm.AuthenticationError: Incorrect API key provided: sk-pr****abcd";

describe("windowRange: UTC-aligned buckets and an equal previous period", () => {
  it.each([
    ["24h", 24, 60, "2026-10-06T13:00:00.000Z"],
    ["7d", 28, 360, "2026-09-30T18:00:00.000Z"],
    ["30d", 30, 1440, "2026-09-08T00:00:00.000Z"],
  ] as const)(
    "%s: %d buckets of %d minutes from %s",
    (window, buckets, minutes, from) => {
      const r = windowRange(window, NOW);
      expect(r.buckets).toBe(buckets);
      expect(r.bucketMs).toBe(minutes * MINUTE);
      expect(r.from.toISOString()).toBe(from);
      // The bucket holding now is the last one.
      const last = r.from.getTime() + (buckets - 1) * r.bucketMs;
      expect(NOW.getTime()).toBeGreaterThanOrEqual(last);
      expect(NOW.getTime()).toBeLessThan(last + r.bucketMs);
      // The previous period is as long and ends where this one starts.
      expect(r.from.getTime() - r.previousFrom.getTime()).toBe(
        NOW.getTime() - r.from.getTime(),
      );
    },
  );
});

describe("model health from the last check (point in time)", () => {
  it.each([
    ["Your credit balance is too low to access the API", "keyOrCredit"],
    [
      "You exceeded your current quota, please check your plan and billing details",
      "keyOrCredit",
    ],
    [PROVIDER_MESSAGE, "keyOrCredit"],
    ["RateLimitError: 429 Too Many Requests", "rateLimited"],
    ["RESOURCE_EXHAUSTED", "rateLimited"],
    ["The model `old-model` does not exist", "notFound"],
    ["NotFoundError: model retired", "notFound"],
    ["Request timed out after 60s", "timeout"],
    ["APIConnectionError: ECONNREFUSED", "unreachable"],
    ["503 Service Unavailable", "providerError"],
    ["something odd", "unknown"],
    [null, "unknown"],
  ] as const)("sorts %j as %s", (message, cause) => {
    expect(healthCause(message)).toBe(cause);
  });

  const payload = [
    {
      modelName: "gpt-4o",
      providers: ["openai"],
      health: "healthy",
      healthError: null,
      inputCostPerToken: 0.000005,
    },
    {
      modelName: "claude-sonnet",
      providers: ["anthropic"],
      health: "unhealthy",
      healthError: PROVIDER_MESSAGE,
    },
    { modelName: "gemini-judge", providers: [], health: "unknown" },
    // Malformed entries are left out, never guessed at.
    { modelName: "", health: "healthy" },
    { health: "healthy" },
    "not an entry",
  ];

  it("orders unhealthy first, counts, and never returns the provider's message", () => {
    const view = healthView(
      { payload, fetchedAt: new Date(NOW.getTime() - 2 * MINUTE) },
      NOW,
    );
    expect(view.models.map((m) => [m.model, m.status, m.cause])).toEqual([
      ["claude-sonnet", "unhealthy", "keyOrCredit"],
      ["gemini-judge", "unknown", null],
      ["gpt-4o", "healthy", null],
    ]);
    expect(view.counts).toEqual({
      total: 3,
      healthy: 1,
      unhealthy: 1,
      unknown: 1,
    });
    expect(view.checkedAt).toBe("2026-10-07T12:32:56.000Z");
    expect(view.fresh).toBe(true);
    expect(view.cacheMinutes).toBe(HEALTH_CACHE_MINUTES);
    expect(JSON.stringify(view)).not.toMatch(/sk-|Incorrect API key|Cost/);
  });

  it("calls a result older than the 5-minute cache stale", () => {
    const at = (minutesAgo: number) =>
      healthView(
        { payload, fetchedAt: new Date(NOW.getTime() - minutesAgo * MINUTE) },
        NOW,
      ).fresh;
    expect(at(4.9)).toBe(true);
    expect(at(5)).toBe(false);
    expect(at(120)).toBe(false);
  });

  it("treats no snapshot, or one that is not a list, as no check", () => {
    for (const snapshot of [null, { payload: { x: 1 }, fetchedAt: NOW }]) {
      expect(healthView(snapshot, NOW)).toMatchObject({
        checkedAt: null,
        fresh: false,
        models: [],
        counts: { total: 0 },
      });
    }
  });

  it("lists at most the cap and counts the rest", () => {
    const many = Array.from({ length: HEALTH_MODELS_SHOWN + 3 }, (_, i) => ({
      modelName: `model-${String(i).padStart(3, "0")}`,
      providers: ["p"],
      health: "healthy",
    }));
    const view = healthView({ payload: many, fetchedAt: NOW }, NOW);
    expect(view.models).toHaveLength(HEALTH_MODELS_SHOWN);
    expect(view.more).toBe(3);
    expect(view.counts.total).toBe(HEALTH_MODELS_SHOWN + 3);
  });
});

describe("drift guard: the LLM Gateway page's catalogue snapshot", () => {
  function fakeDeps(cachedMinutesAgo: number | null) {
    const findUnique = vi.fn(async (args: { where: { cacheKey: string } }) =>
      cachedMinutesAgo === null
        ? null
        : {
            cacheKey: args.where.cacheKey,
            payload: [],
            fetchedAt: new Date(NOW.getTime() - cachedMinutesAgo * MINUTE),
          },
    );
    const upsert = vi.fn(async () => ({}));
    const client = {
      modelGroups: vi.fn(async () => [
        { model_group: "gpt-4o", providers: ["openai"] },
        { model_group: "claude-sonnet", providers: ["anthropic"] },
      ]),
      models: vi.fn(async () => [
        { model_name: "gpt-4o", litellm_params: { model: "openai/gpt-4o" } },
        {
          model_name: "claude-sonnet",
          litellm_params: { model: "anthropic/claude-sonnet" },
        },
      ]),
      health: vi.fn(async () => ({
        healthy_endpoints: [{ model: "openai/gpt-4o" }],
        unhealthy_endpoints: [
          { model: "anthropic/claude-sonnet", error: PROVIDER_MESSAGE },
        ],
      })),
    };
    const deps = {
      client,
      db: { acmeLitellmSpendSnapshot: { findUnique, upsert } },
      write: vi.fn(),
      now: () => NOW,
    } as unknown as LitellmServiceDeps;
    return { deps, findUnique, upsert, client };
  }

  it("reads the same cache key and honours the same 5-minute age", async () => {
    const fresh = fakeDeps(HEALTH_CACHE_MINUTES - 0.1);
    await getCatalogue(fresh.deps);
    expect(fresh.findUnique.mock.calls[0]![0].where.cacheKey).toBe(
      CATALOGUE_SNAPSHOT_KEY,
    );
    expect(fresh.client.health).not.toHaveBeenCalled();

    const expired = fakeDeps(HEALTH_CACHE_MINUTES);
    await getCatalogue(expired.deps);
    expect(expired.client.health).toHaveBeenCalledTimes(1);
  });

  it("stores entries this page parses, health and all", async () => {
    const { deps, upsert } = fakeDeps(null);
    await getCatalogue(deps);
    const [args] = upsert.mock.calls[0] as unknown as [
      { where: { cacheKey: string }; create: { payload: unknown } },
    ];
    expect(args.where.cacheKey).toBe(CATALOGUE_SNAPSHOT_KEY);
    const view = healthView(
      { payload: args.create.payload, fetchedAt: NOW },
      NOW,
    );
    expect(view.models.map((m) => [m.model, m.status, m.cause])).toEqual([
      ["claude-sonnet", "unhealthy", "keyOrCredit"],
      ["gpt-4o", "healthy", null],
    ]);
  });
});

describe("applications via gateway keys", () => {
  const key = (
    lineageId: string,
    alias: string,
    generation: number,
    status: AcmeLitellmKeyStatus,
  ) => ({
    lineageId,
    generation,
    displayName: `App ${lineageId}`,
    litellmKeyAlias: alias,
    status,
  });

  it("counts lineages with an active key once, across rotations", () => {
    const { count, byAlias } = applicationIndex([
      key("l1", "a-1", 1, AcmeLitellmKeyStatus.ROTATED),
      key("l1", "a-1-r2", 2, AcmeLitellmKeyStatus.ACTIVE),
      key("l2", "b-1", 1, AcmeLitellmKeyStatus.ACTIVE),
      // No active key: not an application.
      key("l3", "c-1", 1, AcmeLitellmKeyStatus.REVOKED),
    ]);
    expect(count).toBe(2);
    expect(byAlias.get("a-1")).toEqual({ lineageId: "l1", name: "App l1" });
    expect(byAlias.get("c-1")).toBeUndefined();
  });
});

describe("failure analysis from the request log", () => {
  it.each([
    ["RateLimitError", "rateLimited"],
    ["litellm.RateLimitError", "rateLimited"],
    ["BudgetExceededError", "budget"],
    ["AuthenticationError", "auth"],
    ["Timeout", "timeout"],
    ["ServiceUnavailableError", "provider"],
    ["ContextWindowExceededError", "rejected"],
    ["APIConnectionError", "connection"],
    ["SomethingNew", "other"],
    [null, "notReported"],
    ["  ", "notReported"],
  ] as const)("groups %j as %s", (cls, group) => {
    expect(errorClassGroup(cls)).toBe(group);
  });

  it("groups each class once and orders every group", () => {
    const all = ERROR_CLASS_ORDER.flatMap((g) => ERROR_CLASS[g].classes);
    expect(new Set(all).size).toBe(all.length);
    expect([...ERROR_CLASS_ORDER].sort()).toEqual(
      Object.keys(ERROR_CLASS).sort(),
    );
  });

  it("fills every bucket, clamps a call stamped ahead into the last, drops one before the first", () => {
    const r = windowRange("24h", NOW);
    const series = failureSeries(r, [
      { bucket: 0, calls: 4, failed: 1, newestReceivedAt: null },
      { bucket: 23, calls: 10, failed: 2, newestReceivedAt: null },
      { bucket: 24, calls: 1, failed: 1, newestReceivedAt: null },
      { bucket: -1, calls: 99, failed: 99, newestReceivedAt: null },
    ]);
    expect(series).toHaveLength(24);
    expect(series[0]).toEqual({
      start: "2026-10-06T13:00:00.000Z",
      label: "2026-10-06 13:00",
      calls: 4,
      failed: 1,
    });
    expect(series[23]).toMatchObject({
      label: "2026-10-07 12:00",
      calls: 11,
      failed: 3,
    });
    expect(series[5]).toMatchObject({ calls: 0, failed: 0 });
    const daily = failureSeries(windowRange("30d", NOW), []);
    expect(daily[29]?.label).toBe("2026-10-07");
  });

  it("finds the newest arrival over every bucket", () => {
    expect(
      newestArrival([
        { bucket: 0, calls: 1, failed: 0, newestReceivedAt: null },
        {
          bucket: 1,
          calls: 1,
          failed: 0,
          newestReceivedAt: "2026-10-07T12:30:00.000Z",
        },
        {
          bucket: 2,
          calls: 1,
          failed: 0,
          newestReceivedAt: "2026-10-07T12:01:00.000Z",
        },
      ]),
    ).toBe("2026-10-07T12:30:00.000Z");
    expect(newestArrival([])).toBeNull();
  });

  it("rates each model as the Applications reliability check", () => {
    const row = (
      model: string | null,
      calls: number,
      failed: number,
      timedCalls = calls,
    ) => ({
      model,
      calls,
      failed,
      timedCalls,
      p50Ms: 800,
      p95Ms: 2_400,
      models: 5,
    });
    const { shown, total } = failuresByModel([
      row("a", 100, 1),
      row("b", 100, 2),
      row("c", 100, 5),
      row("d", 100, 6),
      row(null, 9, 9, 9),
    ]);
    expect(total).toBe(5);
    expect(shown.map((m) => m.band)).toEqual([
      "green",
      "amber",
      "amber",
      "red",
      "none",
    ]);
    // Durations only from 10 timed calls.
    expect(shown[0]).toMatchObject({ p50Ms: 800, p95Ms: 2_400 });
    expect(shown[4]).toMatchObject({ model: null, p50Ms: null, p95Ms: null });
  });

  it("caps the models shown", () => {
    const rows = Array.from({ length: MODELS_SHOWN + 2 }, (_, i) => ({
      model: `m${i}`,
      calls: 10,
      failed: 0,
      timedCalls: 0,
      p50Ms: null,
      p95Ms: null,
      models: MODELS_SHOWN + 2,
    }));
    const { shown, total } = failuresByModel(rows);
    expect(shown).toHaveLength(MODELS_SHOWN);
    expect(total).toBe(MODELS_SHOWN + 2);
    expect(failuresByModel([])).toEqual({ shown: [], total: 0 });
  });

  it("groups failures by class, largest first, the rest under Other", () => {
    const c = (errorClass: string | null, n: number) => ({
      errorClass,
      _count: { _all: n },
    });
    const byClass = failuresByClass(
      [
        c("RateLimitError", 5),
        c("litellm.RateLimitError", 1),
        c("BudgetExceededError", 2),
        c("Timeout", 3),
        c("Mystery", 1),
        c(null, 1),
      ],
      // Two more failed calls than the capped groups hold.
      15,
    );
    expect(byClass).toEqual([
      { group: "rateLimited", failed: 6 },
      { group: "timeout", failed: 3 },
      { group: "other", failed: 3 },
      { group: "budget", failed: 2 },
      { group: "notReported", failed: 1 },
    ]);
    expect(byClass.reduce((n, g) => n + g.failed, 0)).toBe(15);
    expect(limitRefusals(byClass)).toBe(8);
    expect(failuresByClass([], 0)).toEqual([]);
  });

  it("counts any status but success as failed, as the Applications page", () => {
    expect(
      callTotals([
        { status: "success", _count: { _all: 90 } },
        { status: "failure", _count: { _all: 8 } },
        { status: "unknown", _count: { _all: 2 } },
      ]),
    ).toEqual({ calls: 100, failed: 10 });
  });

  it("lists the newest failed calls with their application, model group first", () => {
    const at = new Date("2026-10-07T12:00:00.000Z");
    const rows = Array.from(
      { length: LATEST_FAILED_SHOWN + 2 },
      (): {
        startTime: Date;
        model: string | null;
        modelGroup: string | null;
        keyAlias: string | null;
        errorClass: string | null;
      } => ({
        startTime: at,
        model: "openai/gpt-4o",
        modelGroup: "gpt-4o",
        keyAlias: "a-1",
        errorClass: "RateLimitError",
      }),
    );
    rows[1] = { ...rows[1]!, modelGroup: null, keyAlias: null };
    const byAlias = new Map([["a-1", { lineageId: "l1", name: "Claims" }]]);
    const out = latestFailures(rows, byAlias);
    expect(out).toHaveLength(LATEST_FAILED_SHOWN);
    expect(out[0]).toEqual({
      time: "2026-10-07T12:00:00.000Z",
      model: "gpt-4o",
      alias: "a-1",
      application: { lineageId: "l1", name: "Claims" },
      group: "rateLimited",
    });
    expect(out[1]).toMatchObject({
      model: "openai/gpt-4o",
      alias: null,
      application: null,
    });
    expect(latestFailures(rows, null)[0]?.application).toBeNull();
  });
});

describe("the mirror's freshness", () => {
  const run = (minutesAgo: number) => ({
    finishedAt: new Date(NOW.getTime() - minutesAgo * MINUTE),
    windowEnd: new Date(NOW.getTime() - (minutesAgo + 2) * MINUTE),
    gapCount: 3,
  });

  it("is within the expected lag while reconciliation succeeds", () => {
    expect(mirrorView(run(4), "2026-10-07T12:30:00.000Z", NOW)).toEqual({
      state: "withinLag",
      expectedLagMinutes: 7,
      completeTo: "2026-10-07T12:28:56.000Z",
      lastReconciledAt: "2026-10-07T12:30:56.000Z",
      lastGapCount: 3,
      newestArrival: "2026-10-07T12:30:00.000Z",
    });
    expect(mirrorView(run(15), null, NOW).state).toBe("withinLag");
  });

  it("is behind after 15 minutes without a successful pass, as the Gateway requests log says", () => {
    expect(mirrorView(run(16), null, NOW).state).toBe("behind");
  });

  it("says so when no reconciliation is recorded", () => {
    expect(mirrorView(null, null, NOW)).toMatchObject({
      state: "noReconciliation",
      completeTo: null,
      lastGapCount: null,
    });
  });
});

describe("the page's wording", () => {
  it("states times in UTC and ages in words", () => {
    expect(utcTime("2026-10-07T12:04:59.000Z")).toBe("2026-10-07 12:04 UTC");
    const now = NOW.toISOString();
    const ago = (ms: number) =>
      ageText(new Date(NOW.getTime() - ms).toISOString(), now);
    expect(ago(20_000)).toBe("under a minute ago");
    expect(ago(3 * MINUTE)).toBe("3 min ago");
    expect(ago(150 * MINUTE)).toBe("2 h ago");
    expect(ago(72 * 60 * MINUTE)).toBe("3 days ago");
    // A time ahead of the clock never reads as negative.
    expect(ago(-5 * MINUTE)).toBe("under a minute ago");
  });

  it("formats durations and shares", () => {
    expect(formatDurationMs(812.4)).toBe("812 ms");
    expect(formatDurationMs(1_440)).toBe("1.4 s");
    expect(formatDurationMs(150_000)).toBe("2.5 min");
    expect(formatCallShare(1, 3)).toBe("33.3%");
    expect(formatCallShare(1, 10_000)).toBe("<0.1%");
    expect(formatCallShare(9_999, 10_000)).toBe(">99.9%");
    expect(formatCallShare(0, 0)).toBe("–");
  });

  it("compares failed calls with the previous period of the same length", () => {
    expect(failedDelta(12, { calls: 100, failed: 10 }, "24h")).toEqual({
      text: "+20% against the previous 24 hours (10)",
      tone: "bad",
    });
    expect(failedDelta(5, { calls: 100, failed: 10 }, "7d")).toEqual({
      text: "−50% against the previous 7 days (10)",
      tone: "good",
    });
    expect(failedDelta(3, { calls: 0, failed: 0 }, "30d").text).toBe(
      "No calls in the previous 30 days",
    );
    expect(failedDelta(3, { calls: 50, failed: 0 }, "24h")).toEqual({
      text: "Up from none in the previous 24 hours",
      tone: "bad",
    });
    expect(failedDelta(10, { calls: 50, failed: 10 }, "24h").tone).toBe(
      "neutral",
    );
  });

  it("answers the health question in one line, never as a trend, and says right now only while the check is fresh (CHG-2026-139 follow-up)", () => {
    const counts = (
      total: number,
      healthy: number,
      unhealthy: number,
      fresh = true,
    ) => ({
      checkedAt: NOW.toISOString(),
      fresh,
      counts: { total, healthy, unhealthy },
    });
    expect(routeHeadline(null).rest).toMatch(/switched off/);
    expect(
      routeHeadline({
        checkedAt: null,
        fresh: false,
        counts: counts(0, 0, 0).counts,
      }),
    ).toEqual({ lead: null, rest: "No model health check is recorded yet." });
    expect(routeHeadline(counts(6, 4, 2))).toEqual({
      lead: "2 of 6 models",
      rest: "are failing right now.",
    });
    expect(routeHeadline(counts(6, 5, 1))).toEqual({
      lead: "1 of 6 models",
      rest: "is failing right now.",
    });
    expect(routeHeadline(counts(6, 4, 2, false))).toEqual({
      lead: "2 of 6 models",
      rest: "failed the last health check.",
    });
    expect(routeHeadline(counts(6, 6, 0))).toEqual({
      lead: null,
      rest: "All 6 models answered the last health check.",
    });
    expect(routeHeadline(counts(3, 2, 0))).toEqual({
      lead: null,
      rest: "2 of 3 models answered the last health check.",
    });
  });
});

describe("which applications may call each model (CHG-2026-139 follow-up)", () => {
  const key = (
    lineage: string,
    generation: number,
    status: AcmeLitellmKeyStatus,
    models: string[],
    team: string | null = null,
  ) => ({
    lineageId: lineage,
    generation,
    displayName: `App ${lineage}`,
    litellmKeyAlias: `${lineage}-${generation}`,
    status,
    models,
    litellmTeamId: team,
  });
  const ACTIVE = AcmeLitellmKeyStatus.ACTIVE;

  it("uses the current key's own list, else its team's, else every model", () => {
    const routes = modelRoutes(
      [
        key("own", 1, ACTIVE, ["gpt-4o"]),
        key("team", 1, ACTIVE, [], "t1"),
        key("all", 1, ACTIVE, []),
        key("catch-all", 1, ACTIVE, ["all-proxy-models"]),
        // A rotated generation's list does not count; the active one's does.
        key("rotated", 1, AcmeLitellmKeyStatus.ROTATED, ["claude-sonnet"]),
        key("rotated", 2, ACTIVE, ["llama"]),
        // No active key: not an application.
        key("revoked", 1, AcmeLitellmKeyStatus.REVOKED, []),
      ],
      [{ id: "t1", models: ["claude-sonnet"] }],
      ["gpt-4o", "claude-sonnet", "llama", "gemini-judge"],
    );
    const names = (m: string) =>
      routes.get(m)!.applications.map((a) => a.lineageId);
    expect(names("gpt-4o")).toEqual(["all", "catch-all", "own"]);
    expect(names("claude-sonnet")).toEqual(["all", "catch-all", "team"]);
    expect(names("llama")).toEqual(["all", "catch-all", "rotated"]);
    expect(routes.get("gemini-judge")).toEqual({
      count: 2,
      applications: [
        { lineageId: "all", name: "App all" },
        { lineageId: "catch-all", name: "App catch-all" },
      ],
    });
  });

  it("says no application routes to a model no key may call", () => {
    const routes = modelRoutes(
      [key("own", 1, ACTIVE, ["gpt-4o"])],
      [],
      ["gemini-judge"],
    );
    expect(routes.get("gemini-judge")).toEqual({ count: 0, applications: [] });
  });

  it("counts every application but names at most the first few, by name", () => {
    const keys = Array.from({ length: ROUTE_APPLICATIONS_SHOWN + 4 }, (_, i) =>
      key(`app-${String(i).padStart(2, "0")}`, 1, ACTIVE, []),
    );
    const r = modelRoutes(keys, [], ["gpt-4o"]).get("gpt-4o")!;
    expect(r.count).toBe(ROUTE_APPLICATIONS_SHOWN + 4);
    expect(r.applications).toHaveLength(ROUTE_APPLICATIONS_SHOWN);
    expect(r.applications[0]?.lineageId).toBe("app-00");
  });
});

describe("the route map's geometry (CHG-2026-139 follow-up)", () => {
  it("centres the models on the gateway and ends each wire at its row's middle", () => {
    const six = routeLayout(6);
    // 6 rows of 64 px with 5 gaps of 8 px.
    expect(six.height).toBe(6 * ROUTE_ROW_PX + 5 * ROUTE_GAP_PX);
    expect(six.gatewayY).toBe(six.height / 2);
    expect(six.wires.map((w) => w.y)).toEqual([32, 104, 176, 248, 320, 392]);
    expect(six.wires[0]!.path).toBe(
      `M 0 ${six.gatewayY} C 56 ${six.gatewayY} 56 32 112 32`,
    );
    expect(six.wires[0]!.mid).toEqual({ x: 56, y: (six.gatewayY + 32) / 2 });
  });

  it("is never shorter than the gateway card, and centres a short list", () => {
    const one = routeLayout(1);
    expect(one.height).toBe(ROUTE_GATEWAY_PX);
    expect(one.wires[0]!.y).toBe(ROUTE_GATEWAY_PX / 2);
    expect(one.wires[0]!.path).toBe(
      `M 0 ${ROUTE_GATEWAY_PX / 2} C 56 ${ROUTE_GATEWAY_PX / 2} 56 ${ROUTE_GATEWAY_PX / 2} 112 ${ROUTE_GATEWAY_PX / 2}`,
    );
    expect(routeLayout(0).wires).toEqual([]);
  });
});
