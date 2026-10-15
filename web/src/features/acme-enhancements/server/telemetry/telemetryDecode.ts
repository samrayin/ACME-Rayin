/**
 * ACME addition (EYEON telemetry ingest, LLD section 5, step D): the decoder.
 *
 * A PURE FUNCTION, moved out of telemetryRuntime.ts (CHG-2026-156) so that the
 * protobuf path, which most OTLP/HTTP exporters use by default, is tested as it
 * runs and not through a stand-in. Protobuf or JSON in, the `resourceSpans`
 * array out, shaped as the filter expects. No I/O, no logger.
 */
import { $root } from "@/src/pages/api/public/otel/otlp-proto/generated/root";
import { MAX_SPANS_PER_BATCH } from "./telemetryAllowlist";
import { MalformedTelemetryError } from "./telemetryFilter";

const OTLP_REQUEST =
  $root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
const OTLP_SPAN = $root.opentelemetry.proto.trace.v1.Span;

/** The decoder reached the span cap: the export is refused with 413. */
export class TelemetryTooManySpansError extends Error {
  constructor() {
    super("Too many spans in one export");
    this.name = "TelemetryTooManySpansError";
  }
}

/**
 * A FAST FIRST REFUSAL, not the bound (CHG-2026-157, Reviewer-2 B1; v8 review
 * B1). Counts the spans in a protobuf OTLP export without decoding it, by
 * walking the wire format: ExportTraceServiceRequest field 1 (resource_spans),
 * then ResourceSpans field 2 (scope_spans), then ScopeSpans field 2 (spans).
 * Every other field is skipped, and the walk stops as soon as the count
 * reaches `stopAt`. No object is built, so a body of millions of empty spans
 * is refused in microseconds. A body that is not well-formed protobuf throws
 * MalformedTelemetryError, and so does any tag, length or wire type the
 * decoder could read differently (Reviewer-3 R3-F1).
 *
 * It can still count FEWER spans than the decoder decodes: protobufjs does not
 * hold a nested message to its parent's length, so a resource or a span that
 * overruns its own end makes the decoder carry on inside bytes this walk
 * skipped as an unknown field (v8 review B1). The bound is therefore the cap
 * that decodeOtlpTraces counts inside the decoder, on every Span it decodes.
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

/**
 * Decodes a protobuf export with the span cap counted INSIDE the decoder (v8
 * review B1): every Span the decoder decodes is counted, wherever in the body
 * it finds one, and the (maxSpans + 1)th throws TelemetryTooManySpansError
 * before it is built. So the decoder never builds more than `maxSpans` spans,
 * and no count can disagree with it.
 *
 * The generated ScopeSpans decoder looks Span.decode up at call time, so the
 * counting wrapper is installed for this one call and removed in `finally`.
 * The decode is synchronous: no other code runs while the wrapper is in place.
 */
function decodeWithSpanCap(body: Buffer, maxSpans: number) {
  const decodeSpan = OTLP_SPAN.decode;
  let spans = 0;
  OTLP_SPAN.decode = function (this: unknown, ...args: unknown[]) {
    if (++spans > maxSpans) throw new TelemetryTooManySpansError();
    return decodeSpan.apply(this, args);
  };
  try {
    return OTLP_REQUEST.decode(body);
  } finally {
    OTLP_SPAN.decode = decodeSpan;
  }
}

/**
 * Protobuf or JSON body to the `resourceSpans` array. Throws
 * MalformedTelemetryError, or TelemetryTooManySpansError once a protobuf
 * export's decoder reaches more than `maxSpans` spans. A JSON body is bounded
 * by the decoded-size ceiling and counted by the caller after the parse.
 */
export function decodeOtlpTraces(
  body: Buffer,
  contentType: string,
  maxSpans: number = MAX_SPANS_PER_BATCH,
): unknown {
  if (contentType.includes("application/x-protobuf")) {
    try {
      const parsed = decodeWithSpanCap(body, maxSpans);
      // int64 as decimal strings, as the OTLP JSON encoding does.
      return (
        OTLP_REQUEST.toObject(parsed, { longs: String }).resourceSpans ?? []
      );
    } catch (error) {
      if (error instanceof TelemetryTooManySpansError) throw error;
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
