/**
 * ACME enhancement — reads recent runtime-policy decisions and now also
 * reads/writes live policy config on rayin-guardrails
 * (https://github.com/samrayin/rayin-guardrails), a separate service, not
 * code in this repo.
 *
 * recentEvents/eventHistory/exportEventHistory/eventDetail/getConfig:
 * "projectGuardrails:read" — granted to
 * OWNER and ADMIN only (projectAccessRights.ts), same sensitivity as Audit
 * Logs (reveals what content was flagged). rayin-guardrails' GET /v1/events is an in-memory ring buffer
 * (resets on that service's own pod restart, see its README "Known gaps").
 * Every successful fetch here is now also persisted into this repo's own
 * Postgres (`AcmeGuardrailEvent`) before being read back, so the dashboard's
 * audit/reporting history survives a rayin-guardrails pod restart even
 * though the upstream buffer itself does not. If the persisted read fails
 * (e.g. Postgres unreachable), this falls back to serving the live fetch
 * directly, matching the old buffer-only behavior rather than erroring.
 *
 * Since the durable push (guardrails-events endpoint), this pull-persist is
 * only a fallback for events whose push failed -- see
 * acmeGuardrailsPullBackfill.ts for why it only persists events with an
 * event_id that are old enough for their push to have finished.
 *
 * getConfig / updateConfig (ADR-0005-B part a, CHG-2026-089): the guardrail
 * settings are stored in CAIRO and versioned (acmeGuardrailSettings.ts).
 * They apply to every project and every gateway caller, so a change needs a
 * named deployment administrator (CAIRO_GUARDRAIL_ADMINS), not a project
 * role. Every rayin-guardrails pod pulls the current version itself.
 *
 * Every call to rayin-guardrails from here — reads and the write — carries
 * the shared secret (RAYIN_GUARDRAILS_CONFIG_SECRET) as X-Config-Secret.
 * That service used to treat /v1/events and GET /v1/config as
 * same-network-trust, no auth needed; it now requires the secret on every
 * endpoint it exposes, so every fetch below needs the header too.
 */
import { z } from "zod";
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
  prisma,
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  type AcmeGuardrailEvent,
  type AcmeGuardrailEventSource,
  type Prisma,
} from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { TRPCError } from "@trpc/server";
import { selectPullBackfillRows } from "@/src/features/acme-enhancements/server/acmeGuardrailsPullBackfill";
import {
  buildHiddenTestTrafficWhere,
  buildHistoryWhere,
  GUARDRAIL_EXPORT_MAX_ROWS,
  GuardrailHistoryFilterSchema,
  TEST_TRAFFIC_AGENT_PREFIXES,
} from "@/src/features/acme-enhancements/server/acmeGuardrailsHistory";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  ALL_PII_ENTITIES,
  getCurrentSettings,
  type GuardrailSettingsVersion,
  canEditGuardrailSettings,
  GuardrailSettingsValidationError,
  listReportingPods,
  parseAdminList,
  POD_STALE_AFTER_SECONDS,
  REASON_MAX_LENGTH,
  saveSettings,
  selfSignupClosed,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

const DIRECTION_FROM_DB: Record<
  AcmeGuardrailEventDirection,
  "input" | "output"
> = {
  [AcmeGuardrailEventDirection.INPUT]: "input",
  [AcmeGuardrailEventDirection.OUTPUT]: "output",
};

const ACTION_FROM_DB: Record<
  AcmeGuardrailEventAction,
  "allow" | "redact" | "block"
> = {
  [AcmeGuardrailEventAction.ALLOW]: "allow",
  [AcmeGuardrailEventAction.REDACT]: "redact",
  [AcmeGuardrailEventAction.BLOCK]: "block",
};

// event_id, user_id and client_host are optional: older rayin-guardrails
// builds don't include them in the buffer. Kept (not stripped) so pull rows
// dedupe against push rows on event_id -- see acmeGuardrailsPullBackfill.ts.
const GuardrailsEventSchema = z.object({
  event_id: z.string().nullish(),
  user_id: z.string().nullish(),
  client_host: z.string().nullish(),
  time: z.string(),
  agent_id: z.string(),
  trace_id: z.string().nullable(),
  direction: z.enum(["input", "output"]),
  policy_triggered: z.string().nullable(),
  action: z.enum(["allow", "redact", "block"]),
});

