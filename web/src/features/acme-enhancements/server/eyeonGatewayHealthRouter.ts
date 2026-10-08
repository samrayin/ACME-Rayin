/**
 * ACME (CHG-2026-139, ADR-0027): the EYEON Gateway health page. One query
 * for the page (`summary`) and one for its navigation entry (`status`), both
 * read-only.
 *
 * Who sees it: the LLM Gateway page's read rule for models and keys,
 * llmGateway:read (Owner, Admin) or evidence:read (Auditor), checked before
 * any read, as for Applications and the overview. The newest failed calls
 * are individual requests, so they are read only with the request log's own
 * scope, llmGatewayLogs:read, as on an application's screen. Behind
 * CAIRO_EYEON_GATEWAY_HEALTH_ENABLED, default off: then `summary` reads
 * nothing and says so, and the navigation entry is hidden.
 *
 * Point in time and metadata only, at most nine reads whatever the data:
 *  - model health: the last health check the LLM Gateway page stored (its
 *    catalogue snapshot). This page never calls the gateway or a provider;
 *  - the project's gateway keys' lineage, name, alias, status, model list and
 *    team (how many applications, whose key a failed call used, and, since
 *    the CHG-2026-139 follow-up, which applications may call each model), and
 *    the project's teams' model lists;
 *  - from the request-log mirror, for the chosen period: calls and failures
 *    per model with call durations (capped in the database), per time
 *    bucket, by error class (capped), and the previous period's totals; the
 *    newest failed calls (time, model, key alias, error class);
 *  - the mirror's last successful reconciliation (gateway-wide, as the
 *    Gateway requests log shows it).
 * No prompt or answer text, error text, token hash, key secret, end user,
 * source address or spend is read; the tests assert on every select, group
 * and SQL statement. The figures are shaped in eyeonGatewayHealth.ts.
 */
import { z } from "zod";
import { Prisma } from "@langfuse/shared/src/db";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { hasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import {
  APPLICATIONS_READ_SCOPES,
  USED_STATUSES,
  throwIfNoneOf,
} from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";
import { EVENT_FUTURE_SKEW_MS } from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  type BucketRow,
  CATALOGUE_SNAPSHOT_KEY,
  LATEST_FAILED_SHOWN,
  MODELS_SHOWN,
  type ModelRow,
  applicationIndex,
  callTotals,
  failureSeries,
  failuresByClass,
  failuresByModel,
  healthView,
  latestFailures,
  limitRefusals,
  mirrorView,
  newestArrival,
  windowRange,
  withRoutes,
} from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";
import { GATEWAY_HEALTH_WINDOWS } from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";

/** How many distinct error classes the class query returns at most. */
const CLASSES_READ = 50;

/**
 * A gateway key, as far as the application count, the links and the route
 * map need it: CHG-2026-139 follow-up adds the models it may call and its
 * team, so each model shows which applications route to it.
 */
const GATEWAY_HEALTH_KEY_SELECT = {
  lineageId: true,
  generation: true,
  displayName: true,
  litellmKeyAlias: true,
  status: true,
  models: true,
  litellmTeamId: true,
} satisfies Prisma.AcmeLitellmKeySelect;

/** A gateway team: its id and the models it allows, nothing else. */
const GATEWAY_HEALTH_TEAM_SELECT = {
  id: true,
  models: true,
} satisfies Prisma.AcmeLitellmTeamSelect;

/** A newest failed call: when, which model, which key alias, which class. */
const FAILED_CALL_SELECT = {
  startTime: true,
  model: true,
  modelGroup: true,
  keyAlias: true,
  errorClass: true,
} satisfies Prisma.AcmeLitellmRequestLogSelect;

/** The last good reconciliation: when, up to when, how many it added. */
const RECONCILE_SELECT = {
  finishedAt: true,
  windowEnd: true,
  gapCount: true,
} satisfies Prisma.AcmeLitellmReconcileRunSelect;

function gatewayHealthEnabled(): boolean {
  return env.CAIRO_EYEON_GATEWAY_HEALTH_ENABLED === "true";
}

