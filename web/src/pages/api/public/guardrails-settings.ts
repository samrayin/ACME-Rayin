/**
 * ACME addition (ADR-0005-B part a, CHG-2026-089): rayin-guardrails pods pull
 * CAIRO's guardrail settings here, at start and every 30 seconds, and report
 * which settings version they have applied.
 *
 * POST, not GET: each call also records the calling pod's applied version
 * (acme_guardrail_settings_pods), which the console shows as "n of n pods on
 * version v".
 *
 * Auth: the project-scoped API key rayin-guardrails already uses to push
 * events (guardrails-events.ts), with the API-only scope
 * guardrailsSettings:sync -- and accepted only from the one project named in
 * CAIRO_GUARDRAILS_SYNC_PROJECT_ID (owner decision 2026-10-01, after the
 * security review, SF-2026-016). Every project key holds the scope, so
 * without that allowlist any project's key could read the deployment-wide
 * policy and write pod-status rows. Unset, every call is refused (fail
 * closed). The response carries the policy only, no secrets. Meant to be
 * called over in-cluster service DNS.
 *
 * The settings are read first and the status write is best effort, so a
 * failed status write never denies a pod its settings. 503 when no settings
 * are stored: the pod keeps what it has and reports "settings unknown".
 */
import { z } from "zod";
import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { prisma } from "@langfuse/shared/src/db";
import { ForbiddenError, ServiceUnavailableError } from "@langfuse/shared";
import { logger } from "@langfuse/shared/src/server";
import { env } from "@/src/env.mjs";
import {
  getCurrentSettings,
  MAX_SETTINGS_VERSION,
  POD_NAME_PATTERN,
  recordPodSync,
  toSyncResponse,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

const GuardrailsSettingsSyncBody = z.object({
  // The pod's own name (HOSTNAME): a DNS-1123 label. It becomes a primary key.
  pod: z.string().regex(POD_NAME_PATTERN),
  // The settings version the pod has applied; null before its first pull.
  applied_version: z.number().int().min(1).max(MAX_SETTINGS_VERSION).nullable(),
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
      const allowedProject = env.CAIRO_GUARDRAILS_SYNC_PROJECT_ID;
      if (!allowedProject || auth.scope.projectId !== allowedProject) {
        throw new ForbiddenError("This key may not sync guardrail settings.");
      }

      const current = await getCurrentSettings(prisma);
      if (!current) {
        throw new ServiceUnavailableError(
          "No guardrail settings are stored in CAIRO yet.",
        );
      }

      try {
        await recordPodSync(prisma, {
          pod: body.pod,
          appliedVersion: body.applied_version,
          projectId: auth.scope.projectId,
        });
      } catch (e) {
        logger.warn(
          `guardrail settings sync: could not record status for pod ${body.pod}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      return toSyncResponse(current);
    },
  }),
});
