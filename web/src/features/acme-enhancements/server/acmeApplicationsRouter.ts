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
 */
import { z } from "zod";
import { type Session } from "next-auth";
import { type ProjectScope } from "@langfuse/shared";
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
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  AcmeLitellmKeyStatus,
  prisma,
} from "@langfuse/shared/src/db";
import { gatewayModeFromDb } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import {
  getCurrentSettings,
  parseModeCeiling,
  servedMode,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  type GuardrailCounts,
  type ScorecardInput,
  dailyTrend,
  rankTopRisks,
  scoreApplication,
  summarise,
  threatTypeBreakdown,
  trendStart,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";

const WINDOW_DAYS = [7, 30] as const;

/** How many of the top risks the executive summary lists. */
const TOP_RISKS_SHOWN = 5;

/** Statuses whose key is, or was, in use; failed and pending ones never were. */
const USED_STATUSES = [
  AcmeLitellmKeyStatus.ACTIVE,
  AcmeLitellmKeyStatus.ROTATED,
  AcmeLitellmKeyStatus.ROTATION_PARTIAL,
  AcmeLitellmKeyStatus.REVOKED,
];

function throwIfNoneOf(
  session: Session,
  projectId: string,
  scopes: ProjectScope[],
) {
  if (scopes.some((scope) => hasProjectAccess({ session, projectId, scope })))
    return;
  throwIfNoProjectAccess({ session, projectId, scope: scopes[0]! });
}

function emptyCounts(): GuardrailCounts {
  return {
    promptChecks: 0,
    answerChecks: 0,
    promptBlocks: 0,
    answerBlocks: 0,
    redactions: 0,
    noVerdict: 0,
    enforcedChecks: 0,
  };
}

export const acmeApplicationsRouter = createTRPCRouter({
  scorecards: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        windowDays: z
          .number()
          .refine((d) => (WINDOW_DAYS as readonly number[]).includes(d))
          .default(30),
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
          current: [...generations]
            .reverse()
            .find((g) => g.status === AcmeLitellmKeyStatus.ACTIVE),
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
            ? prisma.$queryRaw<{ alias: string; day: string; n: number }[]>`
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
            ? prisma.$queryRaw<{ alias: string; day: string; n: number }[]>`
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

      const guardByAlias = new Map<string, GuardrailCounts>();
      // Refused prompts and withheld answers by the guardrail's policy label.
      const refusalsByAlias = new Map<
        string,
        { policyTriggered: string | null; count: number }[]
      >();
      for (const e of events) {
        const c = guardByAlias.get(e.agentId) ?? emptyCounts();
        const n = e._count._all;
        const isPrompt = e.direction === AcmeGuardrailEventDirection.INPUT;
        if (isPrompt) c.promptChecks += n;
        else c.answerChecks += n;
        if (e.action === AcmeGuardrailEventAction.BLOCK) {
          if (isPrompt) c.promptBlocks += n;
          else c.answerBlocks += n;
          const refusals = refusalsByAlias.get(e.agentId) ?? [];
          refusals.push({ policyTriggered: e.policyTriggered, count: n });
          refusalsByAlias.set(e.agentId, refusals);
        }
        if (e.action === AcmeGuardrailEventAction.REDACT) c.redactions += n;
        if (e.action === AcmeGuardrailEventAction.UNAVAILABLE) c.noVerdict += n;
        if (gatewayModeFromDb(e.gatewayMode) === "enforce")
          c.enforcedChecks += n;
        guardByAlias.set(e.agentId, c);
      }
      const trendRowsByAlias = new Map<
        string,
        { day: string; calls: number; refused: number }[]
      >();
      for (const r of [
        ...dailyCalls.map((d) => ({ ...d, calls: d.n, refused: 0 })),
        ...dailyRefused.map((d) => ({ ...d, calls: 0, refused: d.n })),
      ]) {
        const list = trendRowsByAlias.get(r.alias) ?? [];
        list.push({ day: r.day, calls: r.calls, refused: r.refused });
        trendRowsByAlias.set(r.alias, list);
      }
      const callsByAlias = new Map<
        string,
        { calls: number; failed: number; spend: number }
      >();
      for (const r of calls) {
        if (!r.keyAlias) continue;
        const c = callsByAlias.get(r.keyAlias) ?? {
          calls: 0,
          failed: 0,
          spend: 0,
        };
        c.calls += r._count._all;
        if (r.status !== "success") c.failed += r._count._all;
        c.spend += r._sum.spend ?? 0;
        callsByAlias.set(r.keyAlias, c);
      }

      const scored = apps.map(({ current, aliases }) => {
        const guard = emptyCounts();
        let callCount = 0;
        let failed = 0;
        let spend = 0;
        for (const alias of aliases) {
          const g = guardByAlias.get(alias);
          if (g) {
            for (const k of Object.keys(guard) as (keyof GuardrailCounts)[])
              guard[k] += g[k];
          }
          const c = callsByAlias.get(alias);
          if (c) {
            callCount += c.calls;
            failed += c.failed;
            spend += c.spend;
          }
        }
        const scoreInput: ScorecardInput = {
          key: {
            models: current.models,
            rpmLimit: current.rpmLimit,
            maxBudget: current.maxBudget,
            expiresAt: current.expiresAt,
            issuedAt: current.createdAt,
          },
          calls: callCount,
          failedCalls: failed,
          spendUsd: canSeeSpend ? spend : null,
          guard,
          mode,
          now,
        };
        return {
          input: scoreInput,
          score: scoreApplication(scoreInput),
          app: {
            name: current.displayName,
            alias: current.litellmKeyAlias,
            generation: current.generation,
            models: current.models,
            budgetDuration: current.budgetDuration,
            threatTypes: threatTypeBreakdown(
              aliases.flatMap((alias) => refusalsByAlias.get(alias) ?? []),
            ),
            trend: dailyTrend(
              trendFrom,
              input.windowDays,
              aliases.flatMap((alias) => trendRowsByAlias.get(alias) ?? []),
            ),
          },
        };
      });

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
});
