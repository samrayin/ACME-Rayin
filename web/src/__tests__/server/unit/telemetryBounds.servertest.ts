import { gunzip, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { $root } from "@/src/pages/api/public/otel/otlp-proto/generated/root";
import { MAX_SPANS_PER_BATCH } from "@/src/features/acme-enhancements/server/telemetry/telemetryAllowlist";
import {
  countProtobufSpans,
  decodeOtlpTraces,
  TelemetryTooManySpansError,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryDecode";
import {
  countSpans,
  MalformedTelemetryError,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_DECODED_BYTES,
  GZIP_EXPANSION_FLOOR_BYTES,
  gunzipOutputLimit,
  MAX_GZIP_EXPANSION_RATIO,
  telemetryMaxDecodedBytes,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryFlags";
import {
  handleTelemetryRequest,
  TelemetryBodyTooLargeError,
  type TelemetryDeps,
  type TelemetryHttpRequest,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryIngest";
import { createKeyedRateLimiter } from "@/src/features/acme-enhancements/server/telemetry/telemetryRateLimit";

// EYEON telemetry ingest, CHG-2026-157 (Reviewer-2 B1): the WORK a request can
// cause is bounded, not only its bytes. Gzip output is capped, and a protobuf
// export's spans are counted on the wire before it is decoded. Before this
// change, Reviewer-2's 5 KB gzip body below decoded 2.6 million spans on the
// console's event loop (about 0.6 to 1 s, about 600 MB of heap) before the
// span cap answered 413. The real gunzip and the real decoder are used here.

const MiB = 1024 * 1024;
const REQ =
  $root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

/** Reviewer-2's R2-P5 body: one resource, one scope, `n` empty spans (2 bytes each). */
function protobufEmptySpans(n: number): Buffer {
  const scopeSpans = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) scopeSpans[2 * i] = 0x12;
  const rs = Buffer.concat([
    Buffer.from([0x12, ...varint(scopeSpans.length)]),
    scopeSpans,
  ]);
  return Buffer.concat([Buffer.from([0x0a, ...varint(rs.length)]), rs]);
}

// The tags 0x0a (field 1) and 0x12 (field 2), length-delimited, written in 5
// bytes with a bit above 32. protobufjs's Reader.uint32() drops that bit and
// reads the usual tag; before R3-F1 the wire count read another field number
// and skipped the field (Reviewer-3).
const OVERLONG_FIELD_1 = [0x8a, 0x80, 0x80, 0x80, 0x10];
const OVERLONG_FIELD_2 = [0x92, 0x80, 0x80, 0x80, 0x10];

/** Like protobufEmptySpans, with the given bytes for each tag. */
function protobufEmptySpansTagged(
  n: number,
  tags: { resourceSpans?: number[]; scopeSpans?: number[]; span?: number[] },
): Buffer {
  const one = [...(tags.span ?? [0x12]), 0x00];
  const spans = Buffer.alloc(one.length * n);
  for (let i = 0; i < n; i++) spans.set(one, i * one.length);
  const rs = Buffer.concat([
    Buffer.from([...(tags.scopeSpans ?? [0x12]), ...varint(spans.length)]),
    spans,
  ]);
  return Buffer.concat([
    Buffer.from([...(tags.resourceSpans ?? [0x0a]), ...varint(rs.length)]),
    rs,
  ]);
}

function jsonEmptySpans(n: number): Buffer {
  return Buffer.from(
    `{"resourceSpans":[{"scopeSpans":[{"spans":[${"{},".repeat(n - 1)}{}]}]}]}`,
  );
}

/** A metadata-only export shaped like a real app's 512-span batch. */
function realisticExport(n: number) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "pilot-chat" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "pilot" },
            spans: Array.from({ length: n }, (_, i) => ({
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: (0x1000000000000000n + BigInt(i))
                .toString(16)
                .padStart(16, "0"),
              name: "chat gpt-4o-mini",
              kind: 3,
              startTimeUnixNano: "1790000000000000000",
              endTimeUnixNano: "1790000000500000000",
              attributes: [
                {
                  key: "gen_ai.operation.name",
                  value: { stringValue: "chat" },
                },
                { key: "gen_ai.system", value: { stringValue: "openai" } },
                {
                  key: "gen_ai.request.model",
                  value: { stringValue: "gpt-4o-mini" },
                },
                {
                  key: "gen_ai.usage.input_tokens",
                  value: { intValue: "812" },
                },
                {
                  key: "gen_ai.usage.output_tokens",
                  value: { intValue: "164" },
                },
                {
                  key: "session.id",
                  value: { stringValue: `session-${i % 17}` },
                },
              ],
              status: { code: 1 },
            })),
          },
        ],
      },
    ],
  };
}

