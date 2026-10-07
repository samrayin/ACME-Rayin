/**
 * ACME (CHG-2026-122, ADR-0023): the Applications page and its scorecard.
 *
 * Read-only, metadata only. An application is a gateway key lineage in this
 * project (every generation of one key, across rotations); its guardrail
 * decisions are the events whose agent is one of the lineage's key aliases,
 * and its calls are the request-log rows with one of those aliases. The
 * scoring itself is in acmeApplicationScorecard.ts.
 *
 * Who sees it: llmGateway:read (Owner, Admin) or evidence:read (Auditor), as
 * for the gateway's Keys tab. Spend is included only with
 * llmGatewaySpend:read.
 *
 * Second iteration: refusals by type (from the guardrail's policy label
 * only), the share of checks decided in enforce mode, the top risks, and a
 * daily trend. Still metadata only: no content column is read.
 *
 * ACME (CHG-2026-125, ADR-0023 §3.5): `detail`, one application's screen.
 * The same access rule and the same scorecard, plus its generations, daily
 * activity, latest requests with their guardrail decisions beside them, and
 * its key's change record. The shaping is in acmeApplicationDetail.ts.
 */
import { z } from "zod";
import { type Session } from "next-auth";
import { type ProjectScope } from "@langfuse/shared";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import {
  hasProjectAccess,
  throwIfNoProjectAccess,
} from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import { AcmeLitellmKeyStatus, Prisma, prisma } from "@langfuse/shared/src/db";
import {
  getCurrentSettings,
  parseModeCeiling,
  servedMode,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  rankTopRisks,
  summarise,
  trendStart,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import {
  type AliasDayCount,
  DECISION_LOOKBACK_MS,
  DETAIL_CHANGES_SHOWN,
  DETAIL_REQUESTS_SHOWN,
  buildApplicationScorecard,
  callCountsByAlias,
  changeView,
  currentGeneration,
  dailyActivity,
  decisionsByRequest,
  generationView,
  guardrailCountsByAlias,
  requestCallIds,
  requestView,
  trendRowsByAlias,
} from "@/src/features/acme-enhancements/server/acmeApplicationDetail";

const WINDOW_DAYS = [7, 30] as const;

/** How many of the top risks the executive summary lists. */
const TOP_RISKS_SHOWN = 5;

/** Statuses whose key is, or was, in use; failed and pending ones never were. */
const USED_STATUSES: AcmeLitellmKeyStatus[] = [
  AcmeLitellmKeyStatus.ACTIVE,
  AcmeLitellmKeyStatus.ROTATED,
  AcmeLitellmKeyStatus.ROTATION_PARTIAL,
  AcmeLitellmKeyStatus.REVOKED,
];

const windowDaysInput = z
  .number()
  .refine((d) => (WINDOW_DAYS as readonly number[]).includes(d))
  .default(30);

function throwIfNoneOf(
  session: Session,
  projectId: string,
  scopes: ProjectScope[],
) {
  if (scopes.some((scope) => hasProjectAccess({ session, projectId, scope })))
    return;
  throwIfNoProjectAccess({ session, projectId, scope: scopes[0]! });
}

// ACME (CHG-2026-125): what the detail screen reads, column by column. No
// token hash, and none of the guardrail event's content columns (redacted
// text, personal-data findings, encrypted content), are ever selected; the
// tests assert on these selects.

/** A generation's settings and dates. */
export const DETAIL_GENERATION_SELECT = {
  id: true,
  lineageId: true,
  generation: true,
  displayName: true,
  litellmKeyAlias: true,
  status: true,
  models: true,
  rpmLimit: true,
  tpmLimit: true,
  maxBudget: true,
  budgetDuration: true,
  expiresAt: true,
  createdAt: true,
  revokedAt: true,
} satisfies Prisma.AcmeLitellmKeySelect;

/** A gateway request; its cost only for a viewer who may see spend. */
export function detailRequestSelect(canSeeSpend: boolean) {
  return {
    id: true,
    requestId: true,
    litellmCallId: true,
    startTime: true,
    endTime: true,
    status: true,
    errorClass: true,
    model: true,
    modelGroup: true,
    keyAlias: true,
    endUser: true,
    spend: canSeeSpend,
  } satisfies Prisma.AcmeLitellmRequestLogSelect;
}

/** A guardrail decision: direction, verdict, policy label and mode only. */
export const DETAIL_DECISION_SELECT = {
  traceId: true,
  eventTime: true,
  direction: true,
  action: true,
  policyTriggered: true,
  gatewayMode: true,
} satisfies Prisma.AcmeGuardrailEventSelect;

/**
 * A change-record row. Its before and after are read so the changed settings
 * can be listed through an allow-list; they are never returned.
 */
export const DETAIL_CHANGE_SELECT = {
  id: true,
  eventTime: true,
  phase: true,
  outcome: true,
  action: true,
  resourceId: true,
  actorUserId: true,
  actorOrgRole: true,
  actorProjectRole: true,
  before: true,
  after: true,
} satisfies Prisma.AcmeLitellmEventSelect;

export const acmeApplicationsRouter = createTRPCRouter({
  scorecards: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        windowDays: windowDaysInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, [
        "llmGateway:read",
        "evidence:read",
      ]);
      if (env.CAIRO_LITELLM_MANAGEMENT_ENABLED !== "true") {
        return { enabled: false as const };
      }
      const canSeeSpend = hasProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewaySpend:read",
      });
      const now = new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000);

      const keys = await prisma.acmeLitellmKey.findMany({
        where: { projectId: input.projectId, status: { in: USED_STATUSES } },
        select: {
          lineageId: true,
          generation: true,
          displayName: true,
          litellmKeyAlias: true,
          status: true,
          models: true,
          rpmLimit: true,
          maxBudget: true,
          budgetDuration: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: [{ lineageId: "asc" }, { generation: "asc" }],
      });

      // One application per lineage that still has a key in use. Its
      // settings are the newest active generation's; its traffic is every
      // generation's alias, so a rotation does not reset the scorecard.
      const lineages = new Map<string, typeof keys>();
      for (const k of keys) {
        const list = lineages.get(k.lineageId) ?? [];
        list.push(k);
        lineages.set(k.lineageId, list);
      }
      const apps = [...lineages.values()]
        .map((generations) => ({
          current: currentGeneration(generations),
          aliases: generations.map((g) => g.litellmKeyAlias),
        }))
        .filter(
          (a): a is { current: (typeof keys)[number]; aliases: string[] } =>
            a.current !== undefined,
        );
      const allAliases = apps.flatMap((a) => a.aliases);
      // The trend has one point per UTC day, the last windowDays days
      // including today, so its first day is a whole one.
      const trendFrom = trendStart(now, input.windowDays);

      // A bounded number of queries whatever the number of applications:
      // one groupBy per table for the counts, one per table for the trend.
      // The trend needs a day bucket, which groupBy cannot do, so it is raw
      // SQL with bound parameters, scoped like the rest to this project, the
      // period and the applications' aliases.
      const [settings, events, calls, dailyCalls, dailyRefused] =
        await Promise.all([
          getCurrentSettings(prisma),
          allAliases.length
            ? prisma.acmeGuardrailEvent.groupBy({
                by: [
                  "agentId",
                  "direction",
                  "action",
                  "policyTriggered",
                  "gatewayMode",
                ],
                where: {
                  projectId: input.projectId,
                  eventTime: { gte: since },
                  agentId: { in: allAliases },
                },
                _count: { _all: true },
              })
            : Promise.resolve([]),
          allAliases.length
            ? prisma.acmeLitellmRequestLog.groupBy({
                by: ["keyAlias", "status"],
                where: {
                  projectId: input.projectId,
                  startTime: { gte: since },
                  keyAlias: { in: allAliases },
                },
                _count: { _all: true },
                _sum: { spend: true },
              })
            : Promise.resolve([]),
          // Timestamps are stored as UTC without a zone, so the bound is
          // passed as UTC text and cast the same way.
          allAliases.length
            ? prisma.$queryRaw<AliasDayCount[]>`
                SELECT key_alias AS alias,
                       to_char(date_trunc('day', start_time), 'YYYY-MM-DD') AS day,
                       COUNT(*)::int AS n
                FROM acme_litellm_request_logs
                WHERE project_id = ${input.projectId}
                  AND start_time >= ${trendFrom.toISOString()}::timestamp
                  AND key_alias = ANY(${allAliases}::text[])
                GROUP BY 1, 2`
            : Promise.resolve([]),
          allAliases.length
            ? prisma.$queryRaw<AliasDayCount[]>`
                SELECT agent_id AS alias,
                       to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
                       COUNT(*)::int AS n
                FROM acme_guardrail_events
                WHERE project_id = ${input.projectId}
                  AND event_time >= ${trendFrom.toISOString()}::timestamp
                  AND agent_id = ANY(${allAliases}::text[])
                  AND direction = 'input'
                  AND action = 'block'
                GROUP BY 1, 2`
            : Promise.resolve([]),
        ]);

      const mode = settings
        ? servedMode(
            settings,
            now,
            parseModeCeiling(env.CAIRO_GUARDRAIL_MODE_MAX),
          )
        : "record";

      // CHG-2026-125: the aggregation moved to acmeApplicationDetail.ts, so
      // the detail screen scores an application exactly as its card does.
      const guard = guardrailCountsByAlias(events);
      const callsByAlias = callCountsByAlias(calls);
      const trendRows = trendRowsByAlias(dailyCalls, dailyRefused);

      const scored = apps.map(({ current, aliases }) =>
        buildApplicationScorecard({
          current,
          aliases,
          guard,
          calls: callsByAlias,
          trendRows,
          mode,
          now,
          canSeeSpend,
          trendFrom,
          windowDays: input.windowDays,
        }),
      );

      const order = { red: 0, amber: 1, green: 2, none: 3 } as const;
      scored.sort(
        (a, b) =>
          order[a.score.overall] - order[b.score.overall] ||
          a.app.name.localeCompare(b.app.name),
      );

      return {
        enabled: true as const,
        windowDays: input.windowDays,
        mode,
        canSeeSpend,
        generatedAt: now.toISOString(),
        summary: {
          ...summarise(scored, canSeeSpend),
          topRisks: rankTopRisks(
            scored.map(({ app, score }) => ({
              name: app.name,
              alias: app.alias,
              score,
            })),
            TOP_RISKS_SHOWN,
          ),
        },
        applications: scored.map(({ app, score, input: i }) => ({
          ...app,
          calls: i.calls,
          overall: score.overall,
          dimensions: score.dimensions,
          hygiene: score.hygiene,
        })),
      };
    }),

  /**
   * ACME (CHG-2026-125, ADR-0023 §3.5): one application, by its key
   * lineage. Same access rule and scorecard as `scorecards`. Each part of
   * the evidence also needs the scope of the log it comes from, which every
   * role that sees the page holds today: the requests and the change record
   * llmGatewayLogs:read, the guardrail decisions beside the requests
   * projectGuardrails:read. Spend and cost only with llmGatewaySpend:read.
   * Every read goes through ctx.prisma and is scoped to the project.
   */
  detail: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        lineageId: z.string().min(1).max(100),
        windowDays: windowDaysInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoneOf(ctx.session, input.projectId, [
        "llmGateway:read",
        "evidence:read",
      ]);
      if (env.CAIRO_LITELLM_MANAGEMENT_ENABLED !== "true") {
        return { enabled: false as const };
      }
      const can = (scope: ProjectScope) =>
        hasProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope,
        });
      const canSeeSpend = can("llmGatewaySpend:read");
      const canSeeLogs = can("llmGatewayLogs:read");
      const canSeeDecisions = can("projectGuardrails:read");
      const now = new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000);
      const trendFrom = trendStart(now, input.windowDays);

      const generations = await ctx.prisma.acmeLitellmKey.findMany({
        where: { projectId: input.projectId, lineageId: input.lineageId },
        select: DETAIL_GENERATION_SELECT,
        orderBy: { generation: "asc" },
      });
      // As on the Applications page: a lineage with no active key is not an
      // application. Another project's lineage does not resolve either.
      const current = currentGeneration(generations);
      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No application with this id in this project.",
        });
      }
      const aliases = generations
        .filter((g) => USED_STATUSES.includes(g.status))
        .map((g) => g.litellmKeyAlias);
      const generationByAlias = new Map(
        generations.map((g) => [g.litellmKeyAlias, g.generation]),
      );
      const generationByKeyId = new Map(
        generations.map((g) => [g.id, g.generation]),
      );

      const [
        settings,
        events,
        calls,
        dailyCalls,
        dailyRefused,
        requests,
        changes,
      ] = await Promise.all([
        getCurrentSettings(ctx.prisma),
        ctx.prisma.acmeGuardrailEvent.groupBy({
          by: [
            "agentId",
            "direction",
            "action",
            "policyTriggered",
            "gatewayMode",
          ],
          where: {
            projectId: input.projectId,
            eventTime: { gte: since },
            agentId: { in: aliases },
          },
          _count: { _all: true },
        }),
        ctx.prisma.acmeLitellmRequestLog.groupBy({
          by: ["keyAlias", "status"],
          where: {
            projectId: input.projectId,
            startTime: { gte: since },
            keyAlias: { in: aliases },
          },
          _count: { _all: true },
          _sum: { spend: true },
        }),
        // Daily calls and failures, and spend only for a viewer who may see
        // it: without the scope the column is not even read. Bound
        // parameters only, scoped like the scorecards' trend.
        ctx.prisma.$queryRaw<
          {
            alias: string;
            day: string;
            calls: number;
            failed: number;
            spend?: number;
          }[]
        >(Prisma.sql`
          SELECT key_alias AS alias,
                 to_char(date_trunc('day', start_time), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS calls,
                 (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed
                 ${canSeeSpend ? Prisma.sql`, COALESCE(SUM(spend), 0)::float8 AS spend` : Prisma.empty}
          FROM acme_litellm_request_logs
          WHERE project_id = ${input.projectId}
            AND start_time >= ${trendFrom.toISOString()}::timestamp
            AND key_alias = ANY(${aliases}::text[])
          GROUP BY 1, 2`),
        ctx.prisma.$queryRaw<AliasDayCount[]>(Prisma.sql`
          SELECT agent_id AS alias,
                 to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS n
          FROM acme_guardrail_events
          WHERE project_id = ${input.projectId}
            AND event_time >= ${trendFrom.toISOString()}::timestamp
            AND agent_id = ANY(${aliases}::text[])
            AND direction = 'input'
            AND action = 'block'
          GROUP BY 1, 2`),
        canSeeLogs
          ? ctx.prisma.acmeLitellmRequestLog.findMany({
              where: {
                projectId: input.projectId,
                startTime: { gte: since },
                keyAlias: { in: aliases },
              },
              orderBy: [{ startTime: "desc" }, { id: "desc" }],
              take: DETAIL_REQUESTS_SHOWN,
              select: detailRequestSelect(canSeeSpend),
            })
          : Promise.resolve(null),
        canSeeLogs
          ? ctx.prisma.acmeLitellmEvent.findMany({
              where: {
                projectId: input.projectId,
                resourceType: "litellmKey",
                resourceId: { in: generations.map((g) => g.id) },
              },
              orderBy: [{ eventTime: "desc" }, { id: "desc" }],
              take: DETAIL_CHANGES_SHOWN,
              select: DETAIL_CHANGE_SELECT,
            })
          : Promise.resolve(null),
      ]);

      // The guardrail decisions of the listed requests, linked one to one by
      // the gateway call id (CHG-2026-071), from this application's aliases
      // only, and no earlier than shortly before the oldest listed request.
      const oldest = requests?.[requests.length - 1]?.startTime;
      const decisions =
        canSeeDecisions && requests && requests.length > 0 && oldest
          ? await ctx.prisma.acmeGuardrailEvent.findMany({
              where: {
                projectId: input.projectId,
                agentId: { in: aliases },
                traceId: { in: requestCallIds(requests) },
                eventTime: {
                  gte: new Date(oldest.getTime() - DECISION_LOOKBACK_MS),
                },
              },
              orderBy: [{ eventTime: "asc" }, { id: "asc" }],
              select: DETAIL_DECISION_SELECT,
            })
          : [];
      const actorIds = [...new Set((changes ?? []).map((c) => c.actorUserId))];
      const actors = actorIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const actorById = new Map(
        actors.map((u) => [u.id, u.name ?? u.email ?? "Unknown user"]),
      );

      const mode = settings
        ? servedMode(
            settings,
            now,
            parseModeCeiling(env.CAIRO_GUARDRAIL_MODE_MAX),
          )
        : "record";
      const {
        app,
        score,
        input: scoreInput,
      } = buildApplicationScorecard({
        current,
        aliases,
        guard: guardrailCountsByAlias(events),
        calls: callCountsByAlias(calls),
        trendRows: trendRowsByAlias(
          dailyCalls.map((d) => ({ alias: d.alias, day: d.day, n: d.calls })),
          dailyRefused,
        ),
        mode,
        now,
        canSeeSpend,
        trendFrom,
        windowDays: input.windowDays,
      });
      const decisionsByRequestId = decisionsByRequest(
        requests ?? [],
        decisions,
      );

      return {
        enabled: true as const,
        windowDays: input.windowDays,
        mode,
        canSeeSpend,
        generatedAt: now.toISOString(),
        application: {
          ...app,
          calls: scoreInput.calls,
          overall: score.overall,
          dimensions: score.dimensions,
          hygiene: score.hygiene,
        },
        /** Every alias the application has used, for the evidence link. */
        aliases,
        generations: [...generations]
          .reverse()
          .map((g) => generationView(g, current.id)),
        daily: dailyActivity(
          trendFrom,
          input.windowDays,
          dailyCalls,
          dailyRefused,
          canSeeSpend,
        ),
        requests: requests
          ? requests.map((r) =>
              requestView(
                r,
                canSeeDecisions ? (decisionsByRequestId.get(r.id) ?? []) : [],
                generationByAlias,
                canSeeSpend,
              ),
            )
          : null,
        decisionsShown: canSeeDecisions,
        requestsLimit: DETAIL_REQUESTS_SHOWN,
        changes: changes
          ? changes.map((c) => changeView(c, generationByKeyId, actorById))
          : null,
        changesLimit: DETAIL_CHANGES_SHOWN,
      };
    }),
});
