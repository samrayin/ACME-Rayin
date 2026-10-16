/**
 * ACME addition (EYEON telemetry ingest, LLD section 5): steps A to F in order.
 *
 *   A authenticate  B policy  C limits  D decode and allowlist  E stamp  F hand off
 *
 * Everything with an effect is injected (`TelemetryDeps`), so the whole pipeline
 * runs in a unit test with no database, no queue and no network, and the test
 * can inspect the EXACT payload that would have been handed to the engine. That
 * payload, not the HTTP response, is what the canary tests assert on.
 *
 * Rules this file keeps:
 * - The response never carries an engine identifier. The engine's job object is
 *   dropped; the success body is an empty OTLP success.
 * - A filter error drops the whole batch. Nothing is passed through unfiltered.
 * - Nothing here logs. Counters carry counts only.
 * - The key is used once, in telemetryAuth, and is not a field of anything.
 */
import { randomUUID } from "crypto";
import { ALLOWLIST_VERSION, MAX_SPANS_PER_BATCH } from "./telemetryAllowlist";
import { UNAUTHORIZED_BODY, type AuthenticatedKey } from "./telemetryAuth";
import {
  countProtobufSpans,
  TelemetryTooManySpansError,
} from "./telemetryDecode";
import { gunzipOutputLimit } from "./telemetryFlags";
import {
  countSpans,
  filterResourceSpans,
  MalformedTelemetryError,
  type FilterResult,
} from "./telemetryFilter";
import { resolveEffectivePolicy, type PolicyRow } from "./telemetryPolicy";
import type { RateDecision } from "./telemetryRateLimit";
import { stampResourceSpans } from "./telemetryStamp";
import type { StatsDelta } from "./telemetryStats";

/** The synthetic scope handed to the engine (SP-1). Fixed strings, no secret. */
export const HANDOFF_PUBLIC_KEY = "eyeon:telemetry-ingest";
export const HANDOFF_SDK_NAME = "eyeon-telemetry-ingest";
export const HANDOFF_SDK_VERSION = "1";
/** Required: version 4 selects the direct events write (SP-1, worker :78-98). */
export const HANDOFF_INGESTION_VERSION = "4";

export class TelemetryBodyTooLargeError extends Error {
  constructor(public readonly afterDecompression = false) {
    super("Telemetry request body exceeds the limit");
    this.name = "TelemetryBodyTooLargeError";
  }
}

type HeaderBag = Record<string, string | string[] | undefined>;

export type TelemetryHttpRequest = {
  method?: string;
  headers: HeaderBag;
  /** Reads the raw body; throws TelemetryBodyTooLargeError above `maxBytes`. */
  readBody: (maxBytes: number) => Promise<Buffer>;
  /** Throws TelemetryBodyTooLargeError when the DECODED size passes `maxBytes`. */
  gunzip: (body: Buffer, maxBytes: number) => Promise<Buffer>;
};

export type TelemetryHttpResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** The oversize body was not fully read: close the connection. */
  closeConnection?: boolean;
};

export type HandoffInput = {
  body: Buffer;
  contentType: string;
  encodedBodyBytes: number;
  config: {
    projectId: string;
    publicKey: string;
    orgId: string;
    sdkName: string;
    sdkVersion: string;
    ingestionVersion: string;
  };
};

export type HandoffResult = { kind: "ok" } | { kind: "http"; status: number };

export type TelemetryDeps = {
  now: () => number;
  authenticate: (headers: HeaderBag) => Promise<AuthenticatedKey | null>;
  loadPolicy: (projectId: string) => Promise<PolicyRow | null>;
  contentModesGateOpen: boolean;
  /** The encoded (wire) body limit. */
  maxBodyBytes: number;
  /** What may reach the decoder: the gunzipped body, or the plain body (B1). */
  maxDecodedBytes: number;
  rateLimit: (keyId: string, nowMs: number) => RateDecision;
  /** Protobuf or JSON to the `resourceSpans` array. Throws MalformedTelemetryError. */
  decode: (body: Buffer, contentType: string) => unknown;
  handoff: (input: HandoffInput) => Promise<HandoffResult>;
  record: (
    projectId: string | null,
    lineageId: string | null,
    delta: StatsDelta,
  ) => void;
  newBatchId?: () => string;
};