function runtimeLikeDeps(decodeCalls: { n: number }): TelemetryDeps {
  const limiter = createKeyedRateLimiter(1_000_000, 60_000);
  return {
    now: () => 0,
    authenticate: async () => ({
      keyId: "key-1",
      orgId: "org-bounds",
      projectId: "proj-bounds",
      lineageId: "lineage-1",
      displayName: "pilot-chat",
    }),
    loadPolicy: async () => ({
      projectId: "proj-bounds",
      enabled: true,
      contentMode: "metadata",
      userIdMode: "hash",
      attributeAllowlistExtra: [],
      retentionDays: null,
      version: 1,
      userHashSalt: "synthetic-salt-0123456789abcdef01234567",
    }),
    contentModesGateOpen: false,
    // As telemetryRuntime builds them when the environment sets nothing.
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    maxDecodedBytes: telemetryMaxDecodedBytes(DEFAULT_MAX_BODY_BYTES),
    rateLimit: (k, n) => limiter.check(k, n),
    decode: (body, contentType) => {
      decodeCalls.n++;
      return decodeOtlpTraces(body, contentType);
    },
    handoff: async () => ({ kind: "ok" }),
    record: () => {},
    newBatchId: () => "batch-bounds",
  };
}

function request(
  raw: Buffer,
  contentType: string,
  gzipped: boolean,
  readLimits: number[] = [],
): TelemetryHttpRequest {
  return {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-bounds-key",
      "content-type": contentType,
      ...(gzipped ? { "content-encoding": "gzip" } : {}),
    },
    readBody: async (max) => {
      readLimits.push(max);
      if (raw.byteLength > max) throw new TelemetryBodyTooLargeError(false);
      return raw;
    },
    // The same zlib call as the engine's gunzipOtelRequestBody.
    gunzip: (body, max) =>
      new Promise((resolve, reject) => {
        gunzip(body, { maxOutputLength: max }, (error, result) => {
          if (!error) return resolve(result);
          if (
            (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE"
          ) {
            return reject(new TelemetryBodyTooLargeError(true));
          }
          reject(error);
        });
      }),
  };
}

async function timed(
  req: TelemetryHttpRequest,
  deps: TelemetryDeps,
  decodeCalls: { n: number },
) {
  // Warm up module and zlib state on a tiny valid body first; its decode call
  // is not the one under test.
  await handleTelemetryRequest(
    request(Buffer.from('{"resourceSpans":[]}'), "application/json", false),
    deps,
  );
  decodeCalls.n = 0;
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const res = await handleTelemetryRequest(req, deps);
  const ms = performance.now() - t0;
  const heapMiB = (process.memoryUsage().heapUsed - heap0) / MiB;
  return { res, ms, heapMiB };
}

// Generous for slow CI runners; before the fix these took ~640 ms to ~950 ms
// and ~570 MB to ~610 MB on the protobuf body.
const FAST_MS = 150;
const BOUNDED_HEAP_MIB = 64;

