/**
 * ACME (CHG-2026-138, ADR-0027): the EYEON Enforcement and policy page. One
 * query for the page (`summary`) and one for its navigation entry
 * (`status`), both read-only. Display only: the mode and the policies are
 * changed on the Guardrails page, by the deployment's guardrail
 * administrators; nothing here writes.
 *
 * Who sees it: the Guardrails page's rule, projectGuardrails:read (Owner,
 * Admin, Security Analyst, Auditor), checked before any read. Every one of
 * them can open the Guardrails page, so the page always links to it. Behind
 * CAIRO_EYEON_ENFORCEMENT_ENABLED, default off: then `summary` reads nothing
 * and says so, and the navigation entry is hidden.
 *
 * Metadata only, eight reads whatever the data: the guardrail settings in
 * force and their mode history (the Guardrails page's own functions); this
 * project's decisions grouped by direction, verdict and the mode the gateway
 * reported (the overview's enforce share); one daily series of checks by
 * reported mode; the refusals grouped by policy label, direction and mode;
 * the judge's no-verdict rate over 24 hours; the guardrail pods' reported
 * settings versions; and the mode each gateway replica reported with its
 * latest decision in this project. No prompt or answer text, redacted text,
 * personal-data findings, encrypted content or token hash is read. The tests
 * assert on every select, group and SQL statement. The figures are shaped in
 * eyeonEnforcement.ts.
 *
 * Owner decisions of 2026-10-07 (CHG-2026-138 follow-up):
 * - who changed the mode and the reason given are returned as the Guardrails
 *   page shows them to the same viewer: an automatic switch-back says so; a
 *   person's email only to the deployment's guardrail administrators
 *   (SF-2026-018), otherwise "a guardrail administrator"; never the user id;
 * - the guardrail pods are counted, never named: the pod name column is not
 *   read, as the gateway replicas' names are never returned.
 */
import { z } from "zod";
import { AcmeGuardrailEventAction, Prisma } from "@langfuse/shared/src/db";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { mayCallProjectProcedure } from "@/src/features/rbac/server/securityRoleAllowList";
import { env } from "@/src/env.mjs";
import {
  ALL_PII_ENTITIES,
  DEFAULT_REVERT_AFTER_MINUTES,
  ENFORCE_CONFIRMATION,
  EVENT_FUTURE_SKEW_MS,
  MAX_LISTED_PODS,
  POD_STALE_AFTER_SECONDS,
  REVERT_AFTER_MINUTES_OPTIONS,
  canEditGuardrailSettings,
  getCurrentSettings,
  judgeAvailability,
  listModeChanges,
  listReportingGateways,
  parseModeCeiling,
  selfSignupClosed,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import { trendStart } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { decisionTotals } from "@/src/features/acme-enhancements/server/eyeonOverview";
import { refusalsByType } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  type DailyModeRow,
  dailyModes,
  enforcementMode,
  gatewayAgreement,
  lastTrial,
  modeHistory,
  podAgreement,
  policiesInForce,
} from "@/src/features/acme-enhancements/server/eyeonEnforcement";

/** How many recorded changes of mode the page lists. */
export const MODE_CHANGES_SHOWN = 10;

/**
 * A pod row is removed a day after its last pull (recordPodSync), so the
 * page lists stale pods from the last day only.
 */
const POD_WINDOW_HOURS = 24;

/** The scope of the Guardrails page, which this page summarises. */
const GUARDRAILS_READ_SCOPE = "projectGuardrails:read" as const;

/** The switch, as the content-free roles' allow-lists name it. */
const SET_MODE_PROCEDURE = "acmeGuardrails.setMode";

function enforcementEnabled(): boolean {
  return env.CAIRO_EYEON_ENFORCEMENT_ENABLED === "true";
}

