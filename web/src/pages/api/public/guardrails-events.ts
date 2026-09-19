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

const PiiFindingSchema = z.object({
  entity_type: z.string(),
  start: z.number(),
  end: z.number(),
  score: z.number(),
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
  event_time: z.string().datetime(),
  direction: z.enum(["input", "output"]),
  action: z.enum(["allow", "redact", "block"]),
  policy_triggered: z.string().nullable(),
  redacted_text: z.string().nullable(),
  pii_findings: z.array(PiiFindingSchema).nullable(),
  // Plaintext over the wire, encrypted server-side immediately before the
  // Prisma write -- see acmeGuardrailsEventsIngestService.ts. This endpoint
  // must only ever be reachable via in-cluster service DNS, never the
  // public ingress, given this field's contents.
  raw_content: z.string().nullable(),
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
      }),
  }),
});

export const config = {
  api: {
    bodyParser: {
      // Block-tier raw content can be arbitrarily long user/model text --
      // generous but bounded, matching this repo's other content-bearing
      // public API routes rather than the tighter feedback.ts-style limits
      // meant for short structured payloads.
      sizeLimit: "1mb",
    },
  },
};
