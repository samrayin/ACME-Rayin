/**
 * ACME (CHG-2026-139, ADR-0027): the EYEON Gateway health page's figures.
 *
 * Pure functions only, so they are tested without a database; the router
 * (eyeonGatewayHealthRouter.ts) does the reads. Every input here is
 * metadata:
 *  - the last model health check the console holds: the LLM Gateway page's
 *    catalogue snapshot (model name, providers, healthy or not, and the
 *    provider's message, which is sorted into a likely cause here and never
 *    returned);
 *  - counts of gateway calls from the request-log mirror by model, status,
 *    error class and time bucket, and call durations (end minus start);
 *  - the newest failed calls' time, model, key alias and error class;
 *  - the gateway keys' lineage, name, alias and status;
 *  - the last successful reconciliation of the mirror.
 * No prompt or answer text, error text, token hash, key secret, end user or
 * source address is an input here.
 *
 * Model health is point in time: only the latest check is kept, so no health
 * history exists and none is drawn.
 */
import { z } from "zod";
import {
  type Band,
  SCORECARD_THRESHOLDS,
  bandAbove,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { currentGeneration } from "@/src/features/acme-enhancements/server/acmeApplicationDetail";
import {
  type ApplicationRef,
  applicationsByAlias,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  ERROR_CLASS,
  ERROR_CLASS_ORDER,
  type ErrorClassGroup,
  type GatewayHealthWindow,
  type HealthCause,
  LIMIT_GROUPS,
  type MirrorState,
  type ModelHealthStatus,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";

const HOUR_MS = 3_600_000;

/**
 * The catalogue snapshot's key and age limit, as the LLM Gateway page's
 * getCatalogue (acmeLitellmService.ts) writes and honours them. A test
 * checks both against that function, so the two cannot drift apart.
 */
export const CATALOGUE_SNAPSHOT_KEY = "catalogue";
export const HEALTH_CACHE_MINUTES = 5;

/**
 * The request-log mirror's expected lag: the gateway pushes each call within
 * seconds, and a reconciliation every 5 minutes, which leaves the newest 2
 * minutes to settle, adds what the push missed. So a call can take up to
 * about 7 minutes to appear.
 */
const MIRROR_EXPECTED_LAG_MINUTES = 7;

/**
 * No successful reconciliation for this long and the mirror's completeness
 * is unknown: the Gateway requests log's own rule (reconcileStatus).
 */
const MIRROR_STALE_AFTER_MINUTES = 15;

/** How many models the failure share lists; the rest are counted. */
export const MODELS_SHOWN = 10;

/** How many of the newest failed calls the page lists. */
export const LATEST_FAILED_SHOWN = 10;

/** How many models of the last health check the page lists. */
export const HEALTH_MODELS_SHOWN = 50;

const WINDOW_SPEC: Record<
  GatewayHealthWindow,
  { bucketHours: number; buckets: number }
> = {
  "24h": { bucketHours: 1, buckets: 24 },
  "7d": { bucketHours: 6, buckets: 28 },
  "30d": { bucketHours: 24, buckets: 30 },
};

type WindowRange = {
  /** The start of the first bucket. */
  from: Date;
  /** The time of the read. */
  now: Date;
  bucketMs: number;
  buckets: number;
  /** The previous period of the same length, just before `from`. */
  previousFrom: Date;
};

/**
 * The period's buckets, aligned to UTC (whole hours, 6-hour blocks from
 * midnight, or UTC days); the bucket holding `now` is the last. The
 * previous period has the same length and ends where this one starts.
 */
export function windowRange(
  window: GatewayHealthWindow,
  now: Date,
): WindowRange {
  const { bucketHours, buckets } = WINDOW_SPEC[window];
  const bucketMs = bucketHours * HOUR_MS;
  const end = (Math.floor(now.getTime() / bucketMs) + 1) * bucketMs;
  const from = new Date(end - buckets * bucketMs);
  const span = now.getTime() - from.getTime();
  return {
    from,
    now,
    bucketMs,
    buckets,
    previousFrom: new Date(from.getTime() - span),
  };
}

// ---------------------------------------------------------------------------
// Model health, point in time
// ---------------------------------------------------------------------------

/** The catalogue snapshot row, as read: its payload and when it was taken. */
type CatalogueSnapshot = { payload: unknown; fetchedAt: Date };

const catalogueEntrySchema = z.object({
  modelName: z.string().min(1).max(200),
  providers: z.array(z.string().max(100)).max(20).catch([]),
  health: z.enum(["healthy", "unhealthy", "unknown"]).catch("unknown"),
  healthError: z.string().nullish().catch(null),
});

/**
 * Order matters: a credit or billing message wins over its HTTP status, a
 * missing model over a key problem. The patterns read the provider's
 * message; nothing of it leaves this function but the cause.
 */
const HEALTH_CAUSE_PATTERNS: readonly [HealthCause, RegExp][] = [
  ["keyOrCredit", /credit|billing|insufficient.?quota|payment/i],
  ["rateLimited", /rate.?limit|too many requests|resource.?exhausted|\b429\b/i],
  [
    "notFound",
    /not.?found|does not exist|no such model|retired|deprecat|decommission|\b404\b/i,
  ],
  [
    "keyOrCredit",
    /authenticat|unauthori[sz]ed|permission|forbidden|api.?key|\b40[13]\b/i,
  ],
  ["timeout", /timed?.?out|timeout|\b408\b/i],
  [
    "unreachable",
    /connect|unreachable|econnrefused|enotfound|getaddrinfo|network|dns/i,
  ],
  [
    "providerError",
    /\b5\d\d\b|internal server|service unavailable|overloaded|bad gateway/i,
  ],
];

/** The likely cause of a failed health check, from the provider's message. */
export function healthCause(message: string | null | undefined): HealthCause {
  if (!message) return "unknown";
  const match = HEALTH_CAUSE_PATTERNS.find(([, pattern]) =>
    pattern.test(message),
  );
  return match ? match[0] : "unknown";
}

type ModelHealth = {
  model: string;
  providers: string[];
  status: ModelHealthStatus;
  /** Only for a model that failed its check. */
  cause: HealthCause | null;
};

type HealthView = {
  /** When the last health check ran; null when none is recorded. */
  checkedAt: string | null;
  /** Within the 5-minute cache; an older result is shown as stale. */
  fresh: boolean;
  cacheMinutes: number;
  /** Unhealthy first, then unchecked, then healthy, by name. */
  models: ModelHealth[];
  counts: {
    total: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
  };
  /** Models beyond the ones listed. */
  more: number;
};

const STATUS_ORDER: Record<ModelHealthStatus, number> = {
  unhealthy: 0,
  unknown: 1,
  healthy: 2,
};

/**
 * The last health check as the page shows it. Entries that do not parse are
 * left out rather than guessed at; a snapshot that is not a list is treated
 * as no check at all.
 */
export function healthView(
  snapshot: CatalogueSnapshot | null,
  now: Date,
): HealthView {
  const empty = {
    checkedAt: null,
    fresh: false,
    cacheMinutes: HEALTH_CACHE_MINUTES,
    models: [],
    counts: { total: 0, healthy: 0, unhealthy: 0, unknown: 0 },
    more: 0,
  };
  if (!snapshot || !Array.isArray(snapshot.payload)) return empty;
  const models: ModelHealth[] = [];
  for (const raw of snapshot.payload) {
    const parsed = catalogueEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    models.push({
      model: e.modelName,
      providers: e.providers,
      status: e.health,
      cause: e.health === "unhealthy" ? healthCause(e.healthError) : null,
    });
  }
  models.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.model.localeCompare(b.model),
  );
  const count = (s: ModelHealthStatus) =>
    models.filter((m) => m.status === s).length;
  const age = now.getTime() - snapshot.fetchedAt.getTime();
  return {
    checkedAt: snapshot.fetchedAt.toISOString(),
    fresh: age < HEALTH_CACHE_MINUTES * 60_000,
    cacheMinutes: HEALTH_CACHE_MINUTES,
    models: models.slice(0, HEALTH_MODELS_SHOWN),
    counts: {
      total: models.length,
      healthy: count("healthy"),
      unhealthy: count("unhealthy"),
      unknown: count("unknown"),
    },
    more: Math.max(0, models.length - HEALTH_MODELS_SHOWN),
  };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

type KeyRow = Parameters<typeof applicationsByAlias>[0][number];

/**
 * The applications sending traffic through gateway keys: lineages with an
 * active key, as on the Applications page. And each alias to its
 * application, for the newest failed calls.
 */
export function applicationIndex(keys: KeyRow[]): {
  count: number;
  byAlias: Map<string, ApplicationRef>;
} {
  const byAlias = applicationsByAlias(keys);
  const lineages = new Set([...byAlias.values()].map((a) => a.lineageId));
  return { count: lineages.size, byAlias };
}

// ---------------------------------------------------------------------------
// Which applications' keys may call each model (CHG-2026-139 follow-up)
// ---------------------------------------------------------------------------

/** How many of the applications that may call a model the page names. */
export const ROUTE_APPLICATIONS_SHOWN = 8;

type RouteKeyRow = KeyRow & { models: string[]; litellmTeamId: string | null };
type RouteTeamRow = { id: string; models: string[] };

type ModelRoutes = {
  /** Applications whose current key may call the model. */
  count: number;
  /** The first of them by name, at most ROUTE_APPLICATIONS_SHOWN. */
  applications: ApplicationRef[];
};

/** A model list that allows every model: empty, or the gateway's catch-alls. */
function allowsEveryModel(models: readonly string[]): boolean {
  return (
    models.length === 0 ||
    models.includes("all-proxy-models") ||
    models.includes("*")
  );
}

/**
 * For each model, the applications whose current key may call it, as the
 * gateway decides: the key's own model list; with none, its team's list;
 * with neither, every model. An application is a key lineage with an active
 * key, as on the Applications page. Names in a list are matched exactly, so
 * a model access group named in a list is not expanded: the count can then
 * be lower than what the gateway allows, never higher.
 */
export function modelRoutes(
  keys: RouteKeyRow[],
  teams: RouteTeamRow[],
  models: string[],
): Map<string, ModelRoutes> {
  const teamModels = new Map(teams.map((t) => [t.id, t.models]));
  const lineages = new Map<string, RouteKeyRow[]>();
  for (const k of keys) {
    const list = lineages.get(k.lineageId) ?? [];
    list.push(k);
    lineages.set(k.lineageId, list);
  }
  const apps: { ref: ApplicationRef; allowed: readonly string[] | "all" }[] =
    [];
  for (const generations of lineages.values()) {
    const current = currentGeneration(generations);
    if (!current) continue;
    const team = current.litellmTeamId
      ? teamModels.get(current.litellmTeamId)
      : undefined;
    const allowed = !allowsEveryModel(current.models)
      ? current.models
      : team && !allowsEveryModel(team)
        ? team
        : "all";
    apps.push({
      ref: { lineageId: current.lineageId, name: current.displayName },
      allowed,
    });
  }
  apps.sort(
    (a, b) =>
      a.ref.name.localeCompare(b.ref.name) ||
      a.ref.lineageId.localeCompare(b.ref.lineageId),
  );
  return new Map(
    models.map((model) => {
      const matching = apps.filter(
        (a) => a.allowed === "all" || a.allowed.includes(model),
      );
      return [
        model,
        {
          count: matching.length,
          applications: matching
            .slice(0, ROUTE_APPLICATIONS_SHOWN)
            .map((a) => a.ref),
        },
      ];
    }),
  );
}

/** The health view with each model's routes beside it. */
export function withRoutes(
  health: HealthView,
  keys: RouteKeyRow[],
  teams: RouteTeamRow[],
): Omit<HealthView, "models"> & {
  models: (ModelHealth & { routes: ModelRoutes })[];
} {
  const routes = modelRoutes(
    keys,
    teams,
    health.models.map((m) => m.model),
  );
  return {
    ...health,
    models: health.models.map((m) => ({
      ...m,
      routes: routes.get(m.model) ?? { count: 0, applications: [] },
    })),
  };
}

// ---------------------------------------------------------------------------
// Failure analysis, from the request-log mirror
// ---------------------------------------------------------------------------

const GROUP_BY_CLASS = new Map<string, ErrorClassGroup>(
  ERROR_CLASS_ORDER.flatMap((group) =>
    ERROR_CLASS[group].classes.map((cls) => [cls, group] as const),
  ),
);

/** A failed call's error class, as the group the page shows. */
export function errorClassGroup(
  errorClass: string | null | undefined,
): ErrorClassGroup {
  const name = (errorClass ?? "").trim().replace(/^litellm\./, "");
  if (name === "") return "notReported";
  return GROUP_BY_CLASS.get(name) ?? "other";
}

/** One time bucket of the period, as the bucket query returns it. */
export type BucketRow = {
  bucket: number;
  calls: number;
  failed: number;
  /** The newest arrival in the bucket, as UTC ISO text. */
  newestReceivedAt: string | null;
};

type SeriesPoint = {
  /** The bucket's start, UTC ISO. */
  start: string;
  /** "2026-10-07" for a day, "2026-10-07 13:00" otherwise. */
  label: string;
  calls: number;
  failed: number;
};

/**
 * Every bucket of the period, zero where nothing was logged. A bucket index
 * past the last (a call stamped a little ahead of the console's clock) counts
 * in the last bucket; one before the first is dropped.
 */
export function failureSeries(
  range: WindowRange,
  rows: BucketRow[],
): SeriesPoint[] {
  const points: SeriesPoint[] = Array.from(
    { length: range.buckets },
    (_, i) => {
      const start = new Date(range.from.getTime() + i * range.bucketMs);
      const iso = start.toISOString();
      return {
        start: iso,
        label:
          range.bucketMs >= 24 * HOUR_MS
            ? iso.slice(0, 10)
            : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`,
        calls: 0,
        failed: 0,
      };
    },
  );
  for (const r of rows) {
    if (!Number.isFinite(r.bucket) || r.bucket < 0) continue;
    const point = points[Math.min(r.bucket, range.buckets - 1)];
    if (!point) continue;
    point.calls += r.calls;
    point.failed += r.failed;
  }
  return points;
}

/** The newest arrival over every bucket, or null without any call. */
export function newestArrival(rows: BucketRow[]): string | null {
  let newest: string | null = null;
  for (const r of rows) {
    if (r.newestReceivedAt && (!newest || r.newestReceivedAt > newest))
      newest = r.newestReceivedAt;
  }
  return newest;
}

/** One model's calls in the period, as the per-model query returns it. */
export type ModelRow = {
  model: string | null;
  calls: number;
  failed: number;
  /** Successful calls with both times, cache hits left out. */
  timedCalls: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** How many models had calls in the period (the same on every row). */
  models: number;
};

type ModelFailures = {
  /** The model group the caller asked for; null when none was logged. */
  model: string | null;
  calls: number;
  failed: number;
  /** As the Applications reliability check; "none" below 10 calls. */
  band: Band;
  /** Call duration; null below 10 timed calls. */
  p50Ms: number | null;
  p95Ms: number | null;
  timedCalls: number;
};

/**
 * Each model's failed calls against its calls, rated as the Applications
 * reliability check (failed calls from 2% Watch, over 5% Act now, at least
 * 10 calls). Durations are shown only from 10 timed calls.
 */
export function failuresByModel(rows: ModelRow[]): {
  shown: ModelFailures[];
  total: number;
} {
  const t = SCORECARD_THRESHOLDS;
  const shown = rows.slice(0, MODELS_SHOWN).map((r) => {
    const enough = r.calls >= t.minCallsForRates;
    const timed = r.timedCalls >= t.minCallsForRates;
    return {
      model: r.model,
      calls: r.calls,
      failed: r.failed,
      band: enough
        ? bandAbove((100 * r.failed) / r.calls, t.errorPct)
        : ("none" as Band),
      p50Ms: timed ? r.p50Ms : null,
      p95Ms: timed ? r.p95Ms : null,
      timedCalls: r.timedCalls,
    };
  });
  return { shown, total: rows[0]?.models ?? 0 };
}

/** The period's failed calls grouped by error class, as Prisma returns them. */
type ClassGroupRow = {
  errorClass: string | null;
  _count: { _all: number };
};

/**
 * Failed calls by error-class group, largest first, empty groups left out.
 * Classes past the query's cap are counted under "Other class", so the
 * groups always add up to the period's failed calls.
 */
export function failuresByClass(
  rows: ClassGroupRow[],
  totalFailed: number,
): { group: ErrorClassGroup; failed: number }[] {
  const counts = new Map<ErrorClassGroup, number>();
  let counted = 0;
  for (const r of rows) {
    const group = errorClassGroup(r.errorClass);
    counts.set(group, (counts.get(group) ?? 0) + r._count._all);
    counted += r._count._all;
  }
  if (totalFailed > counted)
    counts.set("other", (counts.get("other") ?? 0) + totalFailed - counted);
  return ERROR_CLASS_ORDER.map((group) => ({
    group,
    failed: counts.get(group) ?? 0,
  }))
    .filter((g) => g.failed > 0)
    .sort((a, b) => b.failed - a.failed);
}

/** Failed calls refused on a limit: rate limits and budgets. */
export function limitRefusals(
  byClass: { group: ErrorClassGroup; failed: number }[],
): number {
  return byClass
    .filter((g) => LIMIT_GROUPS.includes(g.group))
    .reduce((sum, g) => sum + g.failed, 0);
}

/** Calls and failed calls from the mirror's rows grouped by status. */
export function callTotals(
  rows: { status: string; _count: { _all: number } }[],
): { calls: number; failed: number } {
  let calls = 0;
  let failed = 0;
  for (const r of rows) {
    calls += r._count._all;
    // As the Applications page: anything but "success" did not succeed.
    if (r.status !== "success") failed += r._count._all;
  }
  return { calls, failed };
}

/** A newest failed call, as read: metadata only. */
type FailedCallRow = {
  startTime: Date;
  model: string | null;
  modelGroup: string | null;
  keyAlias: string | null;
  errorClass: string | null;
};

type FailedCall = {
  time: string;
  model: string | null;
  /** The calling key's alias: metadata, never key material. */
  alias: string | null;
  /** Where the alias is an application's key. */
  application: ApplicationRef | null;
  group: ErrorClassGroup;
};

/** The newest failed calls, each with its application where one resolves. */
export function latestFailures(
  rows: FailedCallRow[],
  byAlias: Map<string, ApplicationRef> | null,
): FailedCall[] {
  return rows.slice(0, LATEST_FAILED_SHOWN).map((r) => ({
    time: r.startTime.toISOString(),
    model: r.modelGroup ?? r.model,
    alias: r.keyAlias,
    application:
      r.keyAlias && byAlias ? (byAlias.get(r.keyAlias) ?? null) : null,
    group: errorClassGroup(r.errorClass),
  }));
}

// ---------------------------------------------------------------------------
// The mirror's freshness
// ---------------------------------------------------------------------------

/** The last successful reconciliation, as read. */
type ReconcileRow = {
  finishedAt: Date;
  windowEnd: Date;
  gapCount: number;
};

type MirrorView = {
  state: MirrorState;
  expectedLagMinutes: number;
  /** Complete up to here: the end of the last reconciled window. */
  completeTo: string | null;
  lastReconciledAt: string | null;
  /** Calls the last reconciliation found missing and added. */
  lastGapCount: number | null;
  /** The newest call of this project in the period to reach the mirror. */
  newestArrival: string | null;
};

/**
 * The mirror's freshness: within the expected lag while reconciliation
 * succeeds; behind once no pass has succeeded for 15 minutes, as the Gateway
 * requests log says.
 */
export function mirrorView(
  lastSuccess: ReconcileRow | null,
  newest: string | null,
  now: Date,
): MirrorView {
  const base = {
    expectedLagMinutes: MIRROR_EXPECTED_LAG_MINUTES,
    newestArrival: newest,
  };
  if (!lastSuccess) {
    return {
      ...base,
      state: "noReconciliation",
      completeTo: null,
      lastReconciledAt: null,
      lastGapCount: null,
    };
  }
  const stale =
    now.getTime() - lastSuccess.finishedAt.getTime() >
    MIRROR_STALE_AFTER_MINUTES * 60_000;
  return {
    ...base,
    state: stale ? "behind" : "withinLag",
    completeTo: lastSuccess.windowEnd.toISOString(),
    lastReconciledAt: lastSuccess.finishedAt.toISOString(),
    lastGapCount: lastSuccess.gapCount,
  };
}
