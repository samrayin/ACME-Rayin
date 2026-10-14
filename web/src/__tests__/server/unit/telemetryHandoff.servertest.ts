import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@langfuse/shared/src/env";

// EYEON telemetry ingest, step F: the handoff to the engine's own OTLP
// processing, with the REAL processOtelIngestion and the REAL
// OtelIngestionProcessor, and only the two things it reaches outside the
// process for replaced: the S3 upload and the queue publish.
//
// What this documents and asserts (SPIKE-REPORT SP-1, at source level):
//   - one S3 upload and one queue publish, and nothing else is reached;
//   - the queue job's scope is built from the VALUES SUPPLIED, with no key row
//     read and no database call;
//   - what reaches S3 is the filtered payload and nothing the app sent as
//     content (the exact bytes the engine would store).
// It is NOT a runtime proof: that is the first live batch and the CON-1 canary
// run inside the worker pod.

const mocks = vi.hoisted(() => ({
  uploadJson: vi.fn(),
  getInstance: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("@langfuse/shared/src/server/s3", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getS3EventStorageClient: () => ({ uploadJson: mocks.uploadJson }),
  };
});

vi.mock("@langfuse/shared/src/server/redis/otelIngestionQueue", () => ({
  OtelIngestionQueue: {
    getInstance: (...args: unknown[]) => {
      mocks.getInstance(...args);
      return { add: mocks.queueAdd };
    },
  },
}));

import { processOtelIngestion } from "@/src/server/otel/processOtelIngestion";
import {
  HANDOFF_INGESTION_VERSION,
  HANDOFF_PUBLIC_KEY,
  HANDOFF_SDK_NAME,
  HANDOFF_SDK_VERSION,
  handleTelemetryRequest,
  type TelemetryDeps,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryIngest";
import { createKeyedRateLimiter } from "@/src/features/acme-enhancements/server/telemetry/telemetryRateLimit";
import {
  ALL_MARKERS,
  AR,
  EN,
  SALT,
  contentFamilyAttributes,
  keptSpanAttributes,
  resourceSpans,
  s,
  span,
} from "./telemetryFixtures";

const SCOPE = {
  projectId: "proj-handoff-synthetic",
  orgId: "org-handoff-synthetic",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadJson.mockResolvedValue(undefined);
  mocks.queueAdd.mockResolvedValue({ id: "job-synthetic" });
});

function deps(): TelemetryDeps {
  const limiter = createKeyedRateLimiter(600, 60_000);
  return {
    now: () => 1_790_000_000_000,
    authenticate: async () => ({
      keyId: "key-1",
      orgId: SCOPE.orgId,
      projectId: SCOPE.projectId,
      lineageId: "lineage-1",
      displayName: "pilot-chat",
    }),
    loadPolicy: async () => ({
      projectId: SCOPE.projectId,
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
    rateLimit: (k, n) => limiter.check(k, n),
    decode: (body) => JSON.parse(body.toString("utf8")).resourceSpans,
    // The REAL engine entry point, called exactly as telemetryRuntime does.
    handoff: async (input) => {
      const result = await processOtelIngestion({
        body: input.body,
        contentType: input.contentType,
        encodedBodyBytes: input.encodedBodyBytes,
        config: input.config,
      });
      return result.kind === "ok"
        ? { kind: "ok" }
        : { kind: "http", status: result.status };
    },
    record: () => {},
    newBatchId: () => "batch-handoff",
  };
}

async function send(payload: unknown) {
  const raw = Buffer.from(JSON.stringify(payload));
  return handleTelemetryRequest(
    {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-handoff-key",
        "content-type": "application/json",
      },
      readBody: async () => raw,
      gunzip: async (b) => b,
    },
    deps(),
  );
}

describe("the synthetic scope reaches the engine as supplied", () => {
  it("one S3 upload and one queue publish, scope built from the supplied values", async () => {
    const res = await send({ resourceSpans: resourceSpans([span()]) });
    expect(res).toEqual({ status: 200, body: {} });

    // One upload, under <prefix>otel/<projectId>/<yyyy/mm/dd/hh/mm>/<uuid>.json
    expect(mocks.uploadJson).toHaveBeenCalledTimes(1);
    const [fileKey] = mocks.uploadJson.mock.calls[0];
    const prefix = env.LANGFUSE_S3_EVENT_UPLOAD_PREFIX ?? "";
    expect(fileKey).toMatch(
      new RegExp(
        `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}otel/${SCOPE.projectId}/\\d{4}/\\d{2}/\\d{2}/\\d{2}/\\d{2}/[0-9a-f-]{36}\\.json$`,
      ),
    );

    // One publish, to a queue instance sharded by the supplied project.
    expect(mocks.getInstance).toHaveBeenCalledTimes(1);
    expect(mocks.getInstance).toHaveBeenCalledWith({
      shardingKey: `${SCOPE.projectId}-${fileKey}`,
    });
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
    const [jobName, job] = mocks.queueAdd.mock.calls[0];
    expect(String(jobName)).toBeTruthy();
    expect(job.payload.authCheck).toEqual({
      validKey: true,
      scope: {
        projectId: SCOPE.projectId,
        accessLevel: "project",
        orgId: SCOPE.orgId,
      },
    });
    expect(job.payload.data).toEqual({
      fileKey,
      publicKey: HANDOFF_PUBLIC_KEY,
    });
    expect(job.payload.sdkName).toBe(HANDOFF_SDK_NAME);
    expect(job.payload.sdkVersion).toBe(HANDOFF_SDK_VERSION);
    expect(job.payload.ingestionVersion).toBe(HANDOFF_INGESTION_VERSION);
    expect(job.payload.ingestionVersion).toBe("4");
    expect(job.payload.isLangfuseInternal).toBeUndefined();
  });

  it("the engine's job object never reaches the caller", async () => {
    mocks.queueAdd.mockResolvedValue({
      id: "job-LEAK-CHECK",
      data: { fileKey: "x" },
    });
    const res = await send({ resourceSpans: resourceSpans([span()]) });
    expect(JSON.stringify(res)).not.toContain("job-LEAK-CHECK");
  });

  it("an unavailable queue is a 503, not an accept", async () => {
    mocks.queueAdd.mockRejectedValue(new Error("queue down"));
    const res = await send({ resourceSpans: resourceSpans([span()]) });
    expect(res.status).toBe(503);
  });

  it("an unavailable S3 is a 503, and nothing is queued", async () => {
    mocks.uploadJson.mockRejectedValue(new Error("s3 down"));
    const res = await send({ resourceSpans: resourceSpans([span()]) });
    expect(res.status).toBe(503);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });
});

describe("what reaches S3 (CON-1, CON-6): the bytes the engine would store", () => {
  const hostile = () => ({
    resourceSpans: resourceSpans(
      [
        span({
          name: EN.spanName,
          attributes: [
            ...keptSpanAttributes(),
            ...contentFamilyAttributes(EN),
            ...contentFamilyAttributes(AR),
            s("user.id", EN.userId),
          ],
          status: { code: 2, message: AR.statusMessage },
          events: [
            {
              name: "gen_ai.user.message",
              attributes: [s("content", EN.prompt)],
            },
            {
              name: "exception",
              attributes: [
                s("exception.type", "ValueError"),
                s("exception.message", AR.exceptionMessage),
              ],
            },
          ],
        }),
      ],
      [s("service.name", "pilot-chat"), s("custom.resource", EN.resourceAttr)],
    ),
  });

  it("no English or Arabic marker is in anything uploaded or queued", async () => {
    await send(hostile());
    expect(mocks.uploadJson).toHaveBeenCalledTimes(1);
    const everything = JSON.stringify([
      mocks.uploadJson.mock.calls,
      mocks.queueAdd.mock.calls,
    ]);
    for (const marker of ALL_MARKERS) {
      expect(
        everything,
        `marker reached S3 or the queue: ${marker}`,
      ).not.toContain(marker);
    }
  });

  it("what was uploaded converts through the real OtelIngestionProcessor into a generation with model and usage", async () => {
    await send({ resourceSpans: resourceSpans([span()]) });
    const uploaded = mocks.uploadJson.mock.calls[0][1];

    // The package does not export this path to the type checker (the test
    // runner resolves it through its alias), so the shape used is stated here.
    const { OtelIngestionProcessor } = await vi.importActual<{
      OtelIngestionProcessor: new (config: Record<string, unknown>) => {
        processToEvent: (resourceSpans: unknown) => unknown[];
      };
    }>("@langfuse/shared/src/server/otel/OtelIngestionProcessor");
    const events = new OtelIngestionProcessor({
      projectId: SCOPE.projectId,
      orgId: SCOPE.orgId,
      publicKey: HANDOFF_PUBLIC_KEY,
      sdkName: HANDOFF_SDK_NAME,
      sdkVersion: HANDOFF_SDK_VERSION,
      ingestionVersion: HANDOFF_INGESTION_VERSION,
    }).processToEvent(uploaded);

    expect(events).toHaveLength(1);
    const json = JSON.stringify(events[0]);
    expect(json).toContain("gpt-4o-mini");
    expect(json).toContain("GENERATION");
    expect(json).toContain("120");
    // The server's own labels survive into the engine's record.
    expect(json).toContain("eyeon.trust");
    expect(json).toContain("asserted");
  });
});

// Review REVIEW-1015 C1 (CHG-2026-156): the engine stores no span attributes for
// a scope whose name starts `langfuse-sdk`, and maps `openinference.span.kind`
// GUARDRAIL to a GUARDRAIL observation. Before the fix an app could do both and
// write an unlabelled "guardrail decision" into its trace. These run the bytes
// actually uploaded through the engine's own processor.
describe("the reviewer's C1 probes, through the real OtelIngestionProcessor", () => {
  async function engineEvents() {
    const uploaded = mocks.uploadJson.mock.calls[0][1];
    const { OtelIngestionProcessor } = await vi.importActual<{
      OtelIngestionProcessor: new (config: Record<string, unknown>) => {
        processToEvent: (resourceSpans: unknown) => any[];
      };
    }>("@langfuse/shared/src/server/otel/OtelIngestionProcessor");
    return {
      uploaded,
      events: new OtelIngestionProcessor({
        projectId: SCOPE.projectId,
        orgId: SCOPE.orgId,
        publicKey: HANDOFF_PUBLIC_KEY,
        sdkName: HANDOFF_SDK_NAME,
        sdkVersion: HANDOFF_SDK_VERSION,
        ingestionVersion: HANDOFF_INGESTION_VERSION,
      }).processToEvent(uploaded),
    };
  }

  it.each(["langfuse-sdk", "langfuse-sdk-python", "livekit-agents"])(
    "an app scope named %j does not strip the server's labels",
    async (scopeName) => {
      await send({
        resourceSpans: resourceSpans(
          [
            span({
              attributes: [
                ...keptSpanAttributes(),
                s("user.id", "synthetic-user-9"),
              ],
            }),
          ],
          [s("service.name", "pilot-chat")],
          { name: scopeName, version: "3.0.0" },
        ),
      });
      const { uploaded, events } = await engineEvents();
      // What is stored carries EYEON's scope, never the app's.
      expect(uploaded[0].scopeSpans[0].scope).toEqual({
        name: "eyeon-telemetry-ingest",
      });
      expect(JSON.stringify(uploaded)).not.toContain(scopeName);
      // And the engine keeps every stamped label, the user hash included.
      expect(events).toHaveLength(1);
      const meta = JSON.stringify(events[0].metadata);
      for (const label of [
        "eyeon.source",
        "eyeon.trust",
        "eyeon.application",
        "eyeon.key_lineage",
        "eyeon.content_mode",
        "eyeon.allowlist_version",
        "eyeon.ingest_batch",
        "eyeon.user_hash",
      ]) {
        expect(
          meta,
          `label missing from the engine record: ${label}`,
        ).toContain(label);
      }
    },
  );

  it.each(["GUARDRAIL", "EVALUATOR"])(
    "an app span asserting %s is not stored as that observation type, and keeps its labels",
    async (kind) => {
      await send({
        resourceSpans: resourceSpans(
          [
            span({
              name: "eyeon guardrail decision: allow",
              attributes: [s("openinference.span.kind", kind)],
            }),
          ],
          [s("service.name", "pilot-chat")],
          { name: "langfuse-sdk-python", version: "3.0.0" },
        ),
      });
      const { events } = await engineEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).not.toBe(kind);
      expect(["GUARDRAIL", "EVALUATOR"]).not.toContain(events[0].type);
      expect(JSON.stringify(events[0].metadata)).toContain("eyeon.source");
      expect(JSON.stringify(events[0].metadata)).toContain("eyeon.trust");
    },
  );
});