describe("B1 (Reviewer-2): bounded before decode, through the real gunzip and decoder", () => {
  it("Reviewer-2's 5 KB protobuf body (2,621,432 empty spans) gets a fast 413, bounded memory, no decode", async () => {
    const plain = protobufEmptySpans(2_621_432);
    expect(plain.byteLength).toBe(5_242_874);
    const body = gzipSync(plain);
    expect(body.byteLength).toBeLessThan(6 * 1024);
    const calls = { n: 0 };
    const { res, ms, heapMiB } = await timed(
      request(body, "application/x-protobuf", true),
      runtimeLikeDeps(calls),
      calls,
    );
    expect(res.status).toBe(413);
    expect(calls.n).toBe(0);
    expect(ms).toBeLessThan(FAST_MS);
    expect(heapMiB).toBeLessThan(BOUNDED_HEAP_MIB);
  });

  it("the JSON equivalent (1,747,610 empty spans, ~5 KB gzip) gets a fast 413, no decode", async () => {
    const body = gzipSync(jsonEmptySpans(1_747_610));
    expect(body.byteLength).toBeLessThan(6 * 1024);
    const calls = { n: 0 };
    const { res, ms, heapMiB } = await timed(
      request(body, "application/json", true),
      runtimeLikeDeps(calls),
      calls,
    );
    expect(res.status).toBe(413);
    expect(calls.n).toBe(0);
    expect(ms).toBeLessThan(FAST_MS);
    expect(heapMiB).toBeLessThan(BOUNDED_HEAP_MIB);
  });

  it("an uncompressed protobuf under the decoded ceiling with 5,001+ spans is refused by the wire count, no decode", async () => {
    const body = protobufEmptySpans(524_280);
    expect(body.byteLength).toBeLessThan(DEFAULT_MAX_DECODED_BYTES);
    const calls = { n: 0 };
    const { res, ms, heapMiB } = await timed(
      request(body, "application/x-protobuf", false),
      runtimeLikeDeps(calls),
      calls,
    );
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ message: "Too many spans in one export" });
    expect(calls.n).toBe(0);
    expect(ms).toBeLessThan(FAST_MS);
    expect(heapMiB).toBeLessThan(BOUNDED_HEAP_MIB);
  });

  it("an uncompressed body over the decoded ceiling is read only up to it, then 413", async () => {
    const limits: number[] = [];
    const calls = { n: 0 };
    const res = await handleTelemetryRequest(
      request(jsonEmptySpans(600_000), "application/json", false, limits),
      runtimeLikeDeps(calls),
    );
    expect(res.status).toBe(413);
    expect(res.closeConnection).toBe(true);
    expect(limits).toEqual([DEFAULT_MAX_DECODED_BYTES]);
    expect(calls.n).toBe(0);
  });

  it("a gzip body that expands more than MAX_GZIP_EXPANSION_RATIO times is 413 before decode", async () => {
    const plain = Buffer.alloc(900 * 1024, 0x20);
    const body = gzipSync(plain);
    expect(plain.byteLength / body.byteLength).toBeGreaterThan(
      MAX_GZIP_EXPANSION_RATIO,
    );
    expect(plain.byteLength).toBeLessThan(DEFAULT_MAX_DECODED_BYTES);
    const calls = { n: 0 };
    const res = await handleTelemetryRequest(
      request(body, "application/json", true),
      runtimeLikeDeps(calls),
    );
    expect(res.status).toBe(413);
    expect(res.closeConnection).toBe(false);
    expect(calls.n).toBe(0);
  });

  it.each([
    ["protobuf, gzip", "application/x-protobuf", true],
    ["protobuf, plain", "application/x-protobuf", false],
    ["JSON, gzip", "application/json", true],
    ["JSON, plain", "application/json", false],
  ] as const)(
    "a realistic 512-span metadata batch still passes (%s)",
    async (_label, contentType, gzipped) => {
      const object = realisticExport(512);
      const plain =
        contentType === "application/json"
          ? Buffer.from(JSON.stringify(object))
          : Buffer.from(REQ.encode(REQ.fromObject(object)).finish());
      expect(plain.byteLength).toBeLessThan(DEFAULT_MAX_DECODED_BYTES);
      const body = gzipped ? gzipSync(plain) : plain;
      if (gzipped) {
        expect(plain.byteLength / body.byteLength).toBeLessThan(
          MAX_GZIP_EXPANSION_RATIO,
        );
      }
      const calls = { n: 0 };
      const res = await handleTelemetryRequest(
        request(body, contentType, gzipped),
        runtimeLikeDeps(calls),
      );
      expect(res.status).toBe(200);
      expect(calls.n).toBe(1);
    },
  );

  it("exactly 5,000 spans pass the wire count and are decoded", async () => {
    const calls = { n: 0 };
    const res = await handleTelemetryRequest(
      request(protobufEmptySpans(5_000), "application/x-protobuf", false),
      runtimeLikeDeps(calls),
    );
    expect(res.status).not.toBe(413);
    expect(calls.n).toBe(1);
  });
});

