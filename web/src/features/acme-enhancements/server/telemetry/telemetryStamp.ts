/**
 * ACME addition (EYEON telemetry ingest, LLD section 5.2, step E): the server's
 * own labels.
 *
 * The filter has already removed every `eyeon.*` and `langfuse.*` key the app
 * sent. This step still removes them again before writing, so that "always
 * overwritten" holds on its own and does not depend on the step before it.
 *
 * `eyeon.trust = asserted` is deliberate and permanent for this path: the app
 * said it. A trace is diagnostic. The guardrail event and the request-log row
 * are not app-writable and remain the evidence (ADR-0020 section 3.3).
 *
 * The instrumentation scope is the server's too: every span is written under
 * EYEON_SCOPE_NAME, whatever the app sent (CHG-2026-156). An app-chosen scope
 * name could make the engine drop every label written here.
 */
import { EYEON_SCOPE_NAME } from "./telemetryAllowlist";
import type {
  FilteredResourceSpans,
  FilteredSpan,
  OtlpAttribute,
  UserIdMode,
} from "./telemetryFilter";

export type StampContext = {
  /** The key's display name, from the key table (not from the payload). */
  application: string;
  keyLineage: string;
  /** The EFFECTIVE mode, never the requested one. */
  contentMode: string;
  policyVersion: number;
  allowlistVersion: string;
  batchId: string;
  userIdMode: UserIdMode;
};

/** Every attribute this step owns. Anything the app sent under these is gone. */
export const STAMPED_KEYS: readonly string[] = [
  "eyeon.source",
  "eyeon.trust",
  "eyeon.application",
  "eyeon.key_lineage",
  "eyeon.content_mode",
  "eyeon.policy_version",
  "eyeon.allowlist_version",
  "eyeon.ingest_batch",
  "eyeon.user_hash",
];

const MAX_APPLICATION_LENGTH = 128;

function str(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function stampSpan(
  span: FilteredSpan,
  ctx: StampContext,
): Record<string, unknown> {
  const owned = new Set(STAMPED_KEYS);
  const attributes: OtlpAttribute[] = span.attributes.filter(
    (a) => !owned.has(a.key),
  );
  attributes.push(
    str("eyeon.source", "app"),
    str("eyeon.trust", "asserted"),
    str("eyeon.application", ctx.application.slice(0, MAX_APPLICATION_LENGTH)),
    str("eyeon.key_lineage", ctx.keyLineage),
    str("eyeon.content_mode", ctx.contentMode),
    {
      key: "eyeon.policy_version",
      value: { intValue: String(ctx.policyVersion) },
    },
    str("eyeon.allowlist_version", ctx.allowlistVersion),
    str("eyeon.ingest_batch", ctx.batchId),
  );
  // Only in hash mode and only when a value was sent.
  if (ctx.userIdMode === "hash" && span.userHash !== undefined) {
    attributes.push(str("eyeon.user_hash", span.userHash));
  }

  const out: Record<string, unknown> = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    attributes,
    events: span.events,
    status: span.status,
  };
  if (span.parentSpanId !== undefined) out.parentSpanId = span.parentSpanId;
  if (span.endTimeUnixNano !== undefined) {
    out.endTimeUnixNano = span.endTimeUnixNano;
  }
  return out;
}

/**
 * Returns the OTLP/JSON `resourceSpans` array, stamped, with the internal
 * `userHash` field consumed and gone, and every scope set to EYEON's own.
 */
export function stampResourceSpans(
  filtered: readonly FilteredResourceSpans[],
  ctx: StampContext,
): unknown[] {
  return filtered.map((rs) => ({
    resource: { attributes: rs.resource.attributes },
    scopeSpans: rs.scopeSpans.map((ss) => ({
      scope: { name: EYEON_SCOPE_NAME },
      spans: ss.spans.map((s) => stampSpan(s, ctx)),
    })),
  }));
}
