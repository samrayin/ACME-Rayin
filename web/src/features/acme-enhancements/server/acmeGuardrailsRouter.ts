/**
 * ACME enhancement — reads recent runtime-policy decisions and now also
 * reads/writes live policy config on rayin-guardrails
 * (https://github.com/samrayin/rayin-guardrails), a separate service, not
 * code in this repo.
 *
 * recentEvents/getConfig: "projectGuardrails:read" — any project member with
 * that scope, same sensitivity as Audit Logs (reveals what content was
 * flagged). rayin-guardrails' GET /v1/events is an in-memory ring buffer
 * (resets on that service's own pod restart, see its README "Known gaps").
 * Every successful fetch here is now also persisted into this repo's own
 * Postgres (`AcmeGuardrailEvent`) before being read back, so the dashboard's
 * audit/reporting history survives a rayin-guardrails pod restart even
 * though the upstream buffer itself does not. If the persisted read fails
 * (e.g. Postgres unreachable), this falls back to serving the live fetch
 * directly, matching the old buffer-only behavior rather than erroring.
 *
 * updateConfig: "project:update" — owner/admin only, same gate as UI
 * Customization, since this changes what gets enforced for every user in
 * the project, not just how the dashboard looks.
 *
 * Every call to rayin-guardrails from here — reads and the write — carries
 * the shared secret (RAYIN_GUARDRAILS_CONFIG_SECRET) as X-Config-Secret.
 * That service used to treat /v1/events and GET /v1/config as
 * same-network-trust, no auth needed; it now requires the secret on every
 * endpoint it exposes, so every fetch below needs the header too.
 */
import { z } from "zod";
import { createTRPCRouter, protectedProjectProcedure } from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import {
  prisma,
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
} from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";

const DIRECTION_TO_DB: Record<"input" | "output", AcmeGuardrailEventDirection> = {
  input: AcmeGuardrailEventDirection.INPUT,
  output: AcmeGuardrailEventDirection.OUTPUT,
};
const DIRECTION_FROM_DB: Record<AcmeGuardrailEventDirection, "input" | "output"> = {
  [AcmeGuardrailEventDirection.INPUT]: "input",
  [AcmeGuardrailEventDirection.OUTPUT]: "output",
};

const ACTION_TO_DB: Record<"allow" | "redact" | "block", AcmeGuardrailEventAction> = {
  allow: AcmeGuardrailEventAction.ALLOW,
  redact: AcmeGuardrailEventAction.REDACT,
  block: AcmeGuardrailEventAction.BLOCK,
};
const ACTION_FROM_DB: Record<AcmeGuardrailEventAction, "allow" | "redact" | "block"> = {
  [AcmeGuardrailEventAction.ALLOW]: "allow",
  [AcmeGuardrailEventAction.REDACT]: "redact",
  [AcmeGuardrailEventAction.BLOCK]: "block",
};

const ALL_PII_ENTITIES = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "CREDIT_CARD",
  "PERSON",
  "IBAN_CODE",
  "IP_ADDRESS",
] as const;

const ConfigResponseSchema = z.object({
  pii_entities: z.array(z.string()),
  jailbreak_enabled: z.boolean(),
  topical_enabled: z.boolean(),
  available_pii_entities: z.array(z.string()),
});

const GuardrailsEventSchema = z.object({
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

export const acmeGuardrailsRouter = createTRPCRouter({
  recentEvents: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().min(1).max(200).default(50) }))
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

      const res = await fetch(
        `${env.RAYIN_GUARDRAILS_URL}/v1/events?limit=${input.limit}`,
        {
          headers: { "X-Config-Secret": env.RAYIN_GUARDRAILS_CONFIG_SECRET },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) {
        throw new Error(
          `rayin-guardrails returned ${res.status} fetching /v1/events`,
        );
      }

      const parsed = GuardrailsEventsResponseSchema.parse(await res.json());

      if (parsed.events.length > 0) {
        try {
          await prisma.acmeGuardrailEvent.createMany({
            data: parsed.events.map((event) => ({
              projectId: input.projectId,
              eventTime: new Date(event.time),
              agentId: event.agent_id,
              traceId: event.trace_id,
              direction: DIRECTION_TO_DB[event.direction],
              policyTriggered: event.policy_triggered,
              action: ACTION_TO_DB[event.action],
            })),
            skipDuplicates: true,
          });
        } catch (error) {
          logger.error("Failed to persist rayin-guardrails events", {
            error,
            projectId: input.projectId,
          });
        }
      }

      try {
        const persisted = await prisma.acmeGuardrailEvent.findMany({
          where: { projectId: input.projectId },
          orderBy: { eventTime: "desc" },
          take: input.limit,
        });

        const events = persisted.map((event) => ({
          time: event.eventTime.toISOString(),
          agent_id: event.agentId,
          trace_id: event.traceId,
          direction: DIRECTION_FROM_DB[event.direction],
          policy_triggered: event.policyTriggered,
          action: ACTION_FROM_DB[event.action],
        }));

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
        return { configured: true as const, ...parsed };
      }
    }),

  getConfig: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
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

      const res = await fetch(`${env.RAYIN_GUARDRAILS_URL}/v1/config`, {
        headers: { "X-Config-Secret": env.RAYIN_GUARDRAILS_CONFIG_SECRET },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`rayin-guardrails returned ${res.status} fetching /v1/config`);
      }

      const parsed = ConfigResponseSchema.parse(await res.json());
      return { configured: true as const, ...parsed };
    }),

  updateConfig: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        piiEntities: z.array(z.enum(ALL_PII_ENTITIES)).optional(),
        jailbreakEnabled: z.boolean().optional(),
        topicalEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Deliberately project:update, not projectGuardrails:read -- this
      // changes enforcement for every user in the project, the same bar
      // UI Customization's write path uses, not just a read permission.
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "project:update",
      });

      if (!env.RAYIN_GUARDRAILS_URL) {
        throw new Error(
          "RAYIN_GUARDRAILS_URL is not configured for this deployment — nothing to push this change to.",
        );
      }
      if (!env.RAYIN_GUARDRAILS_CONFIG_SECRET) {
        throw new Error(
          "RAYIN_GUARDRAILS_CONFIG_SECRET is not configured — refusing to call an endpoint we can't authenticate to.",
        );
      }

      const res = await fetch(`${env.RAYIN_GUARDRAILS_URL}/v1/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Config-Secret": env.RAYIN_GUARDRAILS_CONFIG_SECRET,
        },
        body: JSON.stringify({
          pii_entities: input.piiEntities,
          jailbreak_enabled: input.jailbreakEnabled,
          topical_enabled: input.topicalEnabled,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`rayin-guardrails rejected the config update (${res.status}): ${detail}`);
      }

      const parsed = ConfigResponseSchema.parse(await res.json());
      return parsed;
    }),
});
