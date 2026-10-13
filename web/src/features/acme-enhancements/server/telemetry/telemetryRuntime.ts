/**
 * ACME addition (CHG-2026-155): the wiring for the EYEON telemetry ingest. This
 * is the only file that touches a database or the tracing engine on the ingest's
 * behalf. The pipeline itself (telemetryIngest.ts) is pure and injected.
 *
 * Database access, in full (three statements, nothing else):
 *   Q1  key lookup      SELECT  as rayin_telemetry_reader (column-level grant)
 *   Q2  policy lookup   SELECT  as rayin_telemetry_reader
 *   Q3  counters upsert INSERT .. ON CONFLICT as rayin_telemetry_writer
 * Q1 and Q2 run on a connection of their own and REFUSE to fall back to the
 * console's general connection: if RAYIN_TELEMETRY_READER_DATABASE_URL is unset
 * the ingest answers 503. Q3 is skipped (counters stay in memory) if
 * RAYIN_TELEMETRY_WRITER_DATABASE_URL is unset; it is never run on another login.
 * The engine handoff does an S3 write and a queue publish and no SQL (SP-1).
 *
 * Nothing here logs a value. Errors are logged by NAME only.
 *
 * Pre-auth size and per-IP limits are the ingress / WAF's job (a listed
 * pre-real-data item). This process limits per key, after authentication.
 */
import { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";
import { logger } from "@langfuse/shared/src/server";
import { env } from "@/src/env.mjs";
import { $root } from "@/src/pages/api/public/otel/otlp-proto/generated/root";
import {
  gunzipOtelRequestBody,
  OtelRequestBodyTooLargeError,
  readOtelRequestBody,
} from "@/src/server/otel/otelRequestBody";
import { processOtelIngestion } from "@/src/server/otel/processOtelIngestion";
import { createKeyAuthenticator, type KeyRecord } from "./telemetryAuth";
import {
  contentModesGateEnabled,
  telemetryMaxBodyBytes,
  telemetryRatePerKeyPerMin,
  telemetryReaderDatabaseUrl,
  telemetryWriterDatabaseUrl,
} from "./telemetryFlags";
import { MalformedTelemetryError } from "./telemetryFilter";
import {
  TelemetryBodyTooLargeError,
  type TelemetryDeps,
  type TelemetryHttpRequest,
} from "./telemetryIngest";
import { createPolicyCache, type PolicyRow } from "./telemetryPolicy";
import { createKeyedRateLimiter } from "./telemetryRateLimit";
import {
  buildUpsertSql,
  createStatsRecorder,
  upsertParams,
  type StatsRow,
} from "./telemetryStats";

// ---------------------------------------------------------------- connections

let readerClient: PrismaClient | null = null;
function getReaderClient(): PrismaClient {
  const url = telemetryReaderDatabaseUrl();
  if (url === undefined) {
    throw new Error(
      "RAYIN_TELEMETRY_READER_DATABASE_URL is not configured -- refusing to " +
        "fall back to the general database connection for the telemetry ingest.",
    );
  }
  if (readerClient === null) {
    readerClient = new PrismaClient({ datasourceUrl: url });
  }
  return readerClient;
}

let writerClient: PrismaClient | null = null;
function getWriterClient(): PrismaClient | null {
  const url = telemetryWriterDatabaseUrl();
  if (url === undefined) return null;
  if (writerClient === null) {
    writerClient = new PrismaClient({ datasourceUrl: url });
  }
  return writerClient;
}

// ------------------------------------------------------------------ Q1: a key

type KeyRow = {
  id: string;
  orgId: string;
  projectId: string;
  lineageId: string;
  displayName: string;
  tokenHash: string | null;
  status: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

async function lookupKey(tokenHash: string): Promise<KeyRecord | null> {
  const rows = await getReaderClient().$queryRaw<KeyRow[]>`
    SELECT "id", "org_id" AS "orgId", "project_id" AS "projectId",
           "lineage_id" AS "lineageId", "display_name" AS "displayName",
           "token_hash" AS "tokenHash", "status"::text AS "status",
           "expires_at" AS "expiresAt", "revoked_at" AS "revokedAt"
    FROM "acme_litellm_keys"
    WHERE "token_hash" = ${tokenHash}
    LIMIT 1`;
  const row = rows[0];
  if (row === undefined) return null;
  // The database enum is lower-case ('active'); the key record carries the
  // console's enum member names ("ACTIVE").
  return { ...row, status: row.status.toUpperCase() };
}

// --------------------------------------------------------------- Q2: a policy

type PolicyDbRow = {
  projectId: string;
  enabled: boolean;
  contentMode: string;
  userIdMode: string;
  attributeAllowlistExtra: string[] | null;
  retentionDays: number | null;
  version: number;
  userHashSalt: string;
};

async function loadPolicyRow(projectId: string): Promise<PolicyRow | null> {
  const rows = await getReaderClient().$queryRaw<PolicyDbRow[]>`
    SELECT "project_id" AS "projectId", "enabled",
           "content_mode" AS "contentMode", "user_id_mode" AS "userIdMode",
           "attribute_allowlist_extra" AS "attributeAllowlistExtra",
           "retention_days" AS "retentionDays", "version",
           "user_hash_salt" AS "userHashSalt"
    FROM "acme_telemetry_policy"
    WHERE "project_id" = ${projectId}
    LIMIT 1`;
  const r = rows[0];
  if (r === undefined) return null;
  // CHECK constraints already hold these sets. Anything unexpected falls to the
  // most restrictive reading rather than being trusted: the content mode to
  // metadata, and the end-user id to drop (nothing derived from it is stored).
  return {
    projectId: r.projectId,
    enabled: r.enabled === true,
    contentMode:
      r.contentMode === "redacted" || r.contentMode === "full"
        ? r.contentMode
        : "metadata",
    userIdMode:
      r.userIdMode === "hash" ||
      r.userIdMode === "drop" ||
      r.userIdMode === "pass"
        ? r.userIdMode
        : "drop",
    attributeAllowlistExtra: Array.isArray(r.attributeAllowlistExtra)
      ? r.attributeAllowlistExtra
      : [],
    retentionDays: r.retentionDays,
    version: Number(r.version),
    userHashSalt: r.userHashSalt,
  };
}

// ------------------------------------------------------------- Q3: the counters

let warnedNoWriter = false;

async function writeStats(rows: StatsRow[]): Promise<void> {
  const client = getWriterClient();
  if (client === null) {
    if (!warnedNoWriter) {
      warnedNoWriter = true;
      logger.warn(
        "telemetry ingest: RAYIN_TELEMETRY_WRITER_DATABASE_URL is not set, counters are not persisted",
      );
    }
    return;
  }
  for (const row of rows) {
    // The statement text is a constant built from the closed STAT_COLUMNS list;
    // every value is a bound parameter.
    await client.$executeRawUnsafe(buildUpsertSql(), ...upsertParams(row));
  }
}

// -------------------------------------------------------------- decode, handoff

const OTLP_REQUEST =
  $root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

/** Protobuf or JSON body to the `resourceSpans` array, shaped as the filter expects. */
function decodeOtlpTraces(body: Buffer, contentType: string): unknown {
  if (contentType.includes("application/x-protobuf")) {
    try {
      const parsed = OTLP_REQUEST.decode(body);
      // int64 as decimal strings, as the OTLP JSON encoding does.
      return (
        OTLP_REQUEST.toObject(parsed, { longs: String }).resourceSpans ?? []
      );
    } catch {
      throw new MalformedTelemetryError();
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new MalformedTelemetryError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MalformedTelemetryError();
  }
  const spans = (parsed as { resourceSpans?: unknown }).resourceSpans;
  return spans === undefined || spans === null ? [] : spans;
}

// ---------------------------------------------------------------------- runtime

export type TelemetryRuntime = { deps: TelemetryDeps };

let runtime: TelemetryRuntime | null = null;

/** Built on first use, so a flag-off deployment never constructs anything. */
export function getTelemetryRuntime(): TelemetryRuntime {
  if (runtime !== null) return runtime;

  const authenticator = createKeyAuthenticator({
    lookup: lookupKey,
    now: Date.now,
  });
  const policies = createPolicyCache({ load: loadPolicyRow, now: Date.now });
  const limiter = createKeyedRateLimiter(telemetryRatePerKeyPerMin(), 60_000);
  const stats = createStatsRecorder({
    now: Date.now,
    write: writeStats,
    onWriteError: (errorName) =>
      logger.warn("telemetry ingest: counters write failed", { errorName }),
  });

  runtime = {
    deps: {
      now: Date.now,
      authenticate: (headers) => authenticator.authenticate(headers),
      loadPolicy: (projectId) => policies.get(projectId),
      contentModesGateOpen: contentModesGateEnabled(),
      maxBodyBytes: telemetryMaxBodyBytes(
        env.LANGFUSE_OTEL_INGESTION_MAX_BODY_BYTES,
      ),
      rateLimit: (keyId, nowMs) => limiter.check(keyId, nowMs),
      decode: decodeOtlpTraces,
      handoff: async (input) => {
        const result = await processOtelIngestion({
          body: input.body,
          contentType: input.contentType,
          encodedBodyBytes: input.encodedBodyBytes,
          config: input.config,
        });
        // The engine's body (its job object, its messages) goes no further.
        return result.kind === "ok"
          ? { kind: "ok" }
          : { kind: "http", status: result.status };
      },
      record: (projectId, lineageId, delta) =>
        stats.record(projectId, lineageId, delta),
    },
  };
  return runtime;
}

/** Adapts Next's request to the pipeline's, reusing the engine's body helpers. */
export function adaptNextRequest(req: NextApiRequest): TelemetryHttpRequest {
  const asTooLarge = (error: unknown): unknown =>
    error instanceof OtelRequestBodyTooLargeError
      ? new TelemetryBodyTooLargeError(error.afterDecompression)
      : error;
  return {
    method: req.method,
    headers: req.headers,
    readBody: async (maxBytes) => {
      try {
        return await readOtelRequestBody(req, maxBytes);
      } catch (error) {
        throw asTooLarge(error);
      }
    },
    gunzip: async (body, maxBytes) => {
      try {
        return await gunzipOtelRequestBody(body, maxBytes);
      } catch (error) {
        throw asTooLarge(error);
      }
    },
  };
}