export const eyeonEnforcementRouter = createTRPCRouter({
  /**
   * Whether the page is switched on, for the navigation entry. The flag is
   * server-only, so the client has to ask (as for the other EYEON entries).
   * Reads no database.
   */
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: GUARDRAILS_READ_SCOPE,
      });
      return { enabled: enforcementEnabled() };
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
        scope: GUARDRAILS_READ_SCOPE,
      });
      if (!enforcementEnabled()) {
        return { enabled: false as const };
      }
      const { projectId } = input;
      const now = new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000);
      // Event times are pushed by the guardrail service: a far-future one is
      // ignored, as on the Guardrails page (SF-2026-026).
      const until = new Date(now.getTime() + EVENT_FUTURE_SKEW_MS);
      // One point per UTC day, the last windowDays days including today.
      const dailyFrom = trendStart(now, input.windowDays);
      const period = { gte: since, lte: until };
      const ceiling = parseModeCeiling(env.CAIRO_GUARDRAIL_MODE_MAX);

      const [
        settings,
        changes,
        groups,
        dailyRows,
        refusalGroups,
        judge,
        podRows,
        gateways,
      ] = await Promise.all([
        getCurrentSettings(ctx.prisma),
        listModeChanges(ctx.prisma),
        ctx.prisma.acmeGuardrailEvent.groupBy({
          by: ["direction", "action", "gatewayMode"],
          where: { projectId, eventTime: period },
          _count: { _all: true },
        }),
        // A day bucket needs raw SQL; bound parameters only, scoped to this
        // project and the period. Timestamps are stored as UTC without a
        // zone, so the bounds are passed as UTC text and cast the same way.
        // Only an exact "enforce" or "record" counts as reported
        // (gatewayModeFromDb); the rest is "not reported".
        ctx.prisma.$queryRaw<DailyModeRow[]>(Prisma.sql`
          SELECT to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS checks,
                 (COUNT(*) FILTER (WHERE gateway_mode = 'enforce'))::int AS "enforceMode",
                 (COUNT(*) FILTER (WHERE gateway_mode = 'record'))::int AS "recordMode"
          FROM acme_guardrail_events
          WHERE project_id = ${projectId}
            AND event_time >= ${dailyFrom.toISOString()}::timestamp
            AND event_time <= ${until.toISOString()}::timestamp
          GROUP BY 1`),
        // Refusals by the guardrail's policy label: the label only, mapped
        // to a policy and never returned as text.
        ctx.prisma.acmeGuardrailEvent.groupBy({
          by: ["policyTriggered", "direction", "gatewayMode"],
          where: {
            projectId,
            eventTime: period,
            action: AcmeGuardrailEventAction.BLOCK,
          },
          _count: { _all: true },
        }),
        judgeAvailability(ctx.prisma, { projectId, now }),
        // Each guardrail pod's reported version and time, the latest first,
        // at most the Guardrails page's number. Counted, never named: the
        // pod name column is not read (owner decision, 2026-10-07).
        ctx.prisma.acmeGuardrailSettingsPod.findMany({
          where: {
            lastSyncAt: {
              gte: new Date(now.getTime() - POD_WINDOW_HOURS * 3_600_000),
            },
          },
          orderBy: { lastSyncAt: "desc" },
          take: MAX_LISTED_PODS,
          select: { appliedVersion: true, lastSyncAt: true },
        }),
        // The mode each gateway replica reported with its latest decision in
        // this project (the Guardrails page's own aggregation, last 24
        // hours). Reduced to counts below: the replicas' names stay out.
        listReportingGateways(ctx.prisma, { projectId, now }),
      ]);

      // One of the deployment's guardrail administrators, by the Guardrails
      // page's rule (getConfig). Such a viewer sees the email of the person
      // who changed the mode, as on that page (SF-2026-018); nobody else does.
      const isGuardrailAdmin = canEditGuardrailSettings({
        email: ctx.session.user.email,
        rawAdminList: env.CAIRO_GUARDRAIL_ADMINS,
        signupClosed: selfSignupClosed(env),
      });
      const mode = enforcementMode(
        settings,
        changes,
        now,
        ceiling,
        isGuardrailAdmin,
      );
      const decisions = decisionTotals(groups);

      // Display only: say whether this viewer could make the change on the
      // Guardrails page, by the rule that page applies (getConfig).
      const viewerCanSwitch =
        isGuardrailAdmin &&
        mayCallProjectProcedure({
          projectRole: ctx.session.projectRole,
          procedurePath: SET_MODE_PROCEDURE,
          isInstanceAdmin: ctx.session.user.admin === true,
        });

      return {
        enabled: true as const,
        windowDays: input.windowDays,
        generatedAt: now.toISOString(),
        mode,
        decisions,
        daily: dailyModes(dailyFrom, input.windowDays, dailyRows),
        history: {
          ...modeHistory(changes, since, MODE_CHANGES_SHOWN, isGuardrailAdmin),
          limit: MODE_CHANGES_SHOWN,
        },
        trial: {
          last: lastTrial(changes, mode.trialEndsAt),
          defaultMinutes: DEFAULT_REVERT_AFTER_MINUTES,
          options: [...REVERT_AFTER_MINUTES_OPTIONS],
        },
        pods: podAgreement(podRows, mode.version, now),
        gateways: gatewayAgreement(
          gateways,
          mode.mode,
          mode.lastChange?.at ?? null,
        ),
        judge: {
          windowHours: judge.windowHours,
          checks: judge.calls,
          noVerdict: judge.unavailable,
          rate: judge.rate,
          alertRate: judge.alertRate,
          alert: judge.alert,
        },
        // Null when no guardrail settings are stored yet.
        policies: policiesInForce(
          settings,
          refusalsByType(refusalGroups),
          decisions.redactions,
          ALL_PII_ENTITIES.length,
        ),
        howItChanges: {
          confirmationWord: ENFORCE_CONFIRMATION,
          podStaleAfterSeconds: POD_STALE_AFTER_SECONDS,
        },
        viewerCanSwitch,
      };
    }),
});