const GuardrailsEventsResponseSchema = z.object({
  events: z.array(GuardrailsEventSchema),
  summary: z.object({
    total: z.number(),
    blocked: z.number(),
    redacted: z.number(),
    allowed: z.number(),
  }),
});

/** Reads rayin-guardrails' in-memory event buffer (newest `limit` events). */
async function fetchBufferedEvents(limit: number) {
  const res = await fetch(
    `${env.RAYIN_GUARDRAILS_URL}/v1/events?limit=${limit}`,
    {
      headers: { "X-Config-Secret": env.RAYIN_GUARDRAILS_CONFIG_SECRET ?? "" },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `rayin-guardrails returned ${res.status} fetching /v1/events`,
    );
  }
  return GuardrailsEventsResponseSchema.parse(await res.json());
}

/**
 * Persists buffered events whose push has had time to land and still has
 * not (see acmeGuardrailsPullBackfill.ts). A failure is logged, not thrown.
 */
async function persistPullBackfill(
  events: z.infer<typeof GuardrailsEventSchema>[],
  projectId: string,
) {
  const backfill = selectPullBackfillRows(events, projectId, new Date());
  if (backfill.length === 0) return;
  try {
    await prisma.acmeGuardrailEvent.createMany({
      data: backfill,
      skipDuplicates: true,
    });
  } catch (error) {
    logger.error("Failed to persist rayin-guardrails events", {
      error,
      projectId,
    });
  }
}

/**
 * Best-effort pull of the whole buffer (at most 200 events) into Postgres,
 * so the history also holds events whose push failed. Never throws: the
 * history is read from Postgres whether or not the service answers.
 */
async function syncBufferedEvents(
  projectId: string,
): Promise<"ok" | "unavailable"> {
  if (!env.RAYIN_GUARDRAILS_CONFIG_SECRET) return "unavailable";
  try {
    const parsed = await fetchBufferedEvents(200);
    await persistPullBackfill(parsed.events, projectId);
    return "ok";
  } catch (error) {
    logger.warn("rayin-guardrails buffer sync failed; serving stored events", {
      error,
      projectId,
    });
    return "unavailable";
  }
}

const EVENT_ROW_SELECT = {
  id: true,
  eventTime: true,
  agentId: true,
  traceId: true,
  direction: true,
  policyTriggered: true,
  action: true,
  userId: true,
  clientHost: true,
} satisfies Prisma.AcmeGuardrailEventSelect;

/** Newest first; the id breaks ties so cursor paging never skips a row. */
const HISTORY_ORDER: Prisma.AcmeGuardrailEventOrderByWithRelationInput[] = [
  { eventTime: "desc" },
  { id: "desc" },
];

function toEventRow(
  event: Pick<AcmeGuardrailEvent, keyof typeof EVENT_ROW_SELECT>,
) {
  return {
    id: event.id as string | null,
    user_id: event.userId,
    client_host: event.clientHost,
    time: event.eventTime.toISOString(),
    agent_id: event.agentId,
    trace_id: event.traceId,
    direction: DIRECTION_FROM_DB[event.direction],
    policy_triggered: event.policyTriggered,
    action: ACTION_FROM_DB[event.action],
  };
}

function sourceLabel(source: AcmeGuardrailEventSource | null) {
  if (source === null) return null;
  return source === "PUSH" ? "push" : "pull";
}

