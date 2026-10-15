/**
 * ACME addition (EYEON telemetry ingest, LLD section 5, step D): the decoder.
 *
 * A PURE FUNCTION, moved out of telemetryRuntime.ts (CHG-2026-156) so that the
 * protobuf path, which most OTLP/HTTP exporters use by default, is tested as it
 * runs and not through a stand-in. Protobuf or JSON in, the `resourceSpans`
 * array out, shaped as the filter expects. No I/O, no logger.
 */
import { $root } from "@/src/pages/api/public/otel/otlp-proto/generated/root";
import { MalformedTelemetryError } from "./telemetryFilter";

const OTLP_REQUEST =
  $root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

/**
 * Counts the spans in a protobuf OTLP export WITHOUT decoding it (CHG-2026-157,
 * Reviewer-2 B1). It walks the wire format: ExportTraceServiceRequest field 1
 * (resource_spans), then ResourceSpans field 2 (scope_spans), then ScopeSpans
 * field 2 (spans). Every other field is skipped, and the walk stops as soon as
 * the count reaches `stopAt`. No object is built, so a body of millions of
 * empty spans costs microseconds instead of a full decode. A body that is not
 * well-formed protobuf throws MalformedTelemetryError.
 */
export function countProtobufSpans(buf: Uint8Array, stopAt: number): number {
  let count = 0;
  let pos = 0;

  const varint = (end: number): number => {
    let result = 0;
    for (let i = 0; i < 10; i++) {
      if (pos >= end) throw new MalformedTelemetryError();
      const b = buf[pos++];
      // Tags and lengths in a body this route accepts are far below 2^35;
      // bits above that only occur in skipped varint values.
      if (i < 5) result += (b % 128) * 2 ** (7 * i);
      if (b < 128) return result; // no continuation bit
    }
    throw new MalformedTelemetryError();
  };

  /** Skips one field value of the given wire type, inside [pos, end). */
  const skip = (wireType: number, end: number): void => {
    if (wireType === 0) varint(end);
    else if (wireType === 1) pos += 8;
    else if (wireType === 5) pos += 4;
    else if (wireType === 2) {
      const len = varint(end); // read first: it advances pos
      pos += len;
    } else throw new MalformedTelemetryError(); // groups (3, 4) and invalid types
    if (pos > end) throw new MalformedTelemetryError();
  };

  /** Walks [pos, end): level 0 is the request, 1 ResourceSpans, 2 ScopeSpans. */
  const walk = (end: number, level: number): void => {
    const wanted = level === 0 ? 1 : 2;
    while (pos < end) {
      if (count >= stopAt) return;
      const tag = varint(end);
      const field = Math.floor(tag / 8);
      const wireType = tag % 8;
      if (field === 0) throw new MalformedTelemetryError();
      if (field !== wanted) {
        skip(wireType, end);
        continue;
      }
      if (wireType !== 2) throw new MalformedTelemetryError();
      const len = varint(end); // read first: it advances pos
      const childEnd = pos + len;
      if (childEnd > end) throw new MalformedTelemetryError();
      if (level === 2) count++;
      else walk(childEnd, level + 1);
      pos = childEnd;
    }
  };

  walk(buf.length, 0);
  return count;
}

/** Protobuf or JSON body to the `resourceSpans` array. Throws MalformedTelemetryError. */
export function decodeOtlpTraces(body: Buffer, contentType: string): unknown {
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
