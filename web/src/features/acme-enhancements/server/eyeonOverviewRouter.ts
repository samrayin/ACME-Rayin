/**
 * ACME (CHG-2026-132, ADR-0027): the EYEON overview, the first EYEON-native
 * page. One query for the page (`summary`) and one for its navigation entry
 * (`status`), both read-only. CHG-2026-136 (ADR-0028) adds `homeStatus`:
 * whether the project home shows the overview, read the same way.
 *
 * Who sees it: the Applications page's rule, llmGateway:read (Owner, Admin)
 * or evidence:read (Auditor); spend only with llmGatewaySpend:read. Behind
 * CAIRO_EYEON_OVERVIEW_ENABLED, default off: then `summary` reads nothing and
 * says so, and the navigation entry is hidden.
 *
 * Metadata only, a fixed number of reads whatever the data: the applications'
 * scorecards (the Applications page's own loader, while gateway management
 * is on), this project's guardrail decisions grouped by direction, verdict
 * and the mode the gateway reported, one daily series of the same counts,
 * the judge's no-verdict rate over 24 hours, and the guardrail settings'
 * mode history. No prompt or answer text, redacted text, personal-data
 * findings or encrypted content is read; the tests assert on every select,
 * group and SQL statement. The figures are shaped in eyeonOverview.ts.
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
  loadApplicationScorecards,
  throwIfNoneOf,
} from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";
import {
  EVENT_FUTURE_SKEW_MS,
  getCurrentSettings,
  judgeAvailability,
  listModeChanges,
  parseModeCeiling,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import { trendStart } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import {
  type DailyDecisions,
  budgetUse,
  dailyDecisions,
  decisionTotals,
  overviewMode,
} from "@/src/features/acme-enhancements/server/eyeonOverview";

/** How many applications the spend card lists against their budgets. */
const BUDGETS_SHOWN = 5;

function overviewEnabled(): boolean {
  return env.CAIRO_EYEON_OVERVIEW_ENABLED === "true";
}

/** EYEON Home needs the overview: one flag on without the other is off. */
function homeEnabled(): boolean {
  return env.CAIRO_EYEON_HOME_ENABLED === "true" && overviewEnabled();
}

export const eyeonOverviewRouter = createTRPCRouter({
  /**
   * Whether the overview is switched on, for the navigation entry. The flag
   * is server-only, so the client has to ask (as for the LLM Gateway entry).
   * Reads no database.
   */
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, APPLICATIONS_READ_SCOPES);
      return { enabled: overviewEnabled() };
    }),

  /**
   * CHG-2026-136 (ADR-0028): whether the project home shows the overview, for
   * the home page. True only while CAIRO_EYEON_HOME_ENABLED and
   * CAIRO_EYEON_OVERVIEW_ENABLED are both on. Under the overview's own
   * access rule, so only a role that can open the overview gets it as Home.
   * Reads no database.
   */
  homeStatus: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, APPLICATIONS_READ_SCOPES);
      return { enabled: homeEnabled() };
    }),

  summary: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        windowDays: z.union([z.literal(7), z.literal(30)]),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, APPLICATIONS_READ_SCOPES);
      if (!overviewEnabled()) {
        return { enabled: false as const };
      }
      const canSeeSpend = hasProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewaySpend:read",
      });
      // Applications are gateway keys: without gateway management there are
      // none to rate, and the overview says so instead of showing zeros.
      const gatewayOn = env.CAIRO_LITELLM_MANAGEMENT_ENABLED === "true";
      const now = new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000);
      // Event times are pushed by the guardrail service: a far-future one is
      // ignored, as on the Guardrails page (SF-2026-026).
      const until = new Date(now.getTime() + EVENT_FUTURE_SKEW_MS);
      // One point per UTC day, the last windowDays days including today.
      const dailyFrom = trendStart(now, input.windowDays);

      const [scorecards, settingsAlone, groups, dailyRows, judge, changes] =
        await Promise.all([
          gatewayOn
            ? loadApplicationScorecards(ctx.prisma, {
                projectId: input.projectId,
                windowDays: input.windowDays,
                canSeeSpend,
                now,
              })
            : Promise.resolve(null),
          // The scorecards read the settings themselves; without them, read
          // them here for the mode.
          gatewayOn ? Promise.resolve(null) : getCurrentSettings(ctx.prisma),
          ctx.prisma.acmeGuardrailEvent.groupBy({
            by: ["direction", "action", "gatewayMode"],
            where: {
              projectId: input.projectId,
              eventTime: { gte: since, lte: until },
            },
            _count: { _all: true },
          }),
          // A day bucket needs raw SQL; bound parameters only, scoped to this
          // project and the period. Timestamps are stored as UTC without a
          // zone, so the bounds are passed as UTC text and cast the same way.
          ctx.prisma.$queryRaw<DailyDecisions[]>(Prisma.sql`
            SELECT to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
                   COUNT(*)::int AS checks,
                   (COUNT(*) FILTER (WHERE direction = 'input' AND action = 'block'))::int AS "promptsRefused",
                   (COUNT(*) FILTER (WHERE direction = 'output' AND action = 'block'))::int AS "answersWithheld",
                   (COUNT(*) FILTER (WHERE action = 'redact'))::int AS redactions,
                   (COUNT(*) FILTER (WHERE action = 'unavailable'))::int AS "noVerdict"
            FROM acme_guardrail_events
            WHERE project_id = ${input.projectId}
              AND event_time >= ${dailyFrom.toISOString()}::timestamp
              AND event_time <= ${until.toISOString()}::timestamp
            GROUP BY 1`),
          judgeAvailability(ctx.prisma, { projectId: input.projectId, now }),
          listModeChanges(ctx.prisma),
        ]);

      const settings = scorecards ? scorecards.settings : settingsAlone;
      const summary = scorecards?.summary;

      return {
        enabled: true as const,
        windowDays: input.windowDays,
        generatedAt: now.toISOString(),
        canSeeSpend,
        mode: overviewMode(
          settings,
          changes,
          now,
          parseModeCeiling(env.CAIRO_GUARDRAIL_MODE_MAX),
        ),
        decisions: decisionTotals(groups),
        daily: dailyDecisions(dailyFrom, input.windowDays, dailyRows),
        judge: {
          windowHours: judge.windowHours,
          checks: judge.calls,
          noVerdict: judge.unavailable,
          rate: judge.rate,
          alertRate: judge.alertRate,
          alert: judge.alert,
        },
        // Null while gateway management is off: no applications to rate.
        applications: summary
          ? {
              total: summary.applications,
              byOverall: summary.byOverall,
              topRisks: summary.topRisks,
              missingBudget: summary.missingBudget,
            }
          : null,
        // Present only for a viewer who may see spend; otherwise absent,
        // not null, so nothing on the page can show it.
        ...(canSeeSpend && scorecards
          ? {
              spend: budgetUse(
                scorecards.scored.map(({ app, input: i }) => ({
                  name: app.name,
                  alias: app.alias,
                  budgetDuration: app.budgetDuration,
                  spendUsd: i.spendUsd,
                  maxBudget: i.key.maxBudget,
                })),
                BUDGETS_SHOWN,
              ),
            }
          : {}),
      };
    }),
});
