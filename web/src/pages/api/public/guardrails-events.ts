/**
 * ACME addition: receives the durable audit-trail push from rayin-guardrails
 * (a separate service, not code in this repo) -- POSTGRES-COMPLIANCE-
 * FRAMEWORK.md is the full design this implements.
 *
 * Auth: project-scoped API key (the same public/secret key pair mechanism
 * every other /api/public/* route uses), not a bespoke shared secret --
 * framework doc decision #4. rayin-guardrails holds one project-scoped key
 * per project it serves; the project is derived entirely from the
 * authenticated key (auth.scope.projectId below), never from a
 * client-supplied field in the request body -- a client-supplied projectId
 * was exactly the cryptographic-binding gap the shared-secret design would
 * have had.
 *
 * gated on guardrailsEvents:create (packages/shared/src/features/rbac/
 * projectAccessRights.ts) -- a dedicated, API-only scope granted to no UI
 * role, matching the pattern already used for traces:create/scores:create.
 */
import { z } from "zod";
import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { ingestGuardrailsEvent } from "@/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService";
import {
  GUARDRAIL_MODES,
  MAX_SETTINGS_VERSION,
  POD_NAME_PATTERN,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

const PiiFindingSchema = z.object({
  entity_type: z.string(),
  start: z.number(),
  end: z.number(),
  score: z.number(),
});

// Which window the judge refused (rayin-guardrails >= the refused-window
// change). Positions and counts are bounded by the guard's own ceilings.
const RefusedWindowSchema = z.object({
  index: z.number().int().min(0).max(10_000),
  count: z.number().int().min(1).max(10_000),
  start: z.number().int().min(0).max(10_000_000),
  end: z.number().int().min(0).max(10_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  positions_exact: z.boolean(),
});

const GuardrailsEventPushBody = z.object({
  event_id: z.string().min(1),
  agent_id: z.string().min(1),
  trace_id: z.string().nullable(),
  // Human end-user identity -- see acmeGuardrailsEventsIngestService.ts.
  // Caller-asserted, not yet verified against an Entra ID token.
  user_id: z.string().nullable(),
  // Machine the request came from (hostname or device id), caller-asserted
  // like user_id. Optional, not just nullable, so a rayin-guardrails build
  // that predates this field keeps working during a staggered rollout.
  client_host: z.string().max(255).nullable().optional(),
  event_time: z.iso.datetime(),
  direction: z.enum(["input", "output"]),
  // "unavailable": no verdict, the judge model could not answer (N-64).
  // Metadata only: no content tier applies to it.
  action: z.enum(["allow", "redact", "block", "unavailable"]),
  policy_triggered: z.string().nullable(),
  redacted_text: z.string().nullable(),
  pii_findings: z.array(PiiFindingSchema).nullable(),
  // Plaintext over the wire, encrypted server-side immediately before the
  // Prisma write -- see acmeGuardrailsEventsIngestService.ts. This endpoint
  // must only ever be reachable via in-cluster service DNS, never the
  // public ingress, given this field's contents.
  raw_content: z.string().nullable(),
  // ADR-0005-B part a (CHG-2026-089): the guardrail settings version the
  // deciding pod had applied (null = settings unknown), and the pod's name.
  // Optional, like client_host, so older rayin-guardrails builds still work.
  settings_version: z
    .number()
    .int()
    .min(1)
    .max(MAX_SETTINGS_VERSION)
    .nullable()
    .optional(),
  pod: z.string().regex(POD_NAME_PATTERN).nullable().optional(),
  // ADR-0005-B part b: what the gateway replica that sent the request
  // reported about itself, passed through by rayin-guardrails. Optional, so
  // builds that predate part b still work; bounded like the fields above.
  gateway_pod: z.string().regex(POD_NAME_PATTERN).nullable().optional(),
  gateway_mode: z.enum(GUARDRAIL_MODES).nullable().optional(),
  gateway_settings_version: z
    .number()
    .int()
    .min(1)
    .max(MAX_SETTINGS_VERSION)
    .nullable()
    .optional(),
  // Blocked-prompt review, piece 1. Optional, so older builds still work.
  refused_window: RefusedWindowSchema.nullable().optional(),
  content_chars: z.number().int().min(0).max(10_000_000).nullable().optional(),
  content_truncated: z.boolean().nullable().optional(),
  content_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
});

const GuardrailsEventPushResponse = z.object({
  stored: z.literal(true),
  // true when the event was already stored (a retried push, or an earlier
  // pull reconciliation) and nothing new was written. Additive: callers that
  // only check the HTTP status are unaffected.
  duplicate: z.boolean(),
});

export default withMiddlewares({
  POST: createAuthedProjectAPIRoute({
    name: "Push Guardrails Event",
    action: "guardrailsEvents:create",
    bodySchema: GuardrailsEventPushBody,
    responseSchema: GuardrailsEventPushResponse,
    successStatusCode: 200,
    fn: async ({ body, auth }) =>
      await ingestGuardrailsEvent(auth.scope.projectId, {
        eventId: body.event_id,
        agentId: body.agent_id,
        traceId: body.trace_id,
        userId: body.user_id,
        clientHost: body.client_host ?? null,
        eventTime: body.event_time,
        direction: body.direction,
        action: body.action,
        policyTriggered: body.policy_triggered,
        redactedText: body.redacted_text,
        piiFindings: body.pii_findings,
        rawContent: body.raw_content,
        settingsVersion: body.settings_version ?? null,
        pod: body.pod ?? null,
        gatewayPod: body.gateway_pod ?? null,
        gatewayMode: body.gateway_mode ?? null,
        gatewaySettingsVersion: body.gateway_settings_version ?? null,
        refusedWindow: body.refused_window ?? null,
        contentChars: body.content_chars ?? null,
        contentTruncated: body.content_truncated ?? null,
        contentSha256: body.content_sha256 ?? null,
      }),
  }),
});

export const config = {
  api: {
    bodyParser: {
      // Block-tier raw content can be arbitrarily long user/model text --
      // generous but bounded. rayin-guardrails v0.8.0 refuses texts of up to
      // 600,000 characters (MAX_GUARD_TEXT_CHARS) and pushes them whole; at
      // up to 3 bytes a character in UTF-8, plus JSON escaping, that needs
      // more than the 1 MB this route allowed before.
      sizeLimit: "4mb",
    },
  },
};
