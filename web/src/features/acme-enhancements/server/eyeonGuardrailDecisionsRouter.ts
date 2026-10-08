/**
 * ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page. One
 * query for the page (`summary`) and one for its navigation entry
 * (`status`), both read-only. CHG-2026-137 adds the page filters, the
 * decision flow's figures, the policy type by direction breakdown, the
 * callers a filter can choose and the personal-data types.
 *
 * Who sees it: the guardrail decision log's rule, projectGuardrails:read
 * (Owner, Admin, Security Analyst, Auditor), checked before any read. The
 * link from a busy agent to its application's screen is offered only to a
 * viewer who may open the Applications page (llmGateway:read or
 * evidence:read) while gateway management is on; for anyone else the keys
 * are not read. Behind CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED, default off:
 * then `summary` reads nothing and says so, and the navigation entry is
 * hidden.
 *
 * Filters (validated here, from utils/eyeonDecisionFilters.ts): direction,
 * verdict, caller, policy type and applied or recorded. They are applied in
 * the same reads, never by reading more: the caller narrows every read's
 * scope; the other four are dimensions of the grouped read, so they are
 * applied to its groups here, and the SQL reads take them as conditions. The
 * policy type of a label is decided by the scorecard's mapping on the
 * grouped read, and the SQL matches those labels. Rates per 100 checks keep
 * every check of the period and caller as their base.
 *
 * Metadata only, at most eight reads whatever the data and the filters: the
 * decisions grouped by direction, verdict, mode and policy label; the
 * callers with the most checks (capped in the database); the judge's
 * no-verdict rate over 24 hours; the guardrail settings in force (for the
 * mode); one daily series by verdict (which also carries, for the KPI
 * tiles' charts, the matching decisions, those in enforce mode and the block
 * verdicts by direction: counts, in the same read); the agents ranked by
 * refusals or the chosen verdict (capped in the database); redactions per
 * personal-data entity type (counted in the database: only a known type
 * name and a count leave it); and, for a viewer who may open Applications,
 * the project's gateway keys' lineage, name and status. No prompt or answer
 * text, redacted text, finding position, score or matched text, encrypted
 * content or token hash is read; the tests assert on every select, group and
 * SQL statement.
 * The figures are shaped in eyeonGuardrailDecisions.ts.
 */
