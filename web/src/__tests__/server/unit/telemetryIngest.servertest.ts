import { gunzip, gzipSync } from "node:zlib";
import { describe, it, expect, vi } from "vitest";
import {
  createKeyAuthenticator,
  hashKey,
  type KeyRecord,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryAuth";
import {
  hashEndUserId,
  MalformedTelemetryError,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";
import {
  handleTelemetryRequest,
  HANDOFF_INGESTION_VERSION,
  HANDOFF_PUBLIC_KEY,
  HANDOFF_SDK_NAME,
  TelemetryBodyTooLargeError,
  type HandoffInput,
  type HandoffResult,
  type TelemetryDeps,
  type TelemetryHttpRequest,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryIngest";
import type { PolicyRow } from "@/src/features/acme-enhancements/server/telemetry/telemetryPolicy";
import { createKeyedRateLimiter } from "@/src/features/acme-enhancements/server/telemetry/telemetryRateLimit";
import type { StatsDelta } from "@/src/features/acme-enhancements/server/telemetry/telemetryStats";
import {
  AR,
  ALL_MARKERS,
  EN,
  SALT,
  TRACE_ID,
  SPAN_ID,
  contentFamilyAttributes,
  keptSpanAttributes,
  resourceSpans,
  s,
  span,
} from "./telemetryFixtures";

// EYEON telemetry ingest, steps A to F end to end, with every effect injected.
// The assertions that matter most are on `handoffs[n].body`: the EXACT bytes
// that would be handed to the engine's OTLP processing (LLD CON-1, CON-6).

const T0 = 1_790_000_000_000;
const KEY_A = "synthetic-test-key-for-project-a";
const KEY_B = "synthetic-test-key-for-project-b";

function keyRecord(key: string, overrides: Partial<KeyRecord> = {}): KeyRecord {
  const project = key === KEY_A ? "proj-a" : "proj-b";
  return {
    id: `key-${project}`,
    orgId: `org-${project}`,
    projectId: project,
    lineageId: `lineage-${project}`,
    displayName: `app-${project}`,
    tokenHash: hashKey(key),
    status: "ACTIVE",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function policyRow(
  projectId: string,
  overrides: Partial<PolicyRow> = {},
): PolicyRow {
  return {
    projectId,
    enabled: true,
    contentMode: "metadata",
    userIdMode: "hash",
    attributeAllowlistExtra: [],
    retentionDays: null,
    version: 4,
    userHashSalt: projectId === "proj-a" ? SALT : `${SALT}-b`,
    ...overrides,
  };
}

type Setup = {
  keys?: KeyRecord[];
  policies?: PolicyRow[];
  ratePerMinute?: number;
  maxBodyBytes?: number;
  handoff?: (input: HandoffInput) => Promise<HandoffResult>;
  loadPolicyThrows?: boolean;
  lookupThrows?: boolean;
  gateOpen?: boolean;
};

function harness(setup: Setup = {}) {
  const keys = setup.keys ?? [keyRecord(KEY_A), keyRecord(KEY_B)];
  const policies = setup.policies ?? [policyRow("proj-a"), policyRow("proj-b")];
  const handoffs: HandoffInput[] = [];
  const records: {
    projectId: string | null;
    lineageId: string | null;
    delta: StatsDelta;
  }[] = [];
  const readBody = vi.fn();
  const authenticator = createKeyAuthenticator({
    lookup: async (hash) => {
      if (setup.lookupThrows) throw new Error("db down");
      return keys.find((k) => k.tokenHash === hash) ?? null;
    },
    now: () => T0,
  });
  const limiter = createKeyedRateLimiter(setup.ratePerMinute ?? 600, 60_000);
  const deps: TelemetryDeps = {
    now: () => T0,
    authenticate: (h) => authenticator.authenticate(h),
    loadPolicy: async (projectId) => {
      if (setup.loadPolicyThrows) throw new Error("db down");
      return policies.find((p) => p.projectId === projectId) ?? null;
    },
    contentModesGateOpen: setup.gateOpen ?? false,
    maxBodyBytes: setup.maxBodyBytes ?? 1024 * 1024,
    rateLimit: (k, n) => limiter.check(k, n),
    decode: (body) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        throw new MalformedTelemetryError();
      }
      if (typeof parsed !== "object" || parsed === null) {
        throw new MalformedTelemetryError();
      }
      return (parsed as { resourceSpans?: unknown }).resourceSpans ?? [];
    },
    handoff: async (input) => {
      handoffs.push(input);
      return setup.handoff ? setup.handoff(input) : { kind: "ok" };
    },
    record: (projectId, lineageId, delta) =>
      records.push({ projectId, lineageId, delta }),
    newBatchId: () => "batch-test",
  };

  function request(
    payload: unknown,
    headers: Record<string, string> = {},
    opts: { gzip?: boolean; raw?: Buffer; method?: string } = {},
  ): TelemetryHttpRequest {
    const raw =
      opts.raw ??
      (opts.gzip
        ? gzipSync(Buffer.from(JSON.stringify(payload)))
        : Buffer.from(JSON.stringify(payload)));
    readBody.mockImplementation(async (max: number) => {
      if (raw.byteLength > max) throw new TelemetryBodyTooLargeError(false);
      return raw;
    });
    return {
      method: opts.method ?? "POST",
      headers: {
        authorization: `Bearer ${KEY_A}`,
        "content-type": "application/json",
        ...(opts.gzip ? { "content-encoding": "gzip" } : {}),
        ...headers,
      },
      readBody,
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

  return { deps, handoffs, records, readBody, request };
}

const goodExport = () => ({ resourceSpans: resourceSpans([span()]) });

const lastDelta = (h: ReturnType<typeof harness>) =>
  h.records[h.records.length - 1].delta;

describe("accepted batch", () => {
  it("answers an empty success and hands over exactly once, scope from the key row", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);

    expect(res).toEqual({ status: 200, body: {} });
    expect(h.handoffs).toHaveLength(1);
    const call = h.handoffs[0];
    expect(call.config).toEqual({
      projectId: "proj-a",
      publicKey: HANDOFF_PUBLIC_KEY,
      orgId: "org-proj-a",
      sdkName: HANDOFF_SDK_NAME,
      sdkVersion: "1",
      ingestionVersion: HANDOFF_INGESTION_VERSION,
    });
    expect(HANDOFF_PUBLIC_KEY).toBe("eyeon:telemetry-ingest");
    expect(HANDOFF_SDK_NAME).toBe("eyeon-telemetry-ingest");
    expect(HANDOFF_INGESTION_VERSION).toBe("4");
    expect(call.contentType).toBe("application/json");
    expect(call.encodedBodyBytes).toBe(call.body.byteLength);
  });

  it("the handed-over body is filtered OTLP/JSON with the server's labels", async () => {
    const h = harness();
    await handleTelemetryRequest(h.request(goodExport()), h.deps);
    const sent = JSON.parse(h.handoffs[0].body.toString("utf8"));
    const sp = sent.resourceSpans[0].scopeSpans[0].spans[0];
    expect(sp.traceId).toBe(TRACE_ID);
    expect(sp.spanId).toBe(SPAN_ID);
    const attrs = new Map<string, any>(
      sp.attributes.map((a: any) => [a.key, a.value]),
    );
    expect(attrs.get("gen_ai.request.model")).toEqual({
      stringValue: "gpt-4o-mini",
    });
    expect(attrs.get("gen_ai.usage.input_tokens")).toEqual({ intValue: "120" });
    expect(attrs.get("eyeon.source")).toEqual({ stringValue: "app" });
    expect(attrs.get("eyeon.trust")).toEqual({ stringValue: "asserted" });
    expect(attrs.get("eyeon.application")).toEqual({
      stringValue: "app-proj-a",
    });
    expect(attrs.get("eyeon.key_lineage")).toEqual({
      stringValue: "lineage-proj-a",
    });
    expect(attrs.get("eyeon.content_mode")).toEqual({
      stringValue: "metadata",
    });
    expect(attrs.get("eyeon.policy_version")).toEqual({ intValue: "4" });
    expect(attrs.get("eyeon.ingest_batch")).toEqual({
      stringValue: "batch-test",
    });
    expect(attrs.get("eyeon.allowlist_version")).toBeDefined();
  });

  it("counts the batch and its drops, by project and lineage, with counts only", async () => {
    const h = harness();
    await handleTelemetryRequest(
      h.request({
        resourceSpans: resourceSpans([
          span({
            attributes: [
              ...keptSpanAttributes(),
              ...contentFamilyAttributes(EN),
            ],
          }),
        ]),
      }),
      h.deps,
    );
    const rec = h.records[h.records.length - 1];
    expect(rec.projectId).toBe("proj-a");
    expect(rec.lineageId).toBe("lineage-proj-a");
    expect(rec.delta.accepted).toBe(1);
    expect(rec.delta.spans_in).toBe(1);
    expect(rec.delta.spans_out).toBe(1);
    expect(rec.delta.attrs_dropped).toBeGreaterThan(0);
    expect(rec.delta.dropped_content).toBeGreaterThan(0);
    expect(JSON.stringify(h.records)).not.toContain(EN.arbitrary);
  });

  it("an empty export is accepted and nothing is handed over", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request({ resourceSpans: [] }),
      h.deps,
    );
    expect(res.status).toBe(200);
    expect(h.handoffs).toHaveLength(0);
    expect(lastDelta(h).accepted).toBe(1);
  });

  it("a batch whose every span is unusable is accepted and nothing is handed over", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request({
        resourceSpans: resourceSpans([span({ traceId: EN.arbitrary })]),
      }),
      h.deps,
    );
    expect(res.status).toBe(200);
    expect(h.handoffs).toHaveLength(0);
    expect(lastDelta(h).dropped_spans).toBe(1);
  });

  it("accepts gzip, and x-api-key in place of Authorization", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(
        goodExport(),
        { authorization: "", "x-api-key": KEY_A },
        { gzip: true },
      ),
      h.deps,
    );
    expect(res.status).toBe(200);
    expect(h.handoffs).toHaveLength(1);
  });
});

