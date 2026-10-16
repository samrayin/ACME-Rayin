import { describe, expect, it, vi } from "vitest";

// EYEON telemetry ingest, CHG-2026-157 (v9.1 re-check V2): the span cap must
// hold even when the generated protobuf code is evaluated a second time in the
// same process. The generated root lives on protobufjs's shared default root,
// and a second evaluation replaces its `opentelemetry` namespace; a cap that
// wrapped the Span type captured at the first load would then wrap a type the
// decoder no longer calls. In its own file, so the second evaluation cannot
// affect any other test.

const PB = "application/x-protobuf";
const MAX_SPANS = 5_000;

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

/** The v8 Critic's span overrun: a span's attribute key swallows the header of an unknown field 4 that holds `n` empty spans. */
function spanOverrun(n: number): Buffer {
  const payload = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) payload[2 * i] = 0x12;
  const header = Buffer.from([0x22, ...varint(payload.length)]);
  const span = Buffer.from([
    0x12,
    0x04,
    0x4a,
    2 + header.length,
    0x0a,
    header.length,
  ]);
  const scopeSpans = Buffer.concat([span, header, payload]);
  const rs = Buffer.concat([
    Buffer.from([0x12, ...varint(scopeSpans.length)]),
    scopeSpans,
  ]);
  return Buffer.concat([Buffer.from([0x0a, ...varint(rs.length)]), rs]);
}

describe("V2 (v9.1 re-check): the span cap holds when the generated protobuf code is loaded twice", () => {
  it("after a second evaluation of the generated root, the 998,018-byte span overrun is still refused at the cap", async () => {
    const { decodeOtlpTraces, TelemetryTooManySpansError } =
      await import("@/src/features/acme-enhancements/server/telemetry/telemetryDecode");
    // A second, independent evaluation of the generated code, sharing
    // protobufjs's default root with the first.
    vi.resetModules();
    const second =
      await import("@/src/pages/api/public/otel/otlp-proto/generated/root");
    const span = second.$root.opentelemetry.proto.trace.v1.Span;
    const decodeSpan = span.decode;
    let spansDecoded = 0;
    span.decode = function (this: unknown, ...args: unknown[]) {
      spansDecoded++;
      return decodeSpan.apply(this, args);
    };
    try {
      const body = spanOverrun(499_000);
      expect(body.byteLength).toBe(998_018);
      let error: unknown;
      try {
        decodeOtlpTraces(body, PB);
      } catch (e) {
        error = e;
      }
      expect(spansDecoded).toBeLessThanOrEqual(MAX_SPANS);
      expect(error).toBeInstanceOf(TelemetryTooManySpansError);
    } finally {
      span.decode = decodeSpan;
    }
  });
});
