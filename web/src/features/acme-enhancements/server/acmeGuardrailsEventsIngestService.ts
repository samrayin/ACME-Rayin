/**
 * ACME addition: receives the durable audit-trail push from rayin-guardrails
 * (POSTGRES-COMPLIANCE-FRAMEWORK.md). Deliberately isolated from the rest of
 * this repo's Prisma access:
 *
 * - Its own PrismaClient, bound to RAYIN_GUARDRAILS_WRITER_DATABASE_URL (the
 *   rayin_guardrails_writer role -- INSERT-only on acme_guardrail_events,
 *   nothing else, per the framework doc's §2). NOT the shared `prisma`
 *   singleton from @langfuse/shared/src/db, which connects as the broader
 *   rayin_app_runtime role. The whole point of the narrow role is that a bug
 *   here -- this is the one endpoint that receives raw, attacker-influenced
 *   content from a service this repo doesn't control the code of -- can't
 *   reach anything beyond this one table, even at the TypeScript level this
 *   client's full model API doesn't reflect that restriction; the database
 *   connection itself is what actually enforces it.
 * - This module is the ONLY place that PrismaClient should ever be used.
 *   Do not import it elsewhere, and do not call any model other than
 *   acmeGuardrailEvent on it -- every other call will fail at the database
 *   with a permission error by design, not by convention.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { encrypt } from "@langfuse/shared/encryption";
import { env } from "@/src/env.mjs";
import { logger } from "@langfuse/shared/src/server";

let writerClient: PrismaClient | null = null;

function getWriterClient(): PrismaClient {
  if (!env.RAYIN_GUARDRAILS_WRITER_DATABASE_URL) {
    throw new Error(
      "RAYIN_GUARDRAILS_WRITER_DATABASE_URL is not configured -- refusing " +
        "to fall back to the general database connection for guardrail " +
        "event writes. See POSTGRES-COMPLIANCE-FRAMEWORK.md.",
    );
  }
  writerClient ??= new PrismaClient({
    datasourceUrl: env.RAYIN_GUARDRAILS_WRITER_DATABASE_URL,
  });
  return writerClient;
}

export type GuardrailsEventPushInput = {
  eventId: string;
  agentId: string;
  traceId: string | null;
  // Human end-user identity, distinct from agentId (the AI agent). Caller-
  // asserted for now -- rayin-guardrails forwards whatever it was given,
  // not yet verified against an Entra ID token. See the 2026-09-17
  // architecture review: without this, an investigation could answer
  // "which agent" but not "which employee".
  userId: string | null;
  eventTime: string;
  direction: "input" | "output";
  action: "allow" | "redact" | "block";
  policyTriggered: string | null;
  redactedText: string | null;
  piiFindings: Array<{
    entity_type: string;
    start: number;
    end: number;
    score: number;
  }> | null;
  rawContent: string | null;
};

/**
 * Pure transformation: tiered content by action (framework doc §1.1),
 * encrypting raw content for `block` events. Exported separately from the
 * DB-write wrapper below so this -- the actual new logic this endpoint
 * exists for -- is unit-testable without a live database connection. Takes
 * `encryptFn` as a parameter (defaults to the real `encrypt`) purely so
 * tests can substitute a spy without touching the module-level import.
 */
export function buildEventRow(
  projectId: string,
  input: GuardrailsEventPushInput,
  encryptionKey: string | undefined,
  encryptFn: (plainText: string, key: string) => string = encrypt,
): Prisma.AcmeGuardrailEventCreateManyInput {
  let rawContentEncrypted: string | null = null;
  if (input.action === "block" && input.rawContent !== null) {
    if (!encryptionKey) {
      // Fail closed, not silently-unencrypted: a Restricted-tier column
      // (framework doc §1.1) must never be written in plaintext because a
      // key happened to be missing at deploy time.
      throw new Error(
        "GUARDRAILS_ENCRYPTION_KEY is not configured -- refusing to " +
          "persist unencrypted raw guardrail content. See " +
          "POSTGRES-COMPLIANCE-FRAMEWORK.md.",
      );
    }
    rawContentEncrypted = encryptFn(input.rawContent, encryptionKey);
  }

  return {
    projectId,
    eventId: input.eventId,
    agentId: input.agentId,
    traceId: input.traceId,
    userId: input.userId,
    eventTime: new Date(input.eventTime),
    direction: input.direction === "input" ? "INPUT" : "OUTPUT",
    policyTriggered: input.policyTriggered,
    action:
      input.action === "allow"
        ? "ALLOW"
        : input.action === "redact"
          ? "REDACT"
          : "BLOCK",
    redactedText: input.action === "redact" ? input.redactedText : null,
    piiFindings:
      input.action === "redact" && input.piiFindings
        ? (input.piiFindings as unknown as Prisma.InputJsonValue)
        : undefined,
    rawContentEncrypted,
  };
}

/**
 * Persists one pushed guardrail event. Idempotent by design: a duplicate
 * event_id (e.g. rayin-guardrails retried a push that actually succeeded,
 * or the pull-based reconciliation later re-syncs the same event) is a
 * silent no-op, not an error -- createMany's skipDuplicates generates a bare
 * `ON CONFLICT DO NOTHING` (confirmed against the real plain unique index
 * on event_id, not an explicit-target form -- see the migration's own
 * comments for why a plain index needs no predicate here).
 */
export async function ingestGuardrailsEvent(
  projectId: string,
  input: GuardrailsEventPushInput,
): Promise<{ stored: true }> {
  const data = buildEventRow(projectId, input, env.GUARDRAILS_ENCRYPTION_KEY);

  const client = getWriterClient();
  try {
    await client.acmeGuardrailEvent.createMany({
      data: [data],
      skipDuplicates: true,
    });
  } catch (error) {
    logger.error("[guardrails-events] Failed to persist pushed event", {
      error,
      projectId,
      eventId: input.eventId,
    });
    throw error;
  }

  return { stored: true };
}