const OK_BODY = {} as const;

function reject(
  status: number,
  message: string,
  extra: Partial<TelemetryHttpResponse> = {},
): TelemetryHttpResponse {
  return { status, body: { message }, ...extra };
}

function dropDelta(filtered: FilterResult): StatsDelta {
  const c = filtered.counts;
  return {
    spans_in: c.spansIn,
    spans_out: c.spansOut,
    attrs_dropped: c.attrsDropped,
    dropped_not_allowlisted: c.drops.notAllowlisted,
    dropped_reserved: c.drops.reserved,
    dropped_cost: c.drops.cost,
    dropped_content: c.drops.content,
    dropped_bad_value: c.drops.badValue,
    dropped_user_id: c.drops.userId,
    dropped_spans: c.spansDropped,
    dropped_events: c.eventsDropped,
    dropped_links: c.linksDropped,
    names_normalised: c.namesNormalised,
  };
}

export async function handleTelemetryRequest(
  req: TelemetryHttpRequest,
  deps: TelemetryDeps,
): Promise<TelemetryHttpResponse> {
  if (req.method !== "POST") {
    return reject(405, "Method not allowed", { headers: { Allow: "POST" } });
  }

  // A. Authenticate. Header only; the body has not been touched.
  let key: AuthenticatedKey | null;
  try {
    key = await deps.authenticate(req.headers);
  } catch {
    deps.record(null, null, { rejected_engine: 1 });
    return reject(503, "Temporarily unable to accept telemetry");
  }
  if (key === null) {
    deps.record(null, null, { rejected_auth: 1 });
    return { status: 401, body: UNAUTHORIZED_BODY };
  }
  const { projectId, lineageId } = key;

  // B. Policy. A project with no row, or enabled = false, is 403.
  let row: PolicyRow | null;
  try {
    row = await deps.loadPolicy(projectId);
  } catch {
    deps.record(projectId, lineageId, { rejected_engine: 1 });
    return reject(503, "Temporarily unable to accept telemetry");
  }
  const policy = resolveEffectivePolicy(row, deps.contentModesGateOpen);
  if (policy === null) {
    deps.record(projectId, lineageId, { rejected_disabled: 1 });
    return reject(403, "Telemetry is not enabled for this project");
  }

  // C. Limits. Type, then rate, then size (before decode, and after gunzip).
  const contentType = firstHeader(req.headers["content-type"])?.toLowerCase();
  const isProtobuf = contentType?.includes("application/x-protobuf") === true;
  const isJson = contentType?.includes("application/json") === true;
  if (contentType === undefined || (!isProtobuf && !isJson)) {
    deps.record(projectId, lineageId, { rejected_type: 1 });
    return reject(415, "Unsupported content type");
  }
  const encoding = firstHeader(req.headers["content-encoding"])
    ?.trim()
    .toLowerCase();
  const gzipped = encoding === "gzip";
  if (
    encoding !== undefined &&
    encoding !== "" &&
    encoding !== "identity" &&
    !gzipped
  ) {
    deps.record(projectId, lineageId, { rejected_type: 1 });
    return reject(415, "Unsupported content encoding");
  }

  const nowMs = deps.now();
  const rate = deps.rateLimit(key.keyId, nowMs);
  if (!rate.allowed) {
    deps.record(projectId, lineageId, { rejected_rate: 1 });
    return reject(429, "Rate limit exceeded", {
      headers: { "Retry-After": String(rate.retryAfterSec) },
    });
  }

  // Size bounds the work, not only the bytes (CHG-2026-157, Reviewer-2 B1):
  // what reaches the decoder is capped at maxDecodedBytes, and a gzip body may
  // not expand more than MAX_GZIP_EXPANSION_RATIO times. Both are 413 before
  // anything is decoded.
  const maxDecoded = Math.min(deps.maxDecodedBytes, deps.maxBodyBytes);
  let body: Buffer;
  try {
    body = await req.readBody(gzipped ? deps.maxBodyBytes : maxDecoded);
    if (gzipped) {
      body = await req.gunzip(
        body,
        gunzipOutputLimit(body.byteLength, maxDecoded),
      );
    }
  } catch (error) {
    if (error instanceof TelemetryBodyTooLargeError) {
      deps.record(projectId, lineageId, { rejected_size: 1 });
      return reject(413, "Request body too large", {
        closeConnection: !error.afterDecompression,
      });
    }
    deps.record(projectId, lineageId, { rejected_malformed: 1 });
    return reject(400, "Invalid OTLP trace export");
  }

  // D. Decode, then allowlist. A filter error drops the batch.
  let filtered: FilterResult;
  try {
    // Protobuf: the wire count is a fast first refusal, so an honest export
    // over the cap is refused without being decoded (B1). The bound itself is
    // counted inside the decoder, which throws TelemetryTooManySpansError at
    // the (cap + 1)th span it decodes (v8 review B1). JSON is bounded by the
    // decoded-size ceiling above, then counted after the parse as before.
    if (
      isProtobuf &&
      countProtobufSpans(body, MAX_SPANS_PER_BATCH + 1) > MAX_SPANS_PER_BATCH
    ) {
      deps.record(projectId, lineageId, { rejected_size: 1 });
      return reject(413, "Too many spans in one export");
    }
    const decoded = deps.decode(body, contentType);
    if (countSpans(decoded) > MAX_SPANS_PER_BATCH) {
      deps.record(projectId, lineageId, { rejected_size: 1 });
      return reject(413, "Too many spans in one export");
    }
    filtered = filterResourceSpans(decoded, {
      userIdMode: policy.userIdMode,
      userHashSalt: policy.userHashSalt,
      extraAllowlist: policy.extras,
    });
  } catch (error) {
    if (error instanceof TelemetryTooManySpansError) {
      deps.record(projectId, lineageId, { rejected_size: 1 });
      return reject(413, "Too many spans in one export");
    }
    if (error instanceof MalformedTelemetryError) {
      deps.record(projectId, lineageId, { rejected_malformed: 1 });
      return reject(400, "Invalid OTLP trace export");
    }
    deps.record(projectId, lineageId, { rejected_filter: 1 });
    return reject(500, "Unable to process telemetry");
  }

  const delta = dropDelta(filtered);
  if (policy.downgraded) delta.policy_downgraded = 1;

  // Nothing survived (an empty export, or every span unusable): accepted, and
  // nothing is handed over.
  if (filtered.resourceSpans.length === 0) {
    deps.record(projectId, lineageId, { ...delta, accepted: 1 });
    return { status: 200, body: OK_BODY };
  }

  // E. Stamp. The server's labels overwrite anything the app sent.
  const stamped = stampResourceSpans(filtered.resourceSpans, {
    application: key.displayName,
    keyLineage: key.lineageId,
    contentMode: policy.contentMode,
    policyVersion: policy.version,
    allowlistVersion: ALLOWLIST_VERSION,
    batchId: (deps.newBatchId ?? randomUUID)(),
    userIdMode: policy.userIdMode,
  });

  // F. Hand off, in process, as OTLP/JSON. The scope is built from the values
  // the key table gave us, never from the payload.
  const outBody = Buffer.from(
    JSON.stringify({ resourceSpans: stamped }),
    "utf8",
  );
  try {
    const result = await deps.handoff({
      body: outBody,
      contentType: "application/json",
      encodedBodyBytes: outBody.byteLength,
      config: {
        projectId: key.projectId,
        publicKey: HANDOFF_PUBLIC_KEY,
        orgId: key.orgId,
        sdkName: HANDOFF_SDK_NAME,
        sdkVersion: HANDOFF_SDK_VERSION,
        ingestionVersion: HANDOFF_INGESTION_VERSION,
      },
    });
    if (result.kind === "http") {
      // The engine refused our own filtered output: it is a defect, not the
      // caller's. Generic body: the engine's message is not passed on. Counted
      // as rejected_handoff, never as rejected_malformed (a caller fault).
      deps.record(projectId, lineageId, { ...delta, rejected_handoff: 1 });
      return reject(400, "Invalid OTLP trace export");
    }
  } catch {
    deps.record(projectId, lineageId, { ...delta, rejected_engine: 1 });
    return reject(503, "Temporarily unable to accept telemetry");
  }

  deps.record(projectId, lineageId, { ...delta, accepted: 1 });
  return { status: 200, body: OK_BODY };
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
