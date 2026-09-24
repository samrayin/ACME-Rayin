/**
 * ACME addition (ADR-0003, CHG-2026-005): the append-only record of every
 * mutating action CAIRO takes against the LiteLLM gateway.
 *
 * Same isolation as acmeGuardrailsEventsIngestService.ts, for the same
 * reason -- the control is the database connection, not this code:
 *
 * - Its own PrismaClient, bound to RAYIN_LITELLM_WRITER_DATABASE_URL (the
 *   rayin_litellm_writer role: INSERT on the append-only LiteLLM tables,
 *   nothing else -- no SELECT, UPDATE or DELETE). NOT the shared `prisma`
 *   singleton. It refuses to fall back to the general connection: a record
 *   written through a connection that could also rewrite it is not the
 *   record ADR-0003 promises.
 * - This module is the ONLY place that client may be used.
 *
 * `auditedMutation` is the wrapper every mutating LiteLLM operation goes
 * through:
 *   1. INTENT row. If this write fails, the mutation is NOT attempted.
 *   2. The mutation.
 *   3. OUTCOME row (success / failure / partial) BEFORE the caller gets a
 *      result. If the mutation succeeded but this write fails, the caller
 *      gets an error, never a success: the INTENT row already on record and
 *      drift detection show the mismatch.
 * Key material is never written: see `scrubForRecord`.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { env } from "@/src/env.mjs";
import { logger } from "@langfuse/shared/src/server";

let writerClient: PrismaClient | null = null;

export function getLitellmWriterClient(): PrismaClient {
  if (!env.RAYIN_LITELLM_WRITER_DATABASE_URL) {
    throw new Error(
      "RAYIN_LITELLM_WRITER_DATABASE_URL is not configured -- refusing to " +
        "fall back to the general database connection for the append-only " +
        "LiteLLM record. See ADR-0003 and POSTGRES-COMPLIANCE-FRAMEWORK.md.",
    );
  }
  if (writerClient === null) {
    writerClient = new PrismaClient({
      datasourceUrl: env.RAYIN_LITELLM_WRITER_DATABASE_URL,
    });
  }
  return writerClient;
}

type LitellmEventAction =
  | "key.create"
  | "key.update"
  | "key.revoke"
  | "key.rotate"
  | "key.rotate.create"
  | "key.rotate.revoke"
  | "key.rotate.compensate"
  | "team.create"
  | "team.update"
  | "team.delete"
  // ADR-0010 (CHG-2026-056): console-managed models and the smart router.
  | "model.create"
  | "model.update"
  | "model.delete"
  | "router.create"
  | "router.update"
  | "router.delete";

export type LitellmEventActor = {
  userId: string;
  orgRole?: string | null;
  projectRole?: string | null;
};

export type LitellmEventInput = {
  correlationId: string;
  phase: "INTENT" | "OUTCOME";
  outcome?: "SUCCESS" | "FAILURE" | "PARTIAL";
  action: LitellmEventAction;
  resourceType: "litellmKey" | "litellmTeam" | "litellmModel";
  resourceId: string;
  orgId: string;
  projectId: string;
  actor: LitellmEventActor;
  before?: unknown;
  after?: unknown;
  errorMessage?: string | null;
};

const SECRET_PROPERTY =
  /^(key|secret|api_key|apikey|master_key|password|authorization)$/i;
const KEY_LIKE = /\bsk-[A-Za-z0-9_-]{6,}/g;

/**
 * Defence in depth: callers already pass only safe settings, but nothing
 * shaped like a key may ever reach the record. Drops properties whose name
 * says "secret" and redacts anything shaped like a LiteLLM key. `token_hash`
 * / `tokenHash` are deliberately kept: a SHA-256 is an identifier, not key
 * material.
 */
export function scrubForRecord(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(KEY_LIKE, "[REDACTED]");
  if (Array.isArray(value)) return value.map(scrubForRecord);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_PROPERTY.test(k)) continue;
      out[k] = scrubForRecord(v);
    }
    return out;
  }
  return value;
}