describe("R3-F1 (Reviewer-3): a tag the decoder reads differently cannot hide spans from the wire count", () => {
  // Before the fix, Reviewer-3's body was decoded in full (499,000 spans,
  // ~50 to 150 ms, ~120 MB of heap) before the span cap answered 413.
  it.each([
    [
      "Reviewer-3's body: an overlong resource_spans tag, 499,000 spans",
      () =>
        protobufEmptySpansTagged(499_000, { resourceSpans: OVERLONG_FIELD_1 }),
      998_012,
    ],
    [
      "an overlong scope_spans tag, 499,000 spans",
      () => protobufEmptySpansTagged(499_000, { scopeSpans: OVERLONG_FIELD_2 }),
      998_012,
    ],
    [
      "an overlong tag on every span, 166,000 spans",
      () => protobufEmptySpansTagged(166_000, { span: OVERLONG_FIELD_2 }),
      996_008,
    ],
  ])(
    "%s gets a fast 413 or 400, bounded memory, no decode",
    async (_label, build, size) => {
      const body = build();
      expect(body.byteLength).toBe(size);
      expect(body.byteLength).toBeLessThan(DEFAULT_MAX_DECODED_BYTES);
      const calls = { n: 0 };
      const { res, ms, heapMiB } = await timed(
        request(body, "application/x-protobuf", false),
        runtimeLikeDeps(calls),
        calls,
      );
      expect([400, 413]).toContain(res.status);
      expect(calls.n).toBe(0);
      expect(ms).toBeLessThan(FAST_MS);
      expect(heapMiB).toBeLessThan(BOUNDED_HEAP_MIB);
    },
  );
});

// The v8 review's B1: protobufjs does not hold a nested message to its
// parent's length. A resource or a span that overruns its own end makes the
// decoder carry on inside bytes the wire count skipped as an unknown field, so
// it decodes spans the wire count never saw. The cap is therefore counted
// inside the decoder, on every Span it decodes; the wire count is only a fast
// first refusal.
const SPAN = $root.opentelemetry.proto.trace.v1.Span;
const PB = "application/x-protobuf";

/** Runs `fn` and counts the Spans the decoder decodes meanwhile. */
async function withSpanDecodeCount<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T | undefined; spansDecoded: number }> {
  const original = SPAN.decode;
  let spansDecoded = 0;
  SPAN.decode = function (this: unknown, ...args: unknown[]) {
    spansDecoded++;
    return original.apply(this, args);
  };
  try {
    let result: T | undefined;
    try {
      result = await fn();
    } catch {
      // a throw is fine here: the count is what is under test
    }
    return { result, spansDecoded };
  } finally {
    SPAN.decode = original;
  }
}

/** The Critic's span overrun: the span's attribute key swallows the header of an unknown field 4 that holds `n` empty spans. */
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

/** The Critic's resource overrun: the resource's attribute key swallows the header of an unknown field 4 that holds a scope_spans with `n` empty spans. */
function resourceOverrun(n: number): Buffer {
  const spans = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) spans[2 * i] = 0x12;
  const payload = Buffer.concat([
    Buffer.from([0x12, ...varint(spans.length)]),
    spans,
  ]);
  const header = Buffer.from([0x22, ...varint(payload.length)]);
  const resource = Buffer.from([
    0x0a,
    0x04,
    0x0a,
    2 + header.length,
    0x0a,
    header.length,
  ]);
  const rs = Buffer.concat([resource, header, payload]);
  return Buffer.concat([Buffer.from([0x0a, ...varint(rs.length)]), rs]);
}