describe("canary fixtures through the whole pipeline (CON-1, CON-6)", () => {
  function hostileExport() {
    return {
      resourceSpans: resourceSpans(
        [
          span({
            name: EN.spanName,
            attributes: [
              ...keptSpanAttributes(),
              ...contentFamilyAttributes(EN),
              ...contentFamilyAttributes(AR),
              s("user.id", EN.userId),
              s("langfuse.user.id", AR.userId),
            ],
            status: {
              code: 2,
              message: `${EN.statusMessage} ${AR.statusMessage}`,
            },
            traceState: EN.traceState,
            links: [
              {
                traceId: TRACE_ID,
                spanId: SPAN_ID,
                attributes: [s("n", EN.linkAttr)],
              },
            ],
            events: [
              {
                name: "gen_ai.user.message",
                attributes: [s("content", EN.prompt)],
              },
              {
                name: "gen_ai.choice",
                attributes: [s("message", AR.completion)],
              },
              {
                name: "gen_ai.content.completion",
                attributes: [s("c", EN.completion)],
              },
              {
                name: "exception",
                attributes: [
                  s("exception.type", "RuntimeError"),
                  s(
                    "exception.message",
                    `${EN.exceptionMessage} ${AR.exceptionMessage}`,
                  ),
                  s("exception.stacktrace", EN.exceptionStack),
                ],
              },
            ],
          }),
        ],
        [
          s("service.name", "pilot-chat"),
          s("custom.resource", EN.resourceAttr),
          s("process.command_line", AR.arbitrary),
        ],
        {
          name: AR.spanName,
          version: "1.0.0",
          attributes: [s("n", EN.scopeAttr)],
        },
      ),
    };
  }

  it("no marker is in the exact payload handed to the engine", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(hostileExport()),
      h.deps,
    );
    expect(res.status).toBe(200);
    expect(h.handoffs).toHaveLength(1);
    const payload = h.handoffs[0].body.toString("utf8");
    for (const marker of ALL_MARKERS) {
      expect(payload, `marker in handoff payload: ${marker}`).not.toContain(
        marker,
      );
    }
    // Nor in the response, the counters, or anywhere the handoff config reaches.
    const everything = JSON.stringify([
      res,
      h.records,
      h.handoffs.map((x) => x.config),
    ]);
    for (const marker of ALL_MARKERS) expect(everything).not.toContain(marker);
  });

  it("the same holds for a gzip-compressed body", async () => {
    const h = harness();
    await handleTelemetryRequest(
      h.request(hostileExport(), {}, { gzip: true }),
      h.deps,
    );
    const payload = h.handoffs[0].body.toString("utf8");
    for (const marker of ALL_MARKERS) expect(payload).not.toContain(marker);
  });

  it("the key never appears in the payload, the response, the counters or the config", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(hostileExport()),
      h.deps,
    );
    const everything = JSON.stringify([
      res,
      h.records,
      h.handoffs.map((x) => [x.body.toString("utf8"), x.config]),
    ]);
    expect(everything).not.toContain(KEY_A);
    expect(everything).not.toContain(hashKey(KEY_A));
  });

  it("RESIDUAL: a label that fits an allowlisted key's shape is kept", async () => {
    const h = harness();
    const fits = "GD1-EN-LABEL-FITS-THE-SHAPE";
    await handleTelemetryRequest(
      h.request({
        resourceSpans: resourceSpans([
          span({ attributes: [s("session.id", fits)] }),
        ]),
      }),
      h.deps,
    );
    expect(h.handoffs[0].body.toString("utf8")).toContain(fits);
  });
});

