import { gunzip, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { $root } from "@/src/pages/api/public/otel/otlp-proto/generated/root";
import {
  countProtobufSpans,
  decodeOtlpTraces,
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
// cause is bounded before anything is decoded, not only its bytes. Before this
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

describe("countProtobufSpans: the wire count matches the decoder, and refuses bad wire data", () => {
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