/** Pure: unit-testable without a database. */
export function buildLitellmEventRow(
  input: LitellmEventInput,
): Prisma.AcmeLitellmEventCreateManyInput {
  const before = scrubForRecord(input.before);
  const after = scrubForRecord(input.after);
  return {
    correlationId: input.correlationId,
    phase: input.phase,
    outcome:
      input.phase === "OUTCOME" ? (input.outcome ?? "FAILURE") : undefined,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    orgId: input.orgId,
    projectId: input.projectId,
    actorUserId: input.actor.userId,
    actorOrgRole: input.actor.orgRole ?? null,
    actorProjectRole: input.actor.projectRole ?? null,
    before:
      before === undefined || before === null
        ? undefined
        : (before as Prisma.InputJsonValue),
    after:
      after === undefined || after === null
        ? undefined
        : (after as Prisma.InputJsonValue),
    errorMessage:
      input.errorMessage === undefined || input.errorMessage === null
        ? null
        : String(scrubForRecord(input.errorMessage)).slice(0, 1000),
  };
}

export type LitellmEventWriteFn = (input: LitellmEventInput) => Promise<void>;

export const writeLitellmEvent: LitellmEventWriteFn = async (input) => {
  // createMany, NOT create: Prisma's `create` issues INSERT ... RETURNING,
  // and Postgres requires SELECT privilege for RETURNING -- which the
  // rayin_litellm_writer role deliberately does not have. createMany is a
  // plain INSERT. (Same reason acmeGuardrailsEventsIngestService uses it.)
  const written = await getLitellmWriterClient().acmeLitellmEvent.createMany({
    data: [buildLitellmEventRow(input)],
  });
  if (written.count !== 1) {
    throw new Error(`expected to write 1 audit row, wrote ${written.count}`);
  }
};

/** The INTENT row could not be written, so the mutation was never attempted. */
export class LitellmAuditIntentError extends Error {
  constructor(detail: string) {
    super(
      `The action was NOT performed: its audit record could not be written first (${detail}).`,
    );
    this.name = "LitellmAuditIntentError";
  }
}

/** The mutation happened, but its OUTCOME row could not be written. */
export class LitellmAuditOutcomeError extends Error {
  constructor(
    public readonly correlationId: string,
    detail: string,
  ) {
    super(
      `The action was performed in LiteLLM but its outcome could not be recorded (${detail}). ` +
        `It is NOT reported as successful. Correlation ID ${correlationId}.`,
    );
    this.name = "LitellmAuditOutcomeError";
  }
}

export type AuditedMutationContext = Omit<
  LitellmEventInput,
  "phase" | "outcome" | "after" | "errorMessage" | "correlationId"
> & { correlationId?: string };

/** What the wrapped operation reports back for the OUTCOME row. */
export type AuditedMutationResult<T> = {
  result: T;
  /** Safe description of the new state. Never key material. */
  after?: unknown;
  /** Defaults to SUCCESS. PARTIAL is for e.g. a rotation left half-done. */
  outcome?: "SUCCESS" | "PARTIAL";
  errorMessage?: string;
};

export async function auditedMutation<T>(
  context: AuditedMutationContext,
  run: (correlationId: string) => Promise<AuditedMutationResult<T>>,
  write: LitellmEventWriteFn = writeLitellmEvent,
): Promise<T> {
  const correlationId = context.correlationId ?? randomUUID();
  const base = { ...context, correlationId };

  try {
    await write({ ...base, phase: "INTENT" });
  } catch (e) {
    logger.error(
      "acmeLitellm: INTENT audit write failed; mutation not attempted",
      {
        action: context.action,
        correlationId,
        error: e instanceof Error ? e.message : String(e),
      },
    );
    throw new LitellmAuditIntentError(
      e instanceof Error ? e.name : "unknown error",
    );
  }

  let ran: AuditedMutationResult<T>;
  try {
    ran = await run(correlationId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await write({
        ...base,
        phase: "OUTCOME",
        outcome: "FAILURE",
        errorMessage: message,
      });
    } catch (writeError) {
      // The INTENT row stands; the original failure is what the caller needs.
      logger.error("acmeLitellm: OUTCOME(FAILURE) audit write failed", {
        action: context.action,
        correlationId,
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
    }
    throw e;
  }

  try {
    await write({
      ...base,
      phase: "OUTCOME",
      outcome: ran.outcome ?? "SUCCESS",
      after: ran.after,
      errorMessage: ran.errorMessage ?? null,
    });
  } catch (e) {
    logger.error(
      "acmeLitellm: OUTCOME audit write failed AFTER a successful mutation",
      {
        action: context.action,
        correlationId,
        error: e instanceof Error ? e.message : String(e),
      },
    );
    throw new LitellmAuditOutcomeError(
      correlationId,
      e instanceof Error ? e.name : "unknown error",
    );
  }
  return ran.result;
}