describe("authentication (SEC-1, SEC-2)", () => {
  const cases: [string, Record<string, string>, Partial<KeyRecord> | null][] = [
    ["no key", { authorization: "" }, null],
    ["unknown key", { authorization: "Bearer synthetic-not-a-key" }, null],
    ["revoked", {}, { revokedAt: new Date(T0 - 1) }],
    ["status revoked", {}, { status: "REVOKED" }],
    ["rotated out", {}, { status: "ROTATED" }],
    ["expired", {}, { expiresAt: new Date(T0 - 1000) }],
    ["malformed header", { authorization: "Bearer" }, null],
    ["wrong scheme", { authorization: `Basic ${KEY_A}` }, null],
  ];

  it("every failure is the same 401 with the same body, and nothing is read or handed over", async () => {
    const responses: unknown[] = [];
    for (const [, headers, override] of cases) {
      const keys = override ? [keyRecord(KEY_A, override)] : [keyRecord(KEY_A)];
      const h = harness({ keys });
      const res = await handleTelemetryRequest(
        h.request(goodExport(), headers),
        h.deps,
      );
      expect(res.status).toBe(401);
      expect(h.readBody).not.toHaveBeenCalled();
      expect(h.handoffs).toHaveLength(0);
      expect(h.records).toEqual([
        { projectId: null, lineageId: null, delta: { rejected_auth: 1 } },
      ]);
      responses.push(JSON.stringify(res));
    }
    expect(new Set(responses).size).toBe(1);
  });

  it("a lookup failure is 503, not 401, and nothing is handed over", async () => {
    const h = harness({ lookupThrows: true });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(503);
    expect(h.handoffs).toHaveLength(0);
  });
});

