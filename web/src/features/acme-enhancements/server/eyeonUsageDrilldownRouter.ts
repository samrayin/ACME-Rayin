/**
 * ACME (ADR-0027): the EYEON Usage drill-down page. Four read-only queries:
 * `status` for the navigation entry, then one per level: `applications`,
 * `users` (one application) and `promptTypes` (one user of one application).
 *
 * Who sees it: the page names people (the user id the caller reported), so it
 * needs both the gateway Spend read scope and the evidence read scope, which
 * only the roles that may see who did what hold. It is not on the Business
 * Analyst's or the Security Analyst's allow-list. Behind
 * CAIRO_EYEON_USAGE_ENABLED, default off: then every query reads nothing and
 * says so, and the navigation entry is hidden.
 *
 * Metadata only, all from Postgres, bound parameters only, every statement
 * scoped to one project and the period:
 *  - the project's gateway keys (to resolve an alias to its application);
 *  - the request-log mirror, summed by key alias or by user: calls, failed
 *    calls, spend and tokens;
 *  - the guardrail decisions, counted by agent (the key alias) or by user,
 *    and for the last level by policy label and verdict.
 * No prompt or answer text, redacted text, findings, encrypted content, token
 * hash, key secret or source address is read.
 */
import { z } from "zod";
import { type ProjectScope } from "@langfuse/shared";
import { type Session } from "next-auth";
import { Prisma } from "@langfuse/shared/src/db";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import {
  hasProjectAccess,
  throwIfNoProjectAccess,
} from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import { USED_STATUSES } from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";
import { EVENT_FUTURE_SKEW_MS } from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import { windowRange } from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";
import { applicationsByAlias } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  NO_USER,
  type DecisionAliasRow,
  type DecisionUserRow,
  type PromptTypeRow,
  type RequestAliasRow,
  type RequestUserRow,
  USAGE_ROWS_SHOWN,
  promptTypes,
  usageByApplication,
  usageByUser,
} from "@/src/features/acme-enhancements/server/eyeonUsageDrilldown";
import { SPEND_WINDOWS } from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";

/** Both scopes are needed: the spend figures and the people behind them. */
export const USAGE_READ_SCOPES: ProjectScope[] = [
  "llmGatewaySpend:read",
  "evidence:read",
];

function throwIfMissingAny(session: Session, projectId: string) {
  for (const scope of USAGE_READ_SCOPES) {
    if (!hasProjectAccess({ session, projectId, scope })) {
      throwIfNoProjectAccess({ session, projectId, scope });
    }
  }
}

function usageEnabled(): boolean {
  return env.CAIRO_EYEON_USAGE_ENABLED === "true";
}

/** The gateway request-log mirror must be on for there to be anything. */
function mirrorEnabled(): boolean {
  return (
    env.CAIRO_LITELLM_MANAGEMENT_ENABLED === "true" &&
    env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED === "true"
  );
}

const KEY_SELECT = {
  lineageId: true,
  generation: true,
  displayName: true,
  litellmKeyAlias: true,
  status: true,
} satisfies Prisma.AcmeLitellmKeySelect;

const periodInput = z.object({
  projectId: z.string(),
  window: z.enum(SPEND_WINDOWS),
});

function bounds(window: (typeof SPEND_WINDOWS)[number]) {
  const now = new Date();
  const range = windowRange(window, now);
  // Times are stamped by the caller: a far-future one is ignored, as on the
  // Guardrails page (SF-2026-026). Timestamps are stored as UTC without a
  // zone, so the bounds are passed as UTC text and cast the same way.
  const until = new Date(now.getTime() + EVENT_FUTURE_SKEW_MS);
  return {
    generatedAt: now.toISOString(),
    from: range.from.toISOString(),
    until: until.toISOString(),
  };
}

