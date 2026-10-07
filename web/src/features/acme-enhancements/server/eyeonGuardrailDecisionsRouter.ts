/**
 * ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page. One
 * query for the page (`summary`) and one for its navigation entry
 * (`status`), both read-only.
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
 * Metadata only, at most seven reads whatever the data: the decisions
 * grouped by direction, verdict and the mode the gateway reported; one daily
 * series by verdict; the refusals grouped by policy label, direction and
 * mode; the agents with the most refusals (capped in the database); the
 * judge's no-verdict rate over 24 hours; the guardrail settings in force (for
 * the mode); and, for a viewer who may open Applications, the project's
 * gateway keys' lineage, name and status. No prompt or answer text, redacted
 * text, personal-data findings, encrypted content or token hash is read; the
 * tests assert on every select, group and SQL statement. The figures are
 * shaped in eyeonGuardrailDecisions.ts.
 */
import { z } from "zod";
import { AcmeGuardrailEventAction, Prisma } from "@langfuse/shared/src/db";
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
  dailyVerdicts,
  decisionsByDirection,
  refusalsByType,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";

/** How many of the agents with the most refusals the page lists. */
export const BUSIEST_SHOWN = 5;

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
        windowDays: z.union([z.literal(7), z.literal(30)]),
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

      const [groups, dailyRows, refusalGroups, busiestRows, judge, settings] =
        await Promise.all([
          ctx.prisma.acmeGuardrailEvent.groupBy({
            by: ["direction", "action", "gatewayMode"],
            where: { projectId, eventTime: period },
            _count: { _all: true },
          }),
          // A day bucket needs raw SQL; bound parameters only, scoped to this
          // project and the period. Timestamps are stored as UTC without a
          // zone, so the bounds are passed as UTC text and cast the same way.
          // Only a reported "enforce" counts as applied (CHG-2026-116).
          ctx.prisma.$queryRaw<DailyVerdicts[]>(Prisma.sql`
            SELECT to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
                   COUNT(*)::int AS checks,
                   (COUNT(*) FILTER (WHERE action = 'allow'))::int AS allowed,
                   (COUNT(*) FILTER (WHERE action = 'block' AND gateway_mode = 'enforce'))::int AS blocked,
                   (COUNT(*) FILTER (WHERE action = 'block' AND gateway_mode IS DISTINCT FROM 'enforce'))::int AS "wouldBlock",
                   (COUNT(*) FILTER (WHERE action = 'redact' AND gateway_mode = 'enforce'))::int AS redacted,
                   (COUNT(*) FILTER (WHERE action = 'redact' AND gateway_mode IS DISTINCT FROM 'enforce'))::int AS "wouldRedact",
                   (COUNT(*) FILTER (WHERE action = 'unavailable'))::int AS "noVerdict"
            FROM acme_guardrail_events
            WHERE project_id = ${projectId}
              AND event_time >= ${dailyFrom.toISOString()}::timestamp
              AND event_time <= ${until.toISOString()}::timestamp
            GROUP BY 1`),
          // Refusals by the guardrail's policy label: the label only, never
          // shown as text (refusalsByType maps it to a type).
          ctx.prisma.acmeGuardrailEvent.groupBy({
            by: ["policyTriggered", "direction", "gatewayMode"],
            where: {
              projectId,
              eventTime: period,
              action: AcmeGuardrailEventAction.BLOCK,
            },
            _count: { _all: true },
          }),
          // The agents with the most refusals, capped in the database, with
          // their checks and how many agents had a refusal at all. Bound
          // parameters only, scoped to this project and the period.
          ctx.prisma.$queryRaw<BusiestRow[]>(Prisma.sql`
            SELECT agent_id AS alias,
                   COUNT(*)::int AS checks,
                   (COUNT(*) FILTER (WHERE action = 'block'))::int AS refusals,
                   (COUNT(*) FILTER (WHERE action = 'block' AND gateway_mode = 'enforce'))::int AS "refusalsEnforced",
                   (COUNT(*) OVER ())::int AS "withRefusals"
            FROM acme_guardrail_events
            WHERE project_id = ${projectId}
              AND event_time >= ${since.toISOString()}::timestamp
              AND event_time <= ${until.toISOString()}::timestamp
            GROUP BY agent_id
            HAVING COUNT(*) FILTER (WHERE action = 'block') > 0
            ORDER BY refusals DESC, alias ASC
            LIMIT ${BUSIEST_SHOWN}`),
          judgeAvailability(ctx.prisma, { projectId, now }),
          getCurrentSettings(ctx.prisma),
        ]);
      // The keys only for a viewer who may open an application, and only
      // when there is an agent to link. Lineage, name and status: no token
      // hash, no settings.
      const keys =
        linksApplications && busiestRows.length > 0
          ? await ctx.prisma.acmeLitellmKey.findMany({
              where: { projectId, status: { in: USED_STATUSES } },
              select: KEY_SELECT,
            })
          : null;

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
        totals: decisionTotals(groups),
        byDirection: decisionsByDirection(groups),
        daily: dailyVerdicts(dailyFrom, input.windowDays, dailyRows),
        refusalsByType: refusalsByType(refusalGroups),
        busiest: {
          ...busiestApplications(
            busiestRows,
            keys ? applicationsByAlias(keys) : null,
          ),
          limit: BUSIEST_SHOWN,
          linksApplications,
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
