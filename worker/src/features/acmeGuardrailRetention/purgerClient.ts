/**
 * ACME addition: the retention job's own PrismaClient, bound to
 * RAYIN_RETENTION_PURGER_DATABASE_URL (the rayin_retention_purger role --
 * SELECT + DELETE on acme_guardrail_events only, per
 * POSTGRES-COMPLIANCE-FRAMEWORK.md §2). Mirrors the writer-client isolation
 * in web/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService.ts:
 *
 * - NOT the shared `prisma` singleton from @langfuse/shared/src/db (the
 *   broader rayin_app_runtime role). acme_guardrail_events is append-only for
 *   every other role; this job is the one sanctioned delete path, and the
 *   database role -- not TypeScript -- is what enforces that it can touch
 *   nothing else.
 * - This module is the ONLY place this client is created. Do not import it
 *   elsewhere, and do not call any model other than acmeGuardrailEvent on it.
 * - No fallback: an unset URL throws rather than quietly using DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";

let purgerClient: PrismaClient | null = null;

export function getPurgerClient(purgerDatabaseUrl: string | undefined): PrismaClient {
  if (!purgerDatabaseUrl) {
    throw new Error(
      "RAYIN_RETENTION_PURGER_DATABASE_URL is not configured -- refusing " +
        "to fall back to the general database connection for guardrail " +
        "event retention. See POSTGRES-COMPLIANCE-FRAMEWORK.md §1.3.",
    );
  }
  purgerClient ??= new PrismaClient({ datasourceUrl: purgerDatabaseUrl });
  return purgerClient;
}
