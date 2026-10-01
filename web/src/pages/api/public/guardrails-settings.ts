/**
 * ACME addition (ADR-0005-B part a, CHG-2026-089): rayin-guardrails pods pull
 * CAIRO's guardrail settings here, at start and every 30 seconds, and report
 * which settings version they have applied.
 *
 * POST, not GET: each call also records the calling pod's applied version
 * (acme_guardrail_settings_pods), which the console shows as "n of n pods on
 * version v".
 *
 * Auth: the same project-scoped API key rayin-guardrails already uses to push
 * events (guardrails-events.ts), gated on the API-only scope
 * guardrailsSettings:sync, which no UI role holds. The response carries the
 * policy only, no secrets. Like guardrails-events, this route is meant to be
 * called over in-cluster service DNS.
 *
 * 503 when no settings are stored: the pod keeps what it has and reports
 * "settings unknown" rather than applying anything invented here.
 */
import { z } from "zod";
import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { prisma } from "@langfuse/shared/src/db";
import { ServiceUnavailableError } from "@langfuse/shared";
import {
  getCurrentSettings,
  recordPodSync,
  toSyncResponse,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

const GuardrailsSettingsSyncBody = z.object({
  // The pod's own name (HOSTNAME). Bounded: it becomes a primary key.
  pod: z.string().min(1).max(255),
  // The settings version the pod has applied; null before its first pull.
  applied_version: z.number().int().min(1).nullable(),
});

const GuardrailsSettingsSyncResponse = z.object({
  version: z.number().int(),
  mode: z.literal("record"),
  pii_entities: z.array(z.string()),
  jailbreak_enabled: z.boolean(),
  topical_enabled: z.boolean(),
  updated_at: z.string(),
});

export default withMiddlewares({
  POST: createAuthedProjectAPIRoute({
    name: "Sync Guardrails Settings",
    action: "guardrailsSettings:sync",
    bodySchema: GuardrailsSettingsSyncBody,
    responseSchema: GuardrailsSettingsSyncResponse,
    successStatusCode: 200,
    fn: async ({ body, auth }) => {
      await recordPodSync(prisma, {
        pod: body.pod,
        appliedVersion: body.applied_version,
        projectId: auth.scope.projectId,
      });
      const current = await getCurrentSettings(prisma);
      if (!current) {
        throw new ServiceUnavailableError(
          "No guardrail settings are stored in CAIRO yet.",
        );
      }
      return toSyncResponse(current);
    },
  }),
});