import { z } from "zod";
import { type Prisma } from "@langfuse/shared/src/db";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import {
  hasProjectAccess,
  throwIfNoProjectAccess,
} from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import {
  APPLICATIONS_READ_SCOPES,
  USED_STATUSES,
} from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";
import {
  EVENT_FUTURE_SKEW_MS,
  getCurrentSettings,
  judgeAvailability,
  parseModeCeiling,
  servedMode,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import { trendStart } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { decisionTotals } from "@/src/features/acme-enhancements/server/eyeonOverview";
import {
  type BusiestRow,
  type DailyVerdicts,
  applicationsByAlias,
  busiestApplications,
  callerOptions,
  dailyVerdicts,
  decisionsByDirection,
  entityTypeCounts,
  matchesFilters,
  policyByDirection,
  policyLabelsOf,
  scopeChecks,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  busiestSql,
  dailySql,
  entityTypesSql,
  kindConditionSql,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisionsSql";
import {
  APPLIED_FILTERS,
  CALLER_FILTER_MAX_LENGTH,
  DIRECTION_FILTERS,
  POLICY_TYPE_FILTERS,
  VERDICT_FILTERS,
  WINDOW_DAYS,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";

/** How many of the agents with the most refusals the page lists. */
export const BUSIEST_SHOWN = 5;

/** How many callers the application filter offers, most checks first. */
export const CALLERS_LISTED = 50;

/** The scope of the guardrail decision log, which this page summarises. */
const DECISIONS_READ_SCOPE = "projectGuardrails:read" as const;

/** A gateway key, as far as the link to its application needs it. */
const KEY_SELECT = {
  lineageId: true,
  generation: true,
  displayName: true,
  litellmKeyAlias: true,
  status: true,
} satisfies Prisma.AcmeLitellmKeySelect;

/** The page filters; anything not listed here is refused. */
export const DecisionFiltersSchema = z
  .object({
    direction: z.enum(DIRECTION_FILTERS).optional(),
    verdict: z.enum(VERDICT_FILTERS).optional(),
    caller: z.string().trim().min(1).max(CALLER_FILTER_MAX_LENGTH).optional(),
    policyType: z.enum(POLICY_TYPE_FILTERS).optional(),
    applied: z.enum(APPLIED_FILTERS).optional(),
  })
  .strict();

function decisionsEnabled(): boolean {
  return env.CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED === "true";
}

export const eyeonGuardrailDecisionsRouter = createTRPCRouter({
  /**
   * Whether the page is switched on, for the navigation entry. The flag is
   * server-only, so the client has to ask (as for the overview's entry).
   * Reads no database.
   */
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: DECISIONS_READ_SCOPE,
      });
      return { enabled: decisionsEnabled() };
    }),

  summary: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        windowDays: z.union([
          z.literal(WINDOW_DAYS[0]),
          z.literal(WINDOW_DAYS[1]),
        ]),
        filters: DecisionFiltersSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: DECISIONS_READ_SCOPE,
      });
      if (!decisionsEnabled()) {
        return { enabled: false as const };
      }
      const { projectId } = input;
      const filters = input.filters ?? {};
      const { caller } = filters;
      // An application's screen exists only while gateway management is on,
      // and opens only for the Applications page's roles: link to it, and
      // read the keys to do so, only then.
      const linksApplications =
        env.CAIRO_LITELLM_MANAGEMENT_ENABLED === "true" &&
        APPLICATIONS_READ_SCOPES.some((scope) =>
          hasProjectAccess({ session: ctx.session, projectId, scope }),
        );
      const now = new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000);
      // Event times are pushed by the guardrail service: a far-future one is
      // ignored, as on the Guardrails page (SF-2026-026).
      const until = new Date(now.getTime() + EVENT_FUTURE_SKEW_MS);
      // One point per UTC day, the last windowDays days including today.
      const dailyFrom = trendStart(now, input.windowDays);
      const period = { gte: since, lte: until };

      // First the grouped read, whose groups carry every filtered dimension
      // and the policy labels the SQL reads match.
      const [groups, callerRows, judge, settings] = await Promise.all([
        ctx.prisma.acmeGuardrailEvent.groupBy({
          by: ["direction", "action", "gatewayMode", "policyTriggered"],
          where: {
            projectId,
            eventTime: period,
            ...(caller ? { agentId: caller } : {}),
          },
          _count: { _all: true },
        }),
        // The callers a filter can choose: every one in the period, whatever
        // the other filters, busiest first, capped in the database.
        ctx.prisma.acmeGuardrailEvent.groupBy({
          by: ["agentId"],
          where: { projectId, eventTime: period },
          _count: { _all: true },
          orderBy: [{ _count: { agentId: "desc" } }, { agentId: "asc" }],
          take: CALLERS_LISTED,
        }),
        // The judge's alert figure covers all of the project's traffic over
        // 24 hours, as on the Guardrails page; the filters do not apply.
        judgeAvailability(ctx.prisma, { projectId, now }),
        getCurrentSettings(ctx.prisma),
      ]);

      const matching = groups.filter((g) => matchesFilters(g, filters));
      const kind = kindConditionSql(
        filters,
        filters.policyType ? policyLabelsOf(groups, filters.policyType) : null,
      );
      // The busiest card ranks by refusals, or by the verdict chosen.
      const busiestVerdict = filters.verdict ?? "block";
      const sqlScope = { projectId, until, caller };

      const [dailyRows, busiestRows, entityRows] = await Promise.all([
        // A day bucket needs raw SQL; bound parameters only, scoped to this
        // project and the period. Timestamps are stored as UTC without a
        // zone, so the bounds are passed as UTC text and cast the same way.
        // Only a reported "enforce" counts as applied (CHG-2026-116).
        ctx.prisma.$queryRaw<DailyVerdicts[]>(
          dailySql({ ...sqlScope, from: dailyFrom }, kind),
        ),
        ctx.prisma.$queryRaw<BusiestRow[]>(
          busiestSql(
            { ...sqlScope, from: since },
            kind,
            busiestVerdict,
            BUSIEST_SHOWN,
          ),
        ),
        // Only (type, count) rows, at most one per type the page names.
        ctx.prisma.$queryRaw<{ type: unknown; count: unknown }[]>(
          entityTypesSql({ ...sqlScope, from: since }, kind),
        ),
      ]);
      // The keys only for a viewer who may open an application, and only
      // when there is an agent to name. Lineage, name and status: no token
      // hash, no settings.
      const keys =
        linksApplications && (busiestRows.length > 0 || callerRows.length > 0)
          ? await ctx.prisma.acmeLitellmKey.findMany({
              where: { projectId, status: { in: USED_STATUSES } },
              select: KEY_SELECT,
            })
          : null;
      const applications = keys ? applicationsByAlias(keys) : null;

      const ceiling = parseModeCeiling(env.CAIRO_GUARDRAIL_MODE_MAX);
      return {
        enabled: true as const,
        windowDays: input.windowDays,
        generatedAt: now.toISOString(),
        mode: {
          // Null when no guardrail settings are stored yet ("Not reported").
          mode: settings ? servedMode(settings, now, ceiling) : null,
          ceiling,
        },
        /** Every check in the period and scope: the base of each rate. */
        scope: scopeChecks(groups),
        /** The decisions that match the filters. */
        totals: decisionTotals(matching),
        byDirection: decisionsByDirection(matching),
        daily: dailyVerdicts(dailyFrom, input.windowDays, dailyRows),
        policyByDirection: policyByDirection(matching),
        busiest: {
          ...busiestApplications(busiestRows, applications),
          verdict: busiestVerdict,
          limit: BUSIEST_SHOWN,
          linksApplications,
        },
        entityTypes: entityTypeCounts(entityRows),
        callers: {
          listed: callerOptions(callerRows, applications),
          limit: CALLERS_LISTED,
        },
        judge: {
          windowHours: judge.windowHours,
          checks: judge.calls,
          noVerdict: judge.unavailable,
          rate: judge.rate,
          alertRate: judge.alertRate,
          alert: judge.alert,
        },
      };
    }),
});
