import { type ComponentProps } from "react";

import preview from "@/.storybook/preview";
import { EyeonGatewayRouteMap } from "@/src/features/acme-enhancements/components/EyeonGatewayRouteMap";

/**
 * CHG-2026-139 follow-up (owner, 2026-10-08: "my Gateway health should be
 * similar to this and clickable"). The Gateway health hero as the
 * prototype's route map, on fixed figures, so it can be checked in a real
 * browser: the wires from the gateway to each model, solid for a model that
 * passed its last check and dashed with a cross for one that failed, the
 * model cards with their cause and application keys, the request-log mirror
 * and the facts. Story-only: no network call, no database.
 *
 * Default follows the owner's screenshot: 6 models, 2 failing (credit and a
 * retired model), the last check expired, 8 applications.
 */

type Data = ComponentProps<typeof EyeonGatewayRouteMap>["data"];

const meta = preview.meta({ component: EyeonGatewayRouteMap });

const NOW = "2026-10-08T20:15:00.000Z";
const CHECKED = "2026-10-08T20:09:00.000Z";

const apps = (n: number) =>
  Array.from({ length: Math.min(n, 8) }, (_, i) => ({
    lineageId: `lineage-${i + 1}`,
    name: `Application ${i + 1}`,
  }));

const model = (
  name: string,
  status: "healthy" | "unhealthy" | "unknown",
  routes: number,
  cause: "keyOrCredit" | "notFound" | null = null,
  providers: string[] = ["openai"],
) => ({
  model: name,
  providers,
  status,
  cause,
  routes: { count: routes, applications: apps(routes) },
});

const owners = {
  enabled: true,
  window: "7d",
  generatedAt: NOW,
  gatewayManagement: true,
  requestLog: true,
  canCheckHealth: true,
  health: {
    checkedAt: CHECKED,
    fresh: false,
    cacheMinutes: 5,
    models: [
      model("claude-sonnet-4", "unhealthy", 3, "keyOrCredit", ["anthropic"]),
      model("gemini-judge", "unhealthy", 0, "notFound", ["gemini"]),
      model("gpt-4o", "healthy", 7),
      model("llama-3.3-70b", "healthy", 4, null, ["groq"]),
      model("gpt-oss-20b", "healthy", 3, null, ["groq"]),
      model("safeguard-judge", "healthy", 0, null, ["groq"]),
    ],
    counts: { total: 6, healthy: 4, unhealthy: 2, unknown: 0 },
    more: 0,
  },
  applications: 8,
  mirror: {
    state: "withinLag",
    expectedLagMinutes: 7,
    completeTo: "2026-10-08T20:09:00.000Z",
    lastReconciledAt: "2026-10-08T20:12:00.000Z",
    lastGapCount: 0,
    newestArrival: "2026-10-08T20:11:00.000Z",
  },
  failures: null,
} satisfies Data;

const links = {
  gateway: "/project/demo/acme-enhancements/llm-gateway",
  requests:
    "/project/demo/acme-enhancements/security-logs?tab=gateway-requests",
  applications: "/project/demo/acme-enhancements/applications",
};

/** The owner's screenshot: two of six models failing, the check expired. */
export const Default = meta.story({ args: { data: owners, links } });

/** A fresh check with every model healthy: green wires, "answered". */
export const AllHealthy = meta.story({
  args: {
    data: {
      ...owners,
      health: {
        ...owners.health,
        fresh: true,
        checkedAt: "2026-10-08T20:13:00.000Z",
        models: owners.health.models
          .slice(2)
          .map((m) => ({ ...m, status: "healthy" as const, cause: null })),
        counts: { total: 4, healthy: 4, unhealthy: 0, unknown: 0 },
      },
    },
    links,
  },
});

/** One model only: the row is the gateway card's height, the model centred. */
export const OneModel = meta.story({
  args: {
    data: {
      ...owners,
      health: {
        ...owners.health,
        fresh: true,
        models: [owners.health.models[0]!],
        counts: { total: 1, healthy: 0, unhealthy: 1, unknown: 0 },
      },
    },
    links,
  },
});