export const eyeonUsageDrilldownRouter = createTRPCRouter({
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfMissingAny(ctx.session, input.projectId);
      return { enabled: usageEnabled() };
    }),

  /** Level 1: one row per application. */
  applications: protectedProjectProcedure
    .input(periodInput)
    .query(async ({ ctx, input }) => {
      throwIfMissingAny(ctx.session, input.projectId);
      if (!usageEnabled()) return { enabled: false as const };
      if (!mirrorEnabled()) {
        return { enabled: true as const, requestLog: false, ...empty() };
      }
      const { projectId } = input;
      const b = bounds(input.window);
      const [keys, requests, decisions] = await Promise.all([
        ctx.prisma.acmeLitellmKey.findMany({
          where: { projectId, status: { in: USED_STATUSES } },
          select: KEY_SELECT,
        }),
        ctx.prisma.$queryRaw<RequestAliasRow[]>(Prisma.sql`
          SELECT COALESCE(key_alias, '') AS alias,
                 COUNT(*)::int AS calls,
                 (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed,
                 COALESCE(SUM(spend), 0)::float8 AS spend,
                 COALESCE(SUM(total_tokens), 0)::float8 AS "totalTokens"
          FROM acme_litellm_request_logs
          WHERE project_id = ${projectId}
            AND start_time >= ${b.from}::timestamp
            AND start_time <= ${b.until}::timestamp
          GROUP BY 1
          LIMIT ${USAGE_ROWS_SHOWN * 4}`),
        ctx.prisma.$queryRaw<DecisionAliasRow[]>(Prisma.sql`
          SELECT agent_id AS alias,
                 (COUNT(*) FILTER (WHERE direction = 'input'))::int AS checks,
                 (COUNT(*) FILTER (WHERE direction = 'input'
                                   AND action IN ('block', 'redact')))::int AS flagged
          FROM acme_guardrail_events
          WHERE project_id = ${projectId}
            AND event_time >= ${b.from}::timestamp
            AND event_time <= ${b.until}::timestamp
          GROUP BY 1
          LIMIT ${USAGE_ROWS_SHOWN * 4}`),
      ]);
      const rows = usageByApplication(
        requests,
        decisions,
        applicationsByAlias(keys),
      ).slice(0, USAGE_ROWS_SHOWN);
      return {
        enabled: true as const,
        requestLog: true,
        generatedAt: b.generatedAt,
        applications: rows,
      };
    }),

  /** Level 2: the users of one application. */
  users: protectedProjectProcedure
    .input(periodInput.extend({ lineageId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      throwIfMissingAny(ctx.session, input.projectId);
      if (!usageEnabled()) return { enabled: false as const };
      if (!mirrorEnabled()) {
        return { enabled: true as const, requestLog: false, ...emptyUsers() };
      }
      const { projectId } = input;
      const b = bounds(input.window);
      const keys = await ctx.prisma.acmeLitellmKey.findMany({
        where: {
          projectId,
          lineageId: input.lineageId,
          status: { in: USED_STATUSES },
        },
        select: KEY_SELECT,
      });
      const aliases = keys.map((k) => k.litellmKeyAlias);
      const application = applicationsByAlias(keys).get(aliases[0] ?? "");
      if (!application) {
        return { enabled: true as const, requestLog: true, ...emptyUsers() };
      }
      const [requests, decisions] = await Promise.all([
        ctx.prisma.$queryRaw<RequestUserRow[]>(Prisma.sql`
          SELECT end_user AS "user",
                 COUNT(*)::int AS calls,
                 (COUNT(*) FILTER (WHERE status <> 'success'))::int AS failed,
                 COALESCE(SUM(spend), 0)::float8 AS spend,
                 COALESCE(SUM(total_tokens), 0)::float8 AS "totalTokens"
          FROM acme_litellm_request_logs
          WHERE project_id = ${projectId}
            AND key_alias = ANY(${aliases}::text[])
            AND start_time >= ${b.from}::timestamp
            AND start_time <= ${b.until}::timestamp
          GROUP BY 1
          ORDER BY spend DESC
          LIMIT ${USAGE_ROWS_SHOWN}`),
        ctx.prisma.$queryRaw<DecisionUserRow[]>(Prisma.sql`
          SELECT user_id AS "user",
                 (COUNT(*) FILTER (WHERE direction = 'input'))::int AS checks,
                 (COUNT(*) FILTER (WHERE direction = 'input'
                                   AND action IN ('block', 'redact')))::int AS flagged
          FROM acme_guardrail_events
          WHERE project_id = ${projectId}
            AND agent_id = ANY(${aliases}::text[])
            AND event_time >= ${b.from}::timestamp
            AND event_time <= ${b.until}::timestamp
          GROUP BY 1
          ORDER BY flagged DESC
          LIMIT ${USAGE_ROWS_SHOWN}`),
      ]);
      return {
        enabled: true as const,
        requestLog: true,
        generatedAt: b.generatedAt,
        application: {
          lineageId: application.lineageId,
          name: application.name,
        },
        users: usageByUser(requests, decisions).slice(0, USAGE_ROWS_SHOWN),
      };
    }),

  /** Level 3: what one user's prompts to one application turned out to be. */
  promptTypes: protectedProjectProcedure
    .input(
      periodInput.extend({
        lineageId: z.string().min(1),
        /** NO_USER (empty) selects the checks that carried no user id. */
        user: z.string().max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfMissingAny(ctx.session, input.projectId);
      if (!usageEnabled()) return { enabled: false as const };
      const { projectId } = input;
      const b = bounds(input.window);
      const keys = await ctx.prisma.acmeLitellmKey.findMany({
        where: {
          projectId,
          lineageId: input.lineageId,
          status: { in: USED_STATUSES },
        },
        select: KEY_SELECT,
      });
      const aliases = keys.map((k) => k.litellmKeyAlias);
      const userCondition =
        input.user === NO_USER
          ? Prisma.sql`(user_id IS NULL OR btrim(user_id) = '')`
          : Prisma.sql`user_id = ${input.user}`;
      // Prompts only: an answer withheld is not something the user sent. The
      // label and verdict are read; the content columns never are.
      const rows =
        aliases.length === 0
          ? []
          : await ctx.prisma.$queryRaw<PromptTypeRow[]>(Prisma.sql`
              SELECT policy_triggered AS "policyTriggered",
                     action::text AS action,
                     COUNT(*)::int AS count
              FROM acme_guardrail_events
              WHERE project_id = ${projectId}
                AND direction = 'input'
                AND agent_id = ANY(${aliases}::text[])
                AND ${userCondition}
                AND event_time >= ${b.from}::timestamp
                AND event_time <= ${b.until}::timestamp
              GROUP BY 1, 2
              LIMIT ${USAGE_ROWS_SHOWN}`);
      return {
        enabled: true as const,
        generatedAt: b.generatedAt,
        ...promptTypes(rows),
      };
    }),
});

function empty() {
  return { generatedAt: null, applications: [] };
}

function emptyUsers() {
  return { generatedAt: null, application: null, users: [] };
}
