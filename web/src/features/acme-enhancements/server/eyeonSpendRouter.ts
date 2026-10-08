/**
 * ACME (CHG-2026-143, ADR-0027): the EYEON Cost and usage page. One query for
 * the page (`summary`) and one for its navigation entry (`status`), both
 * read-only.
 *
 * Who sees it: the gateway Spend tab's read rule, llmGatewaySpend:read
 * (Owner, Admin, Prompt Analyst, Viewer and Business Analyst), checked before
 * any read. The Business Analyst reaches it through its content-free
 * allow-list; the Auditor and the Security Analyst hold neither the scope
 * nor an entry. Behind CAIRO_EYEON_SPEND_ENABLED, default off: then
 * `summary` reads nothing and says so, and the navigation entry is hidden.
 *
 * Metadata only, at most eight reads whatever the data, all from Postgres:
 * this page never calls the gateway (the classic Spend tab does).
 *  - the project's gateway keys: lineage, generation, name, alias, status,
 *    team, budget and budget period; and its teams' id and alias;
 *  - from the request-log mirror: spend and calls per UTC day of the month
 *    so far; per time bucket of the chosen period, calls, failed calls,
 *    spend, tokens and cache flags; per model (capped in the database); per
 *    key alias; and the previous period's totals by status;
 *  - the mirror's last successful reconciliation (gateway-wide, as the
 *    Gateway requests log shows it).
 * No prompt or answer text, error text, token hash, key secret, end user or
 * source address is read; the tests assert on every select, group and SQL
 * statement. The figures are shaped in eyeonSpend.ts.
 */
import { z } from "zod";
import { type ProjectScope } from "@langfuse/shared";
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
  mirrorView,
  newestArrival,
  windowRange,
} from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";
import {
  type MonthDayRow,
  SPEND_MODELS_SHOWN,
  type SpendBucketRow,
  type SpendModelRow,
  keyBudgets,
  monthToDate,
  monthWindow,
  previousTotals,
  spendBreakdowns,
  spendByModel,
  spendRatios,
  spendSeries,
  spendTotals,
} from "@/src/features/acme-enhancements/server/eyeonSpend";
import { SPEND_WINDOWS } from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";

/** The gateway Spend tab's read rule. */
export const SPEND_READ_SCOPES: ProjectScope[] = ["llmGatewaySpend:read"];

/** A gateway key, as the breakdowns and budgets need it. */
const SPEND_KEY_SELECT = {
  lineageId: true,
  generation: true,
  displayName: true,
  litellmKeyAlias: true,
  status: true,
  litellmTeamId: true,
  maxBudget: true,
  budgetDuration: true,
} satisfies Prisma.AcmeLitellmKeySelect;

/** A gateway team: its id and alias only. */
const SPEND_TEAM_SELECT = {
  id: true,
  teamAlias: true,
} satisfies Prisma.AcmeLitellmTeamSelect;

/** The last good reconciliation: when, up to when, how many it added. */
const RECONCILE_SELECT = {
  finishedAt: true,
  windowEnd: true,
  gapCount: true,
} satisfies Prisma.AcmeLitellmReconcileRunSelect;

function spendPageEnabled(): boolean {
  return env.CAIRO_EYEON_SPEND_ENABLED === "true";
}

