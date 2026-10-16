import { describe, expect, it } from "vitest";
import { $root } from "@/src/pages/api/public/otel/otlp-proto/generated/root";
import { decodeOtlpTraces } from "@/src/features/acme-enhancements/server/telemetry/telemetryDecode";
import { MalformedTelemetryError } from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";
import {
  handleTelemetryRequest,
  type TelemetryDeps,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryIngest";
import {
  ALL_MARKERS,
  AR,
  EN,
  PARENT_ID,
  SALT,
  SPAN_ID,
  TRACE_ID,
  contentFamilyAttributes,
  keptSpanAttributes,
} from "./telemetryFixtures";

// EYEON telemetry ingest: the PROTOBUF path, through the real decoder that the
// runtime uses (CHG-2026-156; review REVIEW-1015 N2). Most OTLP/HTTP exporters
// send protobuf by default, and the other pipeline tests inject a JSON decoder.
// Protobuf carries ids as bytes, int64 as Long and values in a oneof, so the
// filter sees a different shape from JSON; the canaries must still be absent
// from the exact bytes handed to the engine.

const Req =
  $root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
const hex = (h: string) => Buffer.from(h, "hex");
const str = (key: string, v: string) => ({ key, value: { stringValue: v } });

function protoBody(attributes: unknown[]): Buffer {
  const msg = Req.fromObject({
    resourceSpans: [
      {
        resource: {
          attributes: [
            str("service.name", "pilot-chat"),
            str("custom.resource", EN.resourceAttr),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "langfuse-sdk",
              version: "3.0.0",
              attributes: [str("scope.note", EN.scopeAttr)],
            },
            spans: [
              {
                traceId: hex(TRACE_ID),
                spanId: hex(SPAN_ID),
                parentSpanId: hex(PARENT_ID),
                name: EN.spanName,
                kind: 3,
                startTimeUnixNano: "1789827031000000000",
                endTimeUnixNano: "1789827032000000000",
                attributes,
                events: [
                  {
                    name: "gen_ai.user.message",
                    timeUnixNano: "1789827031500000000",
                    attributes: [str("content", EN.prompt)],
                  },
                  {
                    name: "exception",
                    attributes: [
                      str("exception.type", "ValueError"),
                      str("exception.message", AR.exceptionMessage),
                    ],
                  },
                ],
                links: [
                  {
                    traceId: hex(TRACE_ID),
                    spanId: hex(SPAN_ID),
                    attributes: [str("link.note", EN.linkAttr)],
                  },
                ],
                status: { code: 2, message: AR.statusMessage },
                traceState: EN.traceState,
              },
            ],
          },
        ],
      },
    ],
  });
  return Buffer.from(Req.encode(msg).finish());
}

function deps(handoffs: Buffer[]): TelemetryDeps {
  return {
    now: () => 1_790_000_000_000,
    authenticate: async () => ({
      keyId: "key-1",
      orgId: "org-1",
      projectId: "proj-1",
      lineageId: "lineage-1",
      displayName: "pilot-chat",
    }),
    loadPolicy: async () => ({
      projectId: "proj-1",
      enabled: true,
      contentMode: "metadata",
      userIdMode: "hash",
      attributeAllowlistExtra: [],
      retentionDays: null,
      version: 1,
      userHashSalt: SALT,
    }),
    contentModesGateOpen: false,
    maxBodyBytes: 1024 * 1024,
    maxDecodedBytes: 1024 * 1024,
    rateLimit: () => ({ allowed: true, retryAfterSec: 0 }),
    decode: decodeOtlpTraces,
    handoff: async (input) => {
      handoffs.push(input.body);
      return { kind: "ok" };
    },
    record: () => {},
    newBatchId: () => "batch-proto",
  };
}

async function send(body: Buffer, handoffs: Buffer[]) {
  return handleTelemetryRequest(
    {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-proto-key",
        "content-type": "application/x-protobuf",
      },
      readBody: async () => body,
      gunzip: async (b) => b,
    },
    deps(handoffs),
  );
}