describe("isolation (SEC-5, SEC-6)", () => {
  it("key A cannot write into project B, whatever the payload names", async () => {
    const h = harness();
    await handleTelemetryRequest(
      h.request({
        resourceSpans: resourceSpans(
          [
            span({
              attributes: [
                ...keptSpanAttributes(),
                s("langfuse.project.id", "proj-b"),
                s("eyeon.project_id", "proj-b"),
                s("langfuse.environment", "proj-b"),
              ],
            }),
          ],
          [
            s("service.name", "pilot-chat"),
            s("langfuse.project.id", "proj-b"),
            s("eyeon.application", "proj-b"),
          ],
        ),
      }),
      h.deps,
    );
    expect(h.handoffs[0].config.projectId).toBe("proj-a");
    expect(h.handoffs[0].config.orgId).toBe("org-proj-a");
    expect(h.handoffs[0].body.toString("utf8")).not.toContain("proj-b");
  });

  it("each key reaches only its own project, and its own policy", async () => {
    const h = harness({
      policies: [policyRow("proj-a"), policyRow("proj-b", { enabled: false })],
    });
    const a = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    const b = await handleTelemetryRequest(
      h.request(goodExport(), { authorization: `Bearer ${KEY_B}` }),
      h.deps,
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(403);
    expect(h.handoffs.map((x) => x.config.projectId)).toEqual(["proj-a"]);
  });

  it("the app cannot overwrite the server's labels", async () => {
    const h = harness();
    await handleTelemetryRequest(
      h.request({
        resourceSpans: resourceSpans([
          span({
            attributes: [
              ...keptSpanAttributes(),
              s("eyeon.source", "gateway"),
              s("eyeon.trust", "verified"),
              s("eyeon.content_mode", "full"),
              s("eyeon.policy_version", "99"),
              s("eyeon.user_hash", "deadbeefdeadbeef"),
            ],
          }),
        ]),
      }),
      h.deps,
    );
    const sp = JSON.parse(h.handoffs[0].body.toString("utf8")).resourceSpans[0]
      .scopeSpans[0].spans[0];
    const find = (k: string) => sp.attributes.filter((a: any) => a.key === k);
    expect(find("eyeon.source")).toEqual([
      { key: "eyeon.source", value: { stringValue: "app" } },
    ]);
    expect(find("eyeon.trust")[0].value).toEqual({ stringValue: "asserted" });
    expect(find("eyeon.content_mode")[0].value).toEqual({
      stringValue: "metadata",
    });
    expect(find("eyeon.policy_version")[0].value).toEqual({ intValue: "4" });
    expect(find("eyeon.user_hash")).toEqual([]);
  });
});

describe("policy (B)", () => {
  it("a project with no policy row is 403, and the body is not read", async () => {
    const h = harness({ policies: [] });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(403);
    expect(h.readBody).not.toHaveBeenCalled();
    expect(h.handoffs).toHaveLength(0);
    expect(h.records).toEqual([
      {
        projectId: "proj-a",
        lineageId: "lineage-proj-a",
        delta: { rejected_disabled: 1 },
      },
    ]);
  });

  it("enabled = false is 403", async () => {
    const h = harness({ policies: [policyRow("proj-a", { enabled: false })] });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(403);
    expect(h.handoffs).toHaveLength(0);
  });

  it.each(["redacted", "full"] as const)(
    "%s is handled as metadata, stamped metadata, and counted (CON-4)",
    async (mode) => {
      const h = harness({
        policies: [policyRow("proj-a", { contentMode: mode })],
      });
      const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
      expect(res.status).toBe(200);
      const json = h.handoffs[0].body.toString("utf8");
      expect(json).toContain('"eyeon.content_mode"');
      expect(json).not.toContain(`"stringValue":"${mode}"`);
      expect(lastDelta(h).policy_downgraded).toBe(1);
    },
  );

  it("with the content-mode gate open, nothing changes: no mode is built", async () => {
    const h = harness({
      gateOpen: true,
      policies: [policyRow("proj-a", { contentMode: "full" })],
    });
    await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(h.handoffs[0].body.toString("utf8")).not.toContain(
      '"stringValue":"full"',
    );
    expect(lastDelta(h).policy_downgraded).toBe(1);
  });

  it("an unreachable policy table is 503 (fail closed), never an accept", async () => {
    const h = harness({ loadPolicyThrows: true });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(503);
    expect(h.handoffs).toHaveLength(0);
  });
});

describe("end-user id (CON-5)", () => {
  const withUser = (id: string) => ({
    resourceSpans: resourceSpans([
      span({ attributes: [...keptSpanAttributes(), s("user.id", id)] }),
    ]),
  });

  it("hash mode: the raw id is absent and the hash is present", async () => {
    const h = harness();
    await handleTelemetryRequest(
      h.request(withUser("synthetic-user-123")),
      h.deps,
    );
    const payload = h.handoffs[0].body.toString("utf8");
    expect(payload).not.toContain("synthetic-user-123");
    expect(payload).toContain(hashEndUserId(SALT, "synthetic-user-123"));
    expect(payload).toContain('"eyeon.user_hash"');
  });

  it("the hash differs by project", async () => {
    const h = harness();
    await handleTelemetryRequest(
      h.request(withUser("synthetic-user-123")),
      h.deps,
    );
    await handleTelemetryRequest(
      h.request(withUser("synthetic-user-123"), {
        authorization: `Bearer ${KEY_B}`,
      }),
      h.deps,
    );
    const [a, b] = h.handoffs.map((x) => x.body.toString("utf8"));
    expect(a).not.toBe(b);
    expect(b).toContain(hashEndUserId(`${SALT}-b`, "synthetic-user-123"));
    expect(b).not.toContain(hashEndUserId(SALT, "synthetic-user-123"));
  });

  it("drop mode: neither the id nor a hash", async () => {
    const h = harness({
      policies: [policyRow("proj-a", { userIdMode: "drop" })],
    });
    await handleTelemetryRequest(
      h.request(withUser("synthetic-user-123")),
      h.deps,
    );
    const payload = h.handoffs[0].body.toString("utf8");
    expect(payload).not.toContain("synthetic-user-123");
    expect(payload).not.toContain("eyeon.user_hash");
  });

  it("no id sent: no hash", async () => {
    const h = harness();
    await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(h.handoffs[0].body.toString("utf8")).not.toContain(
      "eyeon.user_hash",
    );
  });
});

describe("limits and types (C): SEC-7, SEC-8", () => {
  it("an oversize body is 413 and the connection is closed", async () => {
    const h = harness({ maxBodyBytes: 100 });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(413);
    expect(res.closeConnection).toBe(true);
    expect(h.handoffs).toHaveLength(0);
    expect(lastDelta(h).rejected_size).toBe(1);
  });

  it("a gzip bomb stops at the DECODED limit, even though it is tiny encoded", async () => {
    const h = harness({ maxBodyBytes: 64 * 1024 });
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    const res = await handleTelemetryRequest(
      h.request(null, { "content-encoding": "gzip" }, { raw: bomb }),
      h.deps,
    );
    expect(res.status).toBe(413);
    expect(res.closeConnection).toBe(false);
    expect(h.handoffs).toHaveLength(0);
    expect(lastDelta(h).rejected_size).toBe(1);
  });

  it("too many spans in one export is 413", async () => {
    const h = harness({ maxBodyBytes: 64 * 1024 * 1024 });
    const spans = Array.from({ length: 5001 }, () => span());
    const res = await handleTelemetryRequest(
      h.request({ resourceSpans: resourceSpans(spans) }),
      h.deps,
    );
    expect(res.status).toBe(413);
    expect(h.handoffs).toHaveLength(0);
  });

  it("a wrong content type is 415", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(goodExport(), { "content-type": "text/plain" }),
      h.deps,
    );
    expect(res.status).toBe(415);
    expect(h.readBody).not.toHaveBeenCalled();
    expect(lastDelta(h).rejected_type).toBe(1);
  });

  it("an unsupported content encoding is 415", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(goodExport(), { "content-encoding": "br" }),
      h.deps,
    );
    expect(res.status).toBe(415);
  });

  it("a flood on one key is 429 with Retry-After; another key is unaffected", async () => {
    const h = harness({ ratePerMinute: 3 });
    const statuses: number[] = [];
    for (let n = 0; n < 5; n++) {
      statuses.push(
        (await handleTelemetryRequest(h.request(goodExport()), h.deps)).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const limited = await handleTelemetryRequest(
      h.request(goodExport()),
      h.deps,
    );
    expect(limited.headers?.["Retry-After"]).toMatch(/^[1-9][0-9]*$/);
    const other = await handleTelemetryRequest(
      h.request(goodExport(), { authorization: `Bearer ${KEY_B}` }),
      h.deps,
    );
    expect(other.status).toBe(200);
  });

  it("a method other than POST is 405", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(goodExport(), {}, { method: "GET" }),
      h.deps,
    );
    expect(res.status).toBe(405);
    expect(res.headers?.Allow).toBe("POST");
  });
});