export const eyeonSpendRouter = createTRPCRouter({
  /**
   * Whether the page is switched on, for the navigation entry. The flag is
   * server-only, so the client has to ask (as for the other EYEON entries).
   * Reads no database.
   */
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, SPEND_READ_SCOPES);
      return { enabled: spendPageEnabled() };
    }),

  summary: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        window: z.enum(SPEND_WINDOWS),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, SPEND_READ_SCOPES);
      if (!spendPageEnabled()) {
        return { enabled: false as const };
      }
      const { projectId } = input;
      // Gateway management holds the keys; the request log holds every
      // figure. Without both there is nothing to report, and the page says
      // so instead of showing zeros.
      const gatewayOn = env.CAIRO_LITELLM_MANAGEMENT_ENABLED === "true";
      const mirrorOn =
        gatewayOn && env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED === "true";
      // Links to pages this person may open; the page offers no other.
      const canOpen = (scopes: ProjectScope[]) =>
        scopes.some((scope) =>
          hasProjectAccess({ session: ctx.session, projectId, scope }),
        );
      const links = {
        applications: canOpen(APPLICATIONS_READ_SCOPES),
        gatewayHealth: canOpen(APPLICATIONS_READ_SCOPES),
      };
      const now = new Date();
      if (!mirrorOn) {
        return {
          enabled: true as const,
          window: input.window,
          generatedAt: now.toISOString(),
          gatewayManagement: gatewayOn,
          requestLog: false,
          links,
          mirror: null,
          month: null,
          period: null,
          breakdown: null,
          budgets: null,
        };
      }

      const range = windowRange(input.window, now);
      const month = monthWindow(now);
      // Call times are stamped by the gateway: a far-future one is ignored,
      // as event times are on the Guardrails page (SF-2026-026).
      const until = new Date(now.getTime() + EVENT_FUTURE_SKEW_MS);
      const period = { gte: range.from, lte: until };
      // Timestamps are stored as UTC without a zone, so the bounds are
      // passed as UTC text and cast the same way.
      const fromText = range.from.toISOString();
      const monthText = month.start.toISOString();
      const untilText = until.toISOString();
      const bucketSeconds = range.bucketMs / 1_000;

      const [
        keys,
        teams,
        monthRows,
        bucketRows,
        modelRows,
        aliasRows,
        previousRows,
        lastReconcile,
      ] = await Promise.all([
        ctx.prisma.acmeLitellmKey.findMany({
          where: { projectId, status: { in: USED_STATUSES } },
          select: SPEND_KEY_SELECT,
        }),
        ctx.prisma.acmeLitellmTeam.findMany({
          where: { projectId },
          select: SPEND_TEAM_SELECT,
        }),
        // Spend and calls per UTC day of the calendar month so far. Bound
        // parameters only, scoped to this project and the month.
        ctx.prisma.$queryRaw<MonthDayRow[]>(Prisma.sql`
          SELECT to_char(date_trunc('day', start_time), 'YYYY-MM-DD') AS day,
                 COALESCE(SUM(spend), 0)::float8 AS spend,
                 COUNT(*)::int AS calls
          FROM acme_litellm_request_logs
          WHERE project_id = ${projectId}
            AND start_time >= ${monthText}::timestamp
            AND start_time <= ${untilText}::timestamp
          GROUP BY 1`),
        // Per time bucket of the period, counted from its start: calls,
        // failed calls (as the Applications page: any status but
        // "success"), spend, tokens, cache flags and the newest arrival.
        ctx.prisma.$queryRaw<SpendBucketRow[]>(Prisma.sql`
          SELECT FLOOR(EXTRACT(EPOCH FROM (start_time - ${fromText}::timestamp)) / ${bucketSeconds}::int)::int AS bucket,
                 COUNT(*)::int AS calls,
                 (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed,
                 COALESCE(SUM(spend), 0)::float8 AS spend,
                 COALESCE(SUM(prompt_tokens), 0)::float8 AS "promptTokens",
                 COALESCE(SUM(completion_tokens), 0)::float8 AS "completionTokens",
                 COALESCE(SUM(total_tokens), 0)::float8 AS "totalTokens",
                 (COUNT(*) FILTER (WHERE cache_hit IS TRUE))::int AS "cacheHits",
                 (COUNT(*) FILTER (WHERE cache_hit IS NOT NULL))::int AS "cacheReported",
                 to_char(MAX(received_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "newestReceivedAt"
          FROM acme_litellm_request_logs
          WHERE project_id = ${projectId}
            AND start_time >= ${fromText}::timestamp
            AND start_time <= ${untilText}::timestamp
          GROUP BY 1`),
        // Per model, the costliest first, capped in the database with the
        // number of models beside each row. Ordered by position: the
        // fourth column is the summed spend, the second the calls.
        ctx.prisma.$queryRaw<SpendModelRow[]>(Prisma.sql`
          SELECT COALESCE(model_group, model) AS model,
                 COUNT(*)::int AS calls,
                 (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed,
                 COALESCE(SUM(spend), 0)::float8 AS spend,
                 COALESCE(SUM(total_tokens), 0)::float8 AS "totalTokens",
                 (COUNT(*) OVER ())::int AS models
          FROM acme_litellm_request_logs
          WHERE project_id = ${projectId}
            AND start_time >= ${fromText}::timestamp
            AND start_time <= ${untilText}::timestamp
          GROUP BY 1
          ORDER BY 4 DESC, 2 DESC, 1 ASC NULLS LAST
          LIMIT ${SPEND_MODELS_SHOWN}`),
        // Per key alias: one row per key this project issued.
        ctx.prisma.acmeLitellmRequestLog.groupBy({
          by: ["keyAlias"],
          where: { projectId, startTime: period },
          _count: { _all: true },
          _sum: { spend: true, totalTokens: true },
        }),
        // The previous period of the same length, for the change.
        ctx.prisma.acmeLitellmRequestLog.groupBy({
          by: ["status"],
          where: {
            projectId,
            startTime: { gte: range.previousFrom, lt: range.from },
          },
          _count: { _all: true },
          _sum: { spend: true },
        }),
        // Gateway-wide by nature: the mirror is reconciled as a whole.
        ctx.prisma.acmeLitellmReconcileRun.findFirst({
          where: { status: "success" },
          orderBy: { finishedAt: "desc" },
          select: RECONCILE_SELECT,
        }),
      ]);

      const totals = spendTotals(bucketRows);
      const previous = previousTotals(previousRows);
      return {
        enabled: true as const,
        window: input.window,
        generatedAt: now.toISOString(),
        gatewayManagement: true,
        requestLog: true,
        links,
        mirror: mirrorView(
          lastReconcile ?? null,
          newestArrival(bucketRows),
          now,
        ),
        month: monthToDate(monthRows, now),
        period: {
          from: range.from.toISOString(),
          bucketMinutes: range.bucketMs / 60_000,
          series: spendSeries(range, bucketRows),
          totals,
          previous,
          ...spendRatios(totals),
        },
        breakdown: {
          model: spendByModel(modelRows, totals),
          ...spendBreakdowns(keys, teams, aliasRows, totals.spendUsd),
        },
        budgets: keyBudgets(keys, aliasRows),
      };
    }),
});