describe("B1 (v8 review): the span cap is counted inside the decoder, so the wire count cannot let a body through", () => {
  it.each([
    ["span overrun", 1, 4, "0a10120e12044a040a022206120012001200", spanOverrun],
    [
      "resource overrun",
      0,
      3,
      "0a100a040a040a0222081206120012001200",
      resourceOverrun,
    ],
  ] as const)(
    "the Critic's 18-byte %s: the wire count sees %i span(s), the decoder decodes %i, and the cap counts what is decoded",
    async (_label, wireCount, decoded, hex, build) => {
      const body = Buffer.from(hex, "hex");
      expect(body.byteLength).toBe(18);
      expect(build(3).equals(body)).toBe(true);
      expect(countProtobufSpans(body, 100)).toBe(wireCount);
      const { spansDecoded } = await withSpanDecodeCount(() =>
        decodeOtlpTraces(body, PB),
      );
      expect(spansDecoded).toBe(decoded);
      expect(() => decodeOtlpTraces(body, PB, decoded)).not.toThrow();
      expect(() => decodeOtlpTraces(body, PB, decoded - 1)).toThrow(
        TelemetryTooManySpansError,
      );
    },
  );

  it.each([
    ["span overrun", () => spanOverrun(499_000)],
    ["resource overrun", () => resourceOverrun(499_000)],
  ] as const)(
    "the %s at 998,018 bytes (499,000 hidden spans) gets 413 after at most MAX_SPANS_PER_BATCH decoded spans, bounded memory",
    async (_label, build) => {
      const body = build();
      expect(body.byteLength).toBe(998_018);
      expect(body.byteLength).toBeLessThan(DEFAULT_MAX_DECODED_BYTES);
      // The wire count lets it through: it is not the bound.
      expect(
        countProtobufSpans(body, MAX_SPANS_PER_BATCH + 1),
      ).toBeLessThanOrEqual(1);
      const calls = { n: 0 };
      const { result, spansDecoded } = await withSpanDecodeCount(() =>
        timed(request(body, PB, false), runtimeLikeDeps(calls), calls),
      );
      expect(result?.res.status).toBe(413);
      expect(result?.res.body).toEqual({
        message: "Too many spans in one export",
      });
      expect(spansDecoded).toBeLessThanOrEqual(MAX_SPANS_PER_BATCH);
      expect(result?.ms).toBeLessThan(FAST_MS);
      expect(result?.heapMiB).toBeLessThan(BOUNDED_HEAP_MIB);
    },
  );

  it("exactly MAX_SPANS_PER_BATCH spans behind an overrun are still decoded (the cap is not off by one)", async () => {
    const calls = { n: 0 };
    const res = await handleTelemetryRequest(
      request(spanOverrun(MAX_SPANS_PER_BATCH - 1), PB, false),
      runtimeLikeDeps(calls),
    );
    expect(res.status).not.toBe(413);
    expect(calls.n).toBe(1);
  });
});

