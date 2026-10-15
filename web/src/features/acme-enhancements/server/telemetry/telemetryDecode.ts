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
 * well-formed protobuf throws MalformedTelemetryError, and so does any tag,
 * length or wire type the decoder could read differently (Reviewer-3 R3-F1).
 */
export function countProtobufSpans(buf: Uint8Array, stopAt: number): number {
  let count = 0;
  let pos = 0;

  /**
   * Reads a tag or a length as protobufjs's Reader.uint32() does, but only in
   * canonical form (CHG-2026-157, Reviewer-3 R3-F1): at most 5 bytes, a value
   * below 2^32, and no overlong encoding (a trailing zero byte). Anything else
   * throws, so the walker and the decoder never read the same bytes as
   * different numbers.
   */
  const uint32 = (end: number): number => {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      if (pos >= end) throw new MalformedTelemetryError();
      const b = buf[pos++];
      if (i === 4 && b > 15) throw new MalformedTelemetryError(); // over 32 bits
      result += (b % 128) * 2 ** (7 * i);
      if (b < 128) {
        if (i > 0 && b === 0) throw new MalformedTelemetryError(); // overlong
        return result;
      }
    }
    throw new MalformedTelemetryError();
  };

  /** Skips a varint value (wire type 0). Its value is never used. */
  const skipVarint = (end: number): void => {
    for (let i = 0; i < 10; i++) {
      if (pos >= end) throw new MalformedTelemetryError();
      if (buf[pos++] < 128) return; // no continuation bit
    }
    throw new MalformedTelemetryError();
  };

  /** Skips one field value of the given wire type, inside [pos, end). */
  const skip = (wireType: number, end: number): void => {
    if (wireType === 0) skipVarint(end);
    else if (wireType === 1) pos += 8;
    else if (wireType === 5) pos += 4;
    else if (wireType === 2) {
      const len = uint32(end); // read first: it advances pos
      pos += len;
    } else throw new MalformedTelemetryError(); // groups (3, 4) and invalid types
    if (pos > end) throw new MalformedTelemetryError();
  };

  /** Walks [pos, end): level 0 is the request, 1 ResourceSpans, 2 ScopeSpans. */
  const walk = (end: number, level: number): void => {
    const wanted = level === 0 ? 1 : 2;
    // Fields the generated decoder knows at this level, 1 to `known`. All are
    // length-delimited, and it reads them as such WHATEVER their wire type,
    // so any other wire type on them cannot be counted with certainty.
    const known = level === 0 ? 1 : 3;
    while (pos < end) {
      if (count >= stopAt) return;
      const tag = uint32(end);
      const field = Math.floor(tag / 8);
      const wireType = tag % 8;
      if (field === 0) throw new MalformedTelemetryError();
      if (field <= known && wireType !== 2) throw new MalformedTelemetryError();
      if (field !== wanted) {
        skip(wireType, end);
        continue;
      }
      const len = uint32(end); // read first: it advances pos
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