export const eyeonGatewayHealthRouter = createTRPCRouter({
  /**
   * Whether the page is switched on, for the navigation entry. The flag is
   * server-only, so the client has to ask (as for the overview's entry).
   * Reads no database.
   */
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, APPLICATIONS_READ_SCOPES);
      return { enabled: gatewayHealthEnabled() };
    }),

  summary: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        window: z.enum(GATEWAY_HEALTH_WINDOWS),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, APPLICATIONS_READ_SCOPES);
      if (!gatewayHealthEnabled()) {
        return { enabled: false as const };
      }
      const { projectId } = input;
      const can = (scope: "llmGatewayLogs:read" | "llmGateway:CUD") =>
        hasProjectAccess({ session: ctx.session, projectId, scope });
      // Gateway management holds the models and the keys; without it there
      // is nothing to report, and the page says so instead of showing zeros.
      const gatewayOn = env.CAIRO_LITELLM_MANAGEMENT_ENABLED === "true";
      // The mirror is read only where the Gateway requests log is on.
      const mirrorOn =
        gatewayOn && env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED === "true";
      const canSeeCalls = can("llmGatewayLogs:read");
      const now = new Date();
      const range = windowRange(input.window, now);
      // Call times are stamped by the gateway: a far-future one is ignored,
      // as event times are on the Guardrails page (SF-2026-026).
      const until = new Date(now.getTime() + EVENT_FUTURE_SKEW_MS);
      const period = { gte: range.from, lte: until };
      const fromText = range.from.toISOString();
      const untilText = until.toISOString();
      const bucketSeconds = range.bucketMs / 1_000;

      const [
        snapshot,
        keys,
        teams,
        modelRows,
        bucketRows,
        classRows,
        previousRows,
        failedRows,
        lastReconcile,
      ] = await Promise.all([
        // The last health check the LLM Gateway page stored. Its payload is
        // parsed here and its provider messages never leave the server.
        gatewayOn
          ? ctx.prisma.acmeLitellmSpendSnapshot.findUnique({
              where: { cacheKey: CATALOGUE_SNAPSHOT_KEY },
              select: { payload: true, fetchedAt: true },
            })
          : Promise.resolve(null),
        gatewayOn
          ? ctx.prisma.acmeLitellmKey.findMany({
              where: { projectId, status: { in: USED_STATUSES } },
              select: GATEWAY_HEALTH_KEY_SELECT,
            })
          : Promise.resolve(null),
        // The project's teams' model lists: a key with no list of its own
        // may call what its team allows (the route map).
        gatewayOn
          ? ctx.prisma.acmeLitellmTeam.findMany({
              where: { projectId },
              select: GATEWAY_HEALTH_TEAM_SELECT,
            })
          : Promise.resolve(null),
        // Calls, failures and durations per model, capped in the database
        // with the number of models beside each row. Bound parameters only,
        // scoped to this project and the period. Timestamps are stored as
        // UTC without a zone, so the bounds are passed as UTC text and cast
        // the same way. A call fails as on the Applications page: any status
        // but "success". Durations: successful calls with both times, cache
        // hits left out.
        mirrorOn
          ? ctx.prisma.$queryRaw<ModelRow[]>(Prisma.sql`
              SELECT COALESCE(model_group, model) AS model,
                     COUNT(*)::int AS calls,
                     (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed,
                     (COUNT(*) FILTER (WHERE status = 'success' AND end_time >= start_time AND cache_hit IS NOT TRUE))::int AS "timedCalls",
                     (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (end_time - start_time)) * 1000)
                       FILTER (WHERE status = 'success' AND end_time >= start_time AND cache_hit IS NOT TRUE))::float8 AS "p50Ms",
                     (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (end_time - start_time)) * 1000)
                       FILTER (WHERE status = 'success' AND end_time >= start_time AND cache_hit IS NOT TRUE))::float8 AS "p95Ms",
                     (COUNT(*) OVER ())::int AS models
              FROM acme_litellm_request_logs
              WHERE project_id = ${projectId}
                AND start_time >= ${fromText}::timestamp
                AND start_time <= ${untilText}::timestamp
              GROUP BY 1
              ORDER BY calls DESC, model ASC NULLS LAST
              LIMIT ${MODELS_SHOWN}`)
          : Promise.resolve(null),
        // Calls and failures per time bucket, counted from the period's
        // start, with the newest arrival. Bound parameters only, scoped to
        // this project and the period.
        mirrorOn
          ? ctx.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
              SELECT FLOOR(EXTRACT(EPOCH FROM (start_time - ${fromText}::timestamp)) / ${bucketSeconds}::int)::int AS bucket,
                     COUNT(*)::int AS calls,
                     (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed,
                     to_char(MAX(received_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "newestReceivedAt"
              FROM acme_litellm_request_logs
              WHERE project_id = ${projectId}
                AND start_time >= ${fromText}::timestamp
                AND start_time <= ${untilText}::timestamp
              GROUP BY 1`)
          : Promise.resolve(null),
        // The period's failed calls by the gateway's error class, capped.
        mirrorOn
          ? ctx.prisma.acmeLitellmRequestLog.groupBy({
              by: ["errorClass"],
              where: {
                projectId,
                startTime: period,
                status: { not: "success" },
              },
              _count: { _all: true },
              orderBy: { _count: { requestId: "desc" } },
              take: CLASSES_READ,
            })
          : Promise.resolve(null),
        // The previous period of the same length, for the change.
        mirrorOn
          ? ctx.prisma.acmeLitellmRequestLog.groupBy({
              by: ["status"],
              where: {
                projectId,
                startTime: { gte: range.previousFrom, lt: range.from },
              },
              _count: { _all: true },
            })
          : Promise.resolve(null),
        // The newest failed calls: individual requests, so only with the
        // request log's scope.
        mirrorOn && canSeeCalls
          ? ctx.prisma.acmeLitellmRequestLog.findMany({
              where: {
                projectId,
                startTime: period,
                status: { not: "success" },
              },
              orderBy: [{ startTime: "desc" }, { id: "desc" }],
              take: LATEST_FAILED_SHOWN,
              select: FAILED_CALL_SELECT,
            })
          : Promise.resolve(null),
        // Gateway-wide by nature: the mirror is reconciled as a whole.
        mirrorOn
          ? ctx.prisma.acmeLitellmReconcileRun.findFirst({
              where: { status: "success" },
              orderBy: { finishedAt: "desc" },
              select: RECONCILE_SELECT,
            })
          : Promise.resolve(null),
      ]);

      const apps = keys ? applicationIndex(keys) : null;
      const series = bucketRows ? failureSeries(range, bucketRows) : null;
      const totals = series
        ? series.reduce(
            (t, p) => ({
              calls: t.calls + p.calls,
              failed: t.failed + p.failed,
            }),
            { calls: 0, failed: 0 },
          )
        : null;
      const byClass =
        classRows && totals ? failuresByClass(classRows, totals.failed) : null;

      return {
        enabled: true as const,
        window: input.window,
        generatedAt: now.toISOString(),
        gatewayManagement: gatewayOn,
        requestLog: mirrorOn,
        /** May check health now on the LLM Gateway page (Owner, Admin). */
        canCheckHealth: can("llmGateway:CUD"),
        // Null while gateway management is off: no models to report.
        // With each model, the applications whose key may call it.
        health: gatewayOn
          ? withRoutes(
              healthView(snapshot ?? null, now),
              keys ?? [],
              teams ?? [],
            )
          : null,
        applications: apps ? apps.count : null,
        // Null while the request log is off.
        mirror: mirrorOn
          ? mirrorView(
              lastReconcile ?? null,
              newestArrival(bucketRows ?? []),
              now,
            )
          : null,
        failures:
          series && totals && byClass
            ? {
                from: range.from.toISOString(),
                bucketMinutes: range.bucketMs / 60_000,
                calls: totals.calls,
                failed: totals.failed,
                previous: callTotals(previousRows ?? []),
                limitRefusals: limitRefusals(byClass),
                series,
                byModel: failuresByModel(modelRows ?? []),
                byClass,
                // Null without the request log's scope: not read at all.
                latest: failedRows
                  ? latestFailures(failedRows, apps ? apps.byAlias : null)
                  : null,
              }
            : null,
      };
    }),
});