describe("malformed input and the filter (D)", () => {
  it("invalid JSON is 400", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request(null, {}, { raw: Buffer.from("{not json") }),
      h.deps,
    );
    expect(res.status).toBe(400);
    expect(lastDelta(h).rejected_malformed).toBe(1);
  });

  it("attributes written as an object is 400", async () => {
    const h = harness();
    const res = await handleTelemetryRequest(
      h.request({
        resourceSpans: resourceSpans([span({ attributes: { a: "b" } })]),
      }),
      h.deps,
    );
    expect(res.status).toBe(400);
    expect(h.handoffs).toHaveLength(0);
  });

  it("a filter defect drops the whole batch and hands nothing over (fail closed)", async () => {
    const h = harness();
    const booby = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  startTimeUnixNano: "1",
                  get name(): string {
                    throw new Error("simulated filter defect");
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const h2 = {
      ...h,
      deps: { ...h.deps, decode: () => booby.resourceSpans },
    };
    const res = await handleTelemetryRequest(h2.request(goodExport()), h2.deps);
    expect(res.status).toBe(500);
    expect(h.handoffs).toHaveLength(0);
    expect(lastDelta(h).rejected_filter).toBe(1);
    expect(JSON.stringify(res)).not.toContain("simulated filter defect");
  });
});

