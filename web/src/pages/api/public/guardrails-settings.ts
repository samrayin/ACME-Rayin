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
 * Part b (the enforcement switch): the mode served is the one in force, so
 * an enforce trial whose switch-back time has passed is served as record at
 * once. The pull also writes that automatic switch-back as a new, audited
 * version, so it happens within one pull interval of its time even when
 * nobody has the console open. The audit entry names this pull's API key,
 * because that is what wrote it.
 *
 * The settings are read before the status write, which is best effort, so a
 * failed status write never denies a pod its settings. The switch-back write
 * is best effort too: if it fails, the trial is still served as record.
 * 503 when no settings are stored: the pod keeps what it has and reports
 * "settings unknown".
 */
import { z } from "zod";
import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { prisma } from "@langfuse/shared/src/db";
import { ForbiddenError, ServiceUnavailableError } from "@langfuse/shared";
import { logger } from "@langfuse/shared/src/server";
import { env } from "@/src/env.mjs";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  applyExpiredRevert,
  getCurrentSettings,
  GUARDRAIL_MODES,
  MAX_SETTINGS_VERSION,
  parseModeCeiling,
  POD_NAME_PATTERN,
  recordPodSync,
  settingsForAudit,
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
  mode: z.enum(GUARDRAIL_MODES),
  pii_entities: z.array(z.string()),
  jailbreak_enabled: z.boolean(),
  topical_enabled: z.boolean(),
  updated_at: z.string(),
  // While a trial is served as enforce: when it switches back (SF-2026-024).
  revert_at: z.iso.datetime().nullable(),
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
      const now = new Date();
      const ceiling = parseModeCeiling(env.CAIRO_GUARDRAIL_MODE_MAX);

      try {
        // An ended trial, or an enforce version this console's ceiling does
        // not allow, is written down as an automatic record version
        // (security review P2-269-2).
        const reverted = await applyExpiredRevert(
          prisma,
          { projectId: auth.scope.projectId, now, ceiling },
          async (tx, { before, current }) => {
            await auditLog(
              {
                apiKeyId: auth.scope.apiKeyId,
                orgId: auth.scope.orgId,
                projectId: auth.scope.projectId,
                resourceType: "acmeGuardrailSettings",
                resourceId: `v${current.version}`,
                action: "automatic_revert",
                before: before ? settingsForAudit(before) : null,
                after: settingsForAudit(current),
              },
              // The audit row commits with the switch-back version (Q1).
              tx as unknown as typeof prisma,
            );
          },
        );
        if (reverted.changed) {
          logger.info(
            `guardrail settings: automatic switch-back to record written as version ${reverted.current.version}`,
          );
        }
      } catch (e) {
        logger.warn(
          `guardrail settings sync: could not write the automatic switch-back: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      const current = await getCurrentSettings(prisma);
      if (!current) {
        throw new ServiceUnavailableError(
          "No guardrail settings are stored in EYEON yet.",
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

      // The console's own ceiling caps what the pods are told (SF-2026-023).
      return toSyncResponse(current, now, ceiling);
    },
  }),
});
