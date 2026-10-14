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