describe("the engine (F)", () => {
  it("an engine refusal of our own output is 400, counted as rejected_handoff, NOT rejected_malformed", async () => {
    const h = harness({ handoff: async () => ({ kind: "http", status: 400 }) });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid OTLP trace export" });
    const delta = lastDelta(h);
    expect(delta.rejected_handoff).toBe(1);
    expect(delta.rejected_malformed).toBeUndefined();
    expect(delta.accepted).toBeUndefined();
  });

  it("an unavailable engine is 503, counted rejected_engine, and its error text is not returned", async () => {
    const h = harness({
      handoff: async () => {
        // Assembled, so no connection-string-with-password literal sits in source.
        throw new Error(
          ["redis:", "//user:", "SECRET", "@host:6379 refused"].join(""),
        );
      },
    });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res)).not.toContain("SECRET");
    expect(lastDelta(h).rejected_engine).toBe(1);
  });

  it("never returns the engine's job object", async () => {
    const h = harness({
      handoff: async () =>
        ({
          kind: "ok",
          job: { id: "job-123", data: { fileKey: "otel/p/x.json" } },
        }) as any,
    });
    const res = await handleTelemetryRequest(h.request(goodExport()), h.deps);
    expect(res).toEqual({ status: 200, body: {} });
    expect(JSON.stringify(res)).not.toContain("job-123");
    expect(JSON.stringify(res)).not.toContain("fileKey");
  });
});