export const acmeGuardrailsRouter = createTRPCRouter({
  recentEvents: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      if (!env.RAYIN_GUARDRAILS_URL) {
        return { configured: false as const };
      }
      if (!env.RAYIN_GUARDRAILS_CONFIG_SECRET) {
        throw new Error(
          "RAYIN_GUARDRAILS_CONFIG_SECRET is not configured — refusing to call an endpoint we can't authenticate to.",
        );
      }

      const parsed = await fetchBufferedEvents(input.limit);
      await persistPullBackfill(parsed.events, input.projectId);

      try {
        const persisted = await prisma.acmeGuardrailEvent.findMany({
          where: { projectId: input.projectId },
          orderBy: { eventTime: "desc" },
          take: input.limit,
          select: EVENT_ROW_SELECT,
        });

        const events = persisted.map(toEventRow);

        const summary = events.reduce(
          (acc, event) => {
            acc.total += 1;
            if (event.action === "block") acc.blocked += 1;
            if (event.action === "redact") acc.redacted += 1;
            if (event.action === "allow") acc.allowed += 1;
            return acc;
          },
          { total: 0, blocked: 0, redacted: 0, allowed: 0 },
        );

        return { configured: true as const, events, summary };
      } catch (error) {
        // Postgres unreachable or similar — fall back to the live fetch so
        // the dashboard still works, just without durability for this call.
        logger.error("Failed to read persisted rayin-guardrails events", {
          error,
          projectId: input.projectId,
        });
        return {
          configured: true as const,
          summary: parsed.summary,
          events: parsed.events.map((event) => ({
            id: null as string | null,
            user_id: event.user_id ?? null,
            client_host: event.client_host ?? null,
            time: event.time,
            agent_id: event.agent_id,
            trace_id: event.trace_id,
            direction: event.direction,
            policy_triggered: event.policy_triggered,
            action: event.action,
          })),
        };
      }
    }),

  // ADR-0013: the stored history, newest first, one page at a time. Read
  // from Postgres; the first page also pulls the service's buffer so events
  // whose push failed are included, but a failed pull never hides the
  // history. `counts` cover every row the filter matches, not just the page.
  eventHistory: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        cursor: z.string().optional(),
        pageSize: z.number().int().min(1).max(100).default(50),
        filter: GuardrailHistoryFilterSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      if (!env.RAYIN_GUARDRAILS_URL) {
        return { configured: false as const };
      }

      const liveSync = input.cursor
        ? null
        : await syncBufferedEvents(input.projectId);

      const where = buildHistoryWhere(input.projectId, input.filter);
      const hiddenWhere = buildHiddenTestTrafficWhere(
        input.projectId,
        input.filter,
      );
      const [rows, byAction, hiddenTestEvents] = await Promise.all([
        prisma.acmeGuardrailEvent.findMany({
          where,
          orderBy: HISTORY_ORDER,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          take: input.pageSize + 1,
          select: EVENT_ROW_SELECT,
        }),
        prisma.acmeGuardrailEvent.groupBy({
          by: ["action"],
          where,
          _count: { _all: true },
        }),
        hiddenWhere
          ? prisma.acmeGuardrailEvent.count({ where: hiddenWhere })
          : Promise.resolve(0),
      ]);

      const counts = { total: 0, blocked: 0, redacted: 0, allowed: 0 };
      for (const group of byAction) {
        const n = group._count._all;
        counts.total += n;
        if (group.action === AcmeGuardrailEventAction.BLOCK)
          counts.blocked += n;
        if (group.action === AcmeGuardrailEventAction.REDACT)
          counts.redacted += n;
        if (group.action === AcmeGuardrailEventAction.ALLOW)
          counts.allowed += n;
      }

      const page = rows.slice(0, input.pageSize);
      return {
        configured: true as const,
        liveSync,
        events: page.map(toEventRow),
        nextCursor:
          rows.length > input.pageSize
            ? (page[page.length - 1]?.id ?? null)
            : null,
        counts,
        hiddenTestEvents,
        testTrafficPrefixes: TEST_TRAFFIC_AGENT_PREFIXES,
      };
    }),

  // ADR-0013: CSV export of the history under the same filter. Metadata only
  // (no redacted text, findings or encrypted content), capped at
  // GUARDRAIL_EXPORT_MAX_ROWS. A mutation because it writes the audit log,
  // which happens before any row is returned: an export that cannot be
  // audited is not served. Being a mutation, it is not on the content-free
  // roles' allow-lists (ADR-0011 §4), so only Owner and Admin can export.
  exportEventHistory: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        filter: GuardrailHistoryFilterSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      const rows = await prisma.acmeGuardrailEvent.findMany({
        where: buildHistoryWhere(input.projectId, input.filter),
        orderBy: HISTORY_ORDER,
        take: GUARDRAIL_EXPORT_MAX_ROWS + 1,
        select: { ...EVENT_ROW_SELECT, eventId: true, source: true },
      });
      const exported = rows.slice(0, GUARDRAIL_EXPORT_MAX_ROWS);
      const truncated = rows.length > GUARDRAIL_EXPORT_MAX_ROWS;

      await auditLog({
        session: ctx.session,
        resourceType: "acmeGuardrailEvents",
        resourceId: input.projectId,
        action: "export",
        after: { filter: input.filter, rowCount: exported.length, truncated },
      });

      return {
        rows: exported.map((row) => ({
          ...toEventRow(row),
          event_id: row.eventId,
          source: sourceLabel(row.source),
        })),
        truncated,
        maxRows: GUARDRAIL_EXPORT_MAX_ROWS,
      };
    }),

  // Detail panel for one persisted event (CAIRO roadmap Phase 1, "clickable
  // jailbreak detail view"). Returns the redact-tier content (already-safe
  // redacted text + PII findings) but never the block-tier ciphertext --
  // only whether it exists. Revealing blocked content is a separate,
  // role-gated and logged feature (sensitiveFields:reveal, Phase 2).
  eventDetail: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      const event = await prisma.acmeGuardrailEvent.findFirst({
        where: { id: input.id, projectId: input.projectId },
      });
      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Guardrail event not found.",
        });
      }

      // CHG-2026-071: for gateway traffic the event's "trace id" is LiteLLM's
      // litellm_call_id, not a Langfuse trace id (gateway traces live in a
      // separate project under an OTel trace id). The structured record of
      // that call is the request-log mirror row with the same call id, in
      // this project. Metadata only; shown to roles that may read gateway
      // request logs.
      const gatewayRequest =
        event.traceId &&
        hasProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "llmGatewayLogs:read",
        })
          ? await prisma.acmeLitellmRequestLog.findFirst({
              where: {
                projectId: input.projectId,
                OR: [
                  { litellmCallId: event.traceId },
                  { requestId: event.traceId },
                ],
              },
              orderBy: { startTime: "asc" },
              select: {
                requestId: true,
                litellmCallId: true,
                startTime: true,
                endTime: true,
                status: true,
                callType: true,
                model: true,
                modelGroup: true,
                provider: true,
                keyAlias: true,
                endUser: true,
                promptTokens: true,
                completionTokens: true,
                totalTokens: true,
                spend: true,
                cacheHit: true,
                errorClass: true,
              },
            })
          : null;

      return {
        id: event.id,
        eventId: event.eventId,
        time: event.eventTime.toISOString(),
        recordedAt: event.createdAt.toISOString(),
        agentId: event.agentId,
        userId: event.userId,
        clientHost: event.clientHost,
        traceId: event.traceId,
        direction: DIRECTION_FROM_DB[event.direction],
        action: ACTION_FROM_DB[event.action],
        policyTriggered: event.policyTriggered,
        source: sourceLabel(event.source),
        redactedText: event.redactedText,
        piiFindings: event.piiFindings,
        hasEncryptedContent: event.rawContentEncrypted !== null,
        gatewayRequest: gatewayRequest
          ? {
              ...gatewayRequest,
              startTime: gatewayRequest.startTime.toISOString(),
              endTime: gatewayRequest.endTime?.toISOString() ?? null,
            }
          : null,
      };
    }),

  // ADR-0005-B part a (CHG-2026-089): the guardrail settings live in CAIRO
  // (acme_guardrail_settings), not in one rayin-guardrails pod's memory.
  // This reads CAIRO's stored version and which version each pod reports;
  // it no longer asks a pod, which behind the Service would be a random one.
  getConfig: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      const [current, pods] = await Promise.all([
        getCurrentSettings(ctx.prisma),
        listReportingPods(ctx.prisma),
      ]);
      const signupClosed = selfSignupClosed(env);
      const canEdit = canEditGuardrailSettings({
        email: ctx.session.user.email,
        rawAdminList: env.CAIRO_GUARDRAIL_ADMINS,
        signupClosed,
      });

      return {
        // Whether a rayin-guardrails service is wired to this deployment.
        configured: Boolean(env.RAYIN_GUARDRAILS_URL),
        current: current
          ? {
              version: current.version,
              mode: current.mode,
              piiEntities: current.piiEntities,
              jailbreakEnabled: current.jailbreakEnabled,
              topicalEnabled: current.topicalEnabled,
              reason: current.reason,
              // Shown to the administrators only: the settings are visible
              // from every organisation, the editor's email need not be
              // (security review SF-2026-018).
              createdByEmail: canEdit ? current.createdByEmail : null,
              // The seeded first version was written by the migration.
              createdByInitialSetup: current.createdBy === "migration",
              createdAt: current.createdAt,
            }
          : null,
        availablePiiEntities: [...ALL_PII_ENTITIES],
        pods,
        podStaleAfterSeconds: POD_STALE_AFTER_SECONDS,
        canEdit,
        adminsConfigured: parseAdminList(env.CAIRO_GUARDRAIL_ADMINS).length > 0,
        signupClosed,
      };
    }),

  // ADR-0005-B part a: a change is a new, audited settings version. Only the
  // named deployment administrators (CAIRO_GUARDRAIL_ADMINS) may make one:
  // the settings apply to every project and every gateway caller, so no
  // organisation or project role is the right authority (§3.4, test B12).
  // Every rayin-guardrails pod applies it on its next pull (within 30 s).
  updateConfig: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        piiEntities: z.array(z.enum(ALL_PII_ENTITIES)),
        jailbreakEnabled: z.boolean(),
        topicalEnabled: z.boolean(),
        reason: z.string().max(REASON_MAX_LENGTH),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });
      const signupClosed = selfSignupClosed(env);
      if (
        !canEditGuardrailSettings({
          email: ctx.session.user.email,
          rawAdminList: env.CAIRO_GUARDRAIL_ADMINS,
          signupClosed,
        })
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: signupClosed
            ? "Only the deployment's guardrail administrators can change these settings."
            : "Changing the guardrail settings is disabled while open sign-up is enabled on this deployment.",
        });
      }

      let result;
      try {
        result = await saveSettings(
          ctx.prisma,
          {
            policy: {
              piiEntities: input.piiEntities,
              jailbreakEnabled: input.jailbreakEnabled,
              topicalEnabled: input.topicalEnabled,
            },
            reason: input.reason,
            userId: ctx.session.user.id,
            userEmail: ctx.session.user.email ?? null,
            projectId: input.projectId,
          },
          async (tx, { before, current }) => {
            await auditLog(
              {
                session: ctx.session,
                resourceType: "acmeGuardrailSettings",
                resourceId: `v${current.version}`,
                action: "update",
                before: before ? settingsForAudit(before) : null,
                after: settingsForAudit(current),
              },
              // The audit row commits with the new version (Q1).
              tx as unknown as typeof ctx.prisma,
            );
          },
        );
      } catch (e) {
        if (e instanceof GuardrailSettingsValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }

      // Nudge one pod to pull now; the rest pick it up within 30 s. Sent
      // with the full policy, so a rayin-guardrails build that predates
      // part a still applies it (to the one pod it reaches) during rollout.
      // Best effort: the stored version, not this call, is what counts.
      let nudged = false;
      if (
        result.changed &&
        env.RAYIN_GUARDRAILS_URL &&
        env.RAYIN_GUARDRAILS_CONFIG_SECRET
      ) {
        try {
          const res = await fetch(`${env.RAYIN_GUARDRAILS_URL}/v1/config`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Config-Secret": env.RAYIN_GUARDRAILS_CONFIG_SECRET,
            },
            body: JSON.stringify({
              pii_entities: result.current.piiEntities,
              jailbreak_enabled: result.current.jailbreakEnabled,
              topical_enabled: result.current.topicalEnabled,
            }),
            signal: AbortSignal.timeout(5_000),
          });
          nudged = res.ok;
          if (!res.ok) {
            logger.warn(
              `guardrail settings v${result.current.version} saved; rayin-guardrails nudge returned ${res.status}`,
            );
          }
        } catch (e) {
          logger.warn(
            `guardrail settings v${result.current.version} saved; rayin-guardrails nudge failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      return {
        changed: result.changed,
        version: result.current.version,
        nudged,
      };
    }),
});

function settingsForAudit(s: GuardrailSettingsVersion) {
  return {
    version: s.version,
    mode: s.mode,
    piiEntities: s.piiEntities,
    jailbreakEnabled: s.jailbreakEnabled,
    topicalEnabled: s.topicalEnabled,
    reason: s.reason,
  };
}