describe("countProtobufSpans: the fast wire count agrees with the decoder on these bodies, and refuses bad wire data (it is not the bound: see the v8 review's B1 above)", () => {
  const encode = (object: unknown) =>
    Buffer.from(REQ.encode(REQ.fromObject(object as never)).finish());
  const spanObj = (i: number) => ({
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: (0x2000000000000000n + BigInt(i)).toString(16).padStart(16, "0"),
    name: `span ${i}`,
    attributes: [{ key: "k", value: { stringValue: "v" } }],
    events: [{ name: "e" }],
  });

  it("counts across several resources and scopes, skipping every other field", () => {
    const object = {
      resourceSpans: [1, 3, 0].map((nScopes, r) => ({
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: `svc-${r}` } },
          ],
        },
        schemaUrl: "https://example.invalid/schema",
        scopeSpans: Array.from({ length: nScopes }, (_, sc) => ({
          scope: { name: `scope-${sc}`, version: "1.0.0" },
          schemaUrl: "https://example.invalid/schema",
          spans: Array.from({ length: (r + 1) * (sc + 2) }, (_, i) =>
            spanObj(i),
          ),
        })),
      })),
    };
    const body = encode(object);
    const expected = countSpans(
      decodeOtlpTraces(body, "application/x-protobuf"),
    );
    expect(expected).toBeGreaterThan(0);
    expect(countProtobufSpans(body, Number.MAX_SAFE_INTEGER)).toBe(expected);
  });

  it("stops counting at stopAt", () => {
    expect(countProtobufSpans(protobufEmptySpans(10_000), 5_001)).toBe(5_001);
  });

  it("an empty body has no spans", () => {
    expect(countProtobufSpans(Buffer.alloc(0), 10)).toBe(0);
  });

  it("skips unknown top-level fields of every wire type", () => {
    const unknown = Buffer.from([
      0x10,
      0x96,
      0x01, // field 2, varint 150
      0x19,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8, // field 3, fixed64
      0x22,
      0x02,
      0x61,
      0x62, // field 4, length-delimited "ab"
      0x2d,
      1,
      2,
      3,
      4, // field 5, fixed32
    ]);
    const body = Buffer.concat([unknown, protobufEmptySpans(3)]);
    expect(countProtobufSpans(body, 100)).toBe(3);
  });

  it("reads canonical multi-byte tags, up to the highest field number, as the decoder does", () => {
    const body = Buffer.concat([
      Buffer.from([0xc2, 0x3e, 0x00]), // field 1000, length-delimited, empty
      Buffer.from([0xfa, 0xff, 0xff, 0xff, 0x0f, 0x00]), // field 2^29 - 1, same
      protobufEmptySpans(3),
    ]);
    expect(countSpans(decodeOtlpTraces(body, "application/x-protobuf"))).toBe(
      3,
    );
    expect(countProtobufSpans(body, 100)).toBe(3);
  });

  it.each([
    [
      "Reviewer-3's proof: an overlong resource_spans tag over 3 spans",
      Buffer.from([
        ...OVERLONG_FIELD_1,
        0x08,
        0x12,
        0x06,
        0x12,
        0x00,
        0x12,
        0x00,
        0x12,
        0x00,
      ]),
    ],
    ["an overlong 2-byte tag", Buffer.from([0x8a, 0x00, 0x00])],
    [
      "a tag with a 6th byte",
      Buffer.from([0x8a, 0x80, 0x80, 0x80, 0x80, 0x01]),
    ],
    ["an overlong length", Buffer.from([0x0a, 0x80, 0x00])],
    [
      "a length with a bit above 32",
      Buffer.from([0x0a, 0x81, 0x80, 0x80, 0x80, 0x10, 0x00]),
    ],
    ["resource as a varint", Buffer.from([0x0a, 0x02, 0x08, 0x01])],
    [
      "a scope's schema_url as fixed32",
      Buffer.from([0x0a, 0x07, 0x12, 0x05, 0x1d, 1, 2, 3, 4]),
    ],
  ])("%s throws MalformedTelemetryError", (_label, body) => {
    expect(() => countProtobufSpans(body, 100)).toThrow(
      MalformedTelemetryError,
    );
  });

  it.each([
    ["a truncated length", Buffer.from([0x0a, 0x05, 0x12])],
    ["a truncated varint", Buffer.from([0x0a, 0x80])],
    ["a group wire type", Buffer.from([0x0b])],
    ["field number 0", Buffer.from([0x02, 0x00])],
    ["resource_spans that is not length-delimited", Buffer.from([0x08, 0x01])],
    ["a skipped fixed64 running past the end", Buffer.from([0x19, 1, 2])],
  ])("%s throws MalformedTelemetryError", (_label, body) => {
    expect(() => countProtobufSpans(body, 100)).toThrow(
      MalformedTelemetryError,
    );
  });
});

describe("the decoded ceiling and the expansion limit", () => {
  it("the decoded ceiling is 1 MiB, and only ever lower", () => {
    expect(DEFAULT_MAX_DECODED_BYTES).toBe(MiB);
    expect(telemetryMaxDecodedBytes(5 * MiB)).toBe(MiB);
    expect(telemetryMaxDecodedBytes(256 * 1024)).toBe(256 * 1024);
  });

  it("a gzip body may expand MAX_GZIP_EXPANSION_RATIO times, with a floor, never past the ceiling", () => {
    expect(gunzipOutputLimit(1_000, MiB)).toBe(
      Math.max(GZIP_EXPANSION_FLOOR_BYTES, 1_000 * MAX_GZIP_EXPANSION_RATIO),
    );
    expect(gunzipOutputLimit(10, MiB)).toBe(GZIP_EXPANSION_FLOOR_BYTES);
    expect(gunzipOutputLimit(100_000, MiB)).toBe(MiB);
    expect(gunzipOutputLimit(100_000, 1_000)).toBe(1_000);
  });
});