describe("protobuf export through the real decoder (CON-1, CON-6)", () => {
  it("no English or Arabic marker reaches the handoff payload", async () => {
    const handoffs: Buffer[] = [];
    const res = await send(
      protoBody([
        ...keptSpanAttributes(),
        ...contentFamilyAttributes(EN),
        ...contentFamilyAttributes(AR),
        str("user.id", EN.userId),
        // Other value encodings on listed keys.
        {
          key: "gen_ai.system",
          value: { bytesValue: Buffer.from(EN.arbitrary) },
        },
        {
          key: "gen_ai.response.model",
          value: { kvlistValue: { values: [str("x", EN.arbitrary)] } },
        },
        {
          key: "gen_ai.operation.name",
          value: { arrayValue: { values: [{ stringValue: EN.arbitrary }] } },
        },
      ]),
      handoffs,
    );
    expect(res.status).toBe(200);
    expect(handoffs).toHaveLength(1);
    const out = handoffs[0].toString("utf8");
    for (const marker of ALL_MARKERS) {
      expect(out, `marker in handoff payload: ${marker}`).not.toContain(marker);
    }
    expect(out).not.toContain(Buffer.from(EN.arbitrary).toString("base64"));
  });

  it("ids, times, status code and usage survive in the shapes the engine reads", async () => {
    const handoffs: Buffer[] = [];
    await send(protoBody(keptSpanAttributes()), handoffs);
    const sp = JSON.parse(handoffs[0].toString("utf8")).resourceSpans[0]
      .scopeSpans[0].spans[0];
    expect(sp.traceId).toBe(TRACE_ID);
    expect(sp.spanId).toBe(SPAN_ID);
    expect(sp.parentSpanId).toBe(PARENT_ID);
    expect(sp.startTimeUnixNano).toBe("1789827031000000000");
    expect(sp.status).toEqual({ code: 2 });
    const attrs = new Map(sp.attributes.map((a: any) => [a.key, a.value]));
    expect(attrs.get("gen_ai.usage.input_tokens")).toEqual({ intValue: "120" });
    expect(attrs.get("gen_ai.request.model")).toEqual({
      stringValue: "gpt-4o-mini",
    });
  });

  it("the app's scope (here langfuse-sdk) is replaced by EYEON's", async () => {
    const handoffs: Buffer[] = [];
    await send(protoBody(keptSpanAttributes()), handoffs);
    const out = JSON.parse(handoffs[0].toString("utf8"));
    expect(out.resourceSpans[0].scopeSpans[0].scope).toEqual({
      name: "eyeon-telemetry-ingest",
    });
    expect(handoffs[0].toString("utf8")).not.toContain("langfuse-sdk");
  });
});

describe("malformed protobuf", () => {
  it("a truncated or garbage body is a MalformedTelemetryError, answered 400", async () => {
    const good = protoBody(keptSpanAttributes());
    for (const bad of [
      good.subarray(0, good.length - 7),
      Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f]),
    ]) {
      expect(() => decodeOtlpTraces(bad, "application/x-protobuf")).toThrow(
        MalformedTelemetryError,
      );
      const handoffs: Buffer[] = [];
      const res = await send(bad, handoffs);
      expect(res.status).toBe(400);
      expect(handoffs).toHaveLength(0);
    }
  });

  it("JSON whose resourceSpans is not a list is refused with 400", async () => {
    const handoffs: Buffer[] = [];
    const res = await handleTelemetryRequest(
      {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-proto-key",
          "content-type": "application/json",
        },
        readBody: async () => Buffer.from('{"resourceSpans":{"0":{}}}'),
        gunzip: async (b) => b,
      },
      deps(handoffs),
    );
    expect(res.status).toBe(400);
    expect(handoffs).toHaveLength(0);
  });
});
