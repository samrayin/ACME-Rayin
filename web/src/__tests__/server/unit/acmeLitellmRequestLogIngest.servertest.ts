import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/src/env.mjs";
import { logger } from "@langfuse/shared/src/server";
import {
  createFixedWindowLimiter,
  describeErrorForLog,
  ingestPushBatch,
  isAuthorizedIngestRequest,
  MAX_RECORDS_PER_REQUEST,
  standardLoggingPayloadSchema,
  type IngestDeps,
  type KeyOwner,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmRequestLogIngest";

// ADR-0003 §4.5 / CHG-2026-008: the receiver is proven against a REPLAYED
// SAMPLE PAYLOAD before LiteLLM's configuration is touched. The sample below
// carries every field of LiteLLM 1.100.1's StandardLoggingPayload and
// StandardLoggingMetadata (read from the running gateway's type definitions,
// 2026-09-19), with the id shapes observed on real spend-log rows. No network,
// no database.

const MARKER = "CAIRO-SECRET-PROMPT-MARKER-91c2";
const KNOWN_HASH = "a".repeat(64);
const UNKNOWN_HASH = "b".repeat(64);
const SECRET = "ingest-secret-that-is-long-enough-0123456789";

function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen-1789827031-GxGPwC7a9Kd",
    trace_id: "trace-1",
    session_id: "sess-1",
    litellm_call_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    call_type: "acompletion",
    stream: false,
    response_cost: 0,
    cost_breakdown: { input_cost: 0, output_cost: 0 },
    autorouter_savings: null,
    response_cost_failure_debug_info: null,
    status: "success",
    status_fields: { llm_api_status: "success", guardrail_status: "not_run" },
    custom_llm_provider: "openrouter",
    total_tokens: 120,
    prompt_tokens: 100,
    completion_tokens: 20,
    startTime: 1789827031.12,
    endTime: 1789827033.4,
    completionStartTime: 1789827033.4,
    response_time: 2.28,
    model_map_information: { model_map_key: "x", model_map_value: null },
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    model_id: "model-id-1",
    model_group: "nvidia-nemotron",
    api_base: "https://openrouter.ai/api/v1",
    metadata: {
      user_api_key_hash: KNOWN_HASH,
      user_api_key_alias: "cairo-claims-bot-0f8fad5b",
      user_api_key_spend: 0,
      user_api_key_max_budget: 50,
      user_api_key_budget_reset_at: null,
      user_api_key_user_spend: null,
      user_api_key_user_max_budget: null,
      user_api_key_team_spend: null,
      user_api_key_team_max_budget: null,
      user_api_key_org_id: "ATTACKER-ORG",
      user_api_key_org_alias: null,
      user_api_key_team_id: "team-1",
      user_api_key_project_id: "ATTACKER-PROJECT",
      user_api_key_project_alias: "ATTACKER-PROJECT",
      user_api_key_user_id: null,
      user_api_key_user_email: `someone+${MARKER}@example.com`,
      user_api_key_team_alias: null,
      user_api_key_end_user_id: null,
      user_api_key_request_route: "/v1/chat/completions",
      user_api_key_auth_metadata: { note: MARKER },
      spend_logs_metadata: { note: MARKER },
      requester_ip_address: "10.224.0.17",
      user_agent: "python-httpx/0.27",
      requester_metadata: { note: MARKER },
      requester_custom_headers: { "x-note": MARKER },
      prompt_management_metadata: null,
      mcp_tool_call_metadata: null,
      vector_store_request_metadata: null,
      routing_decision: null,
      applied_guardrails: [],
      usage_object: { total_tokens: 120 },
      cold_storage_object_key: null,
      team_alias: null,
      team_id: null,
    },
    cache_hit: false,
    cache_key: null,
    saved_cache_cost: 0,
    request_tags: [],
    request_model_access_groups: [],
    end_user: "",
    requester_ip_address: "10.224.0.17",
    user_agent: "python-httpx/0.27",
    messages: [{ role: "user", content: `account 12345 ${MARKER}` }],
    response: { choices: [{ message: { content: `answer ${MARKER}` } }] },
    error_str: null,
    error_information: { error_code: "", error_class: "", error_message: "" },
    model_parameters: { temperature: 0, stop: [MARKER] },
    hidden_params: { model_id: "model-id-1", api_base: "x" },
    guardrail_information: null,
    standard_built_in_tools_params: null,
    ...overrides,
  };
}

function deps() {
  const stored = new Map<string, Record<string, unknown>>();
  const owners = new Map<string, KeyOwner>([
    [
      KNOWN_HASH,
      { cairoKeyId: "key-1", orgId: "org-real", projectId: "proj-real" },
    ],
  ]);
  const d: IngestDeps = {
    lookupKeyOwners: vi.fn(
      async (hashes: string[]) =>
        new Map([...owners].filter(([h]) => hashes.includes(h))),
    ),
    insertRows: vi.fn(async (rows) => {
      let n = 0;
      for (const r of rows) {
        if (!stored.has(r.requestId)) {
          stored.set(r.requestId, r as unknown as Record<string, unknown>);
          n += 1;
        }
      }
      return n;
    }),
  };
  return { d, stored };
}

describe("isAuthorizedIngestRequest", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedIngestRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedIngestRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedIngestRequest(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedIngestRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedIngestRequest(undefined, SECRET)).toBe(false);
  });

  it("an unset or short secret authorises nobody, including an empty bearer", () => {
    expect(isAuthorizedIngestRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedIngestRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedIngestRequest("Bearer short", "short")).toBe(false);
  });
});

describe("ingestPushBatch: the replayed sample", () => {
  it("accepts the full 1.100.1 payload once, and skips it as a duplicate the second time", async () => {
    const { d, stored } = deps();
    const first = await ingestPushBatch([samplePayload()], d);
    expect(first).toMatchObject({
      received: 1,
      inserted: 1,
      duplicates: 0,
      rejected: 0,
    });
    const second = await ingestPushBatch([samplePayload()], d);
    expect(second).toMatchObject({
      received: 1,
      inserted: 0,
      duplicates: 1,
      rejected: 0,
    });
    expect(stored.size).toBe(1);
  });

  it("derives the project from the key hash and IGNORES the project and org in the payload", async () => {
    const { d, stored } = deps();
    await ingestPushBatch([samplePayload()], d);
    const row = [...stored.values()][0]!;
    expect(row).toMatchObject({
      projectId: "proj-real",
      orgId: "org-real",
      cairoKeyId: "key-1",
      source: "PUSH",
    });
    expect(JSON.stringify(row)).not.toContain("ATTACKER");
  });

  it("stores a record from a key CAIRO did not issue with NO project", async () => {
    const { d, stored } = deps();
    const p = samplePayload({ id: "gen-unmanaged" });
    (p.metadata as Record<string, unknown>).user_api_key_hash = UNKNOWN_HASH;
    await ingestPushBatch([p], d);
    expect([...stored.values()][0]).toMatchObject({
      projectId: null,
      orgId: null,
      cairoKeyId: null,
      apiKeyHash: UNKNOWN_HASH,
    });
  });

  it("stores NO prompt, response, parameter, header, email or error text", async () => {
    const { d, stored } = deps();
    const failing = samplePayload({
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      status: "failure",
      error_str: `BadRequest: could not parse "${MARKER}"`,
      error_information: {
        error_code: "400",
        error_class: "BadRequestError",
        error_message: `provider said: ${MARKER}`,
        traceback: `File x.py\n  prompt=${MARKER}`,
      },
    });
    await ingestPushBatch([samplePayload(), failing], d);
    expect(stored.size).toBe(2);
    expect(JSON.stringify([...stored.values()])).not.toContain(MARKER);
    expect(stored.get("0f8fad5b-d9cb-469f-a165-70867728950e")).toMatchObject({
      status: "failure",
      errorClass: "BadRequestError",
    });
  });

  it("keeps exactly the allow-listed columns", async () => {
    const { d, stored } = deps();
    await ingestPushBatch([samplePayload()], d);
    expect(Object.keys([...stored.values()][0]!).sort()).toEqual(
      [
        "apiKeyHash",
        "cacheHit",
        "cairoKeyId",
        "callType",
        "completionTokens",
        "endTime",
        "endUser",
        "errorClass",
        "keyAlias",
        "litellmCallId",
        "litellmTeamId",
        "model",
        "modelGroup",
        "orgId",
        "projectId",
        "promptTokens",
        "provider",
        "requestId",
        "requesterIp",
        "source",
        "spend",
        "startTime",
        "status",
        "totalTokens",
      ].sort(),
    );
  });
});

describe("ingestPushBatch: rejection, never coercion", () => {
  it.each([
    ["an unknown top-level field", samplePayload({ surprise_field: 1 })],
    [
      "an unknown metadata field",
      samplePayload({
        metadata: { ...samplePayload().metadata, new_meta: "x" },
      }),
    ],
    ["an unknown status", samplePayload({ status: "partial" })],
    ["a numeric id", samplePayload({ id: 12345 })],
    [
      "a missing id",
      (() => {
        const p = samplePayload() as Record<string, unknown>;
        delete p.id;
        return p;
      })(),
    ],
    ["a string token count", samplePayload({ total_tokens: "120" })],
    ["a millisecond timestamp", samplePayload({ startTime: 1789827031120 })],
    [
      "a key hash that is not a SHA-256",
      samplePayload({
        metadata: {
          ...samplePayload().metadata,
          user_api_key_hash: "sk-live-key",
        },
      }),
    ],
    ["a non-object", "just a string"],
    ["null", null],
  ])("rejects a record with %s", async (_name, record) => {
    const { d, stored } = deps();
    const out = await ingestPushBatch([record], d);
    expect(out).toMatchObject({ received: 1, inserted: 0, rejected: 1 });
    expect(stored.size).toBe(0);
  });

  it("keeps the good records of a mixed batch and counts the bad ones", async () => {
    const { d, stored } = deps();
    const out = await ingestPushBatch(
      [
        samplePayload({ id: "ok-1" }),
        samplePayload({ id: "bad", surprise: true }),
        samplePayload({ id: "ok-2" }),
      ],
      d,
    );
    expect(out).toMatchObject({ received: 3, inserted: 2, rejected: 1 });
    expect([...stored.keys()].sort()).toEqual(["ok-1", "ok-2"]);
  });

  it("rejection reasons name field paths and codes, never values", async () => {
    const { d } = deps();
    const out = await ingestPushBatch(
      [
        samplePayload({
          id: "bad",
          [`leak_${MARKER}`]: MARKER,
          total_tokens: MARKER,
        }),
      ],
      d,
    );
    expect(out.rejectionReasons.join(" ")).toContain("total_tokens");
    // zod reports an unrecognised KEY under the code only; the value never appears
    expect(out.rejectionReasons.join(" ")).not.toContain(`"${MARKER}"`);
  });

  it("refuses a body that is not an array, and a batch over the limit", async () => {
    const { d } = deps();
    await expect(ingestPushBatch({ data: [] }, d)).rejects.toMatchObject({
      httpStatus: 400,
    });
    const tooMany = Array.from(
      { length: MAX_RECORDS_PER_REQUEST + 1 },
      (_, i) => samplePayload({ id: `r-${i}` }),
    );
    await expect(ingestPushBatch(tooMany, d)).rejects.toMatchObject({
      httpStatus: 413,
    });
    expect(d.insertRows).not.toHaveBeenCalled();
  });

  it("the sample itself satisfies the closed schema (guards the fixture)", () => {
    expect(
      standardLoggingPayloadSchema.safeParse(samplePayload()).success,
    ).toBe(true);
  });
});

describe("createFixedWindowLimiter", () => {
  it("allows up to the ceiling per window and recovers in the next window", () => {
    const allow = createFixedWindowLimiter(2, 1000);
    expect([allow(0), allow(10), allow(20)]).toEqual([true, true, false]);
    expect(allow(1001)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The HTTP handler
// ---------------------------------------------------------------------------

const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({
  count: data.length,
}));
const findMany = vi.fn(async () => [
  {
    id: "key-1",
    orgId: "org-real",
    projectId: "proj-real",
    tokenHash: KNOWN_HASH,
  },
]);

vi.mock("@langfuse/shared/src/db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: {
    acmeLitellmKey: { findMany: (...a: unknown[]) => findMany(...(a as [])) },
  },
}));
vi.mock(
  "@/src/features/acme-enhancements/server/litellm/acmeLitellmEventWriter",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getLitellmWriterClient: () => ({ acmeLitellmRequestLog: { createMany } }),
  }),
);

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const api = {
    status: (c: number) => {
      res.statusCode = c;
      return api;
    },
    json: (b: unknown) => {
      res.body = b;
      return api;
    },
    setHeader: (k: string, v: string) => {
      res.headers[k] = v;
      return api;
    },
  };
  return { res, api: api as unknown as NextApiResponse };
}

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let handler: Handler;

async function callHandler(req: Partial<NextApiRequest>) {
  const { res, api } = mockRes();
  await handler({ method: "POST", headers: {}, ...req } as NextApiRequest, api);
  return res;
}

describe("POST /api/public/litellm-request-logs", () => {
  const e = env as unknown as Record<string, string | undefined>;
  const original = {
    flag: e.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED,
    secret: e.CAIRO_LITELLM_INGEST_SECRET,
  };
  const auth = { authorization: `Bearer ${SECRET}` };

  // The route pulls in the shared server package; its first import is slow.
  beforeAll(async () => {
    handler = (await import("@/src/pages/api/public/litellm-request-logs"))
      .default as Handler;
  }, 180_000);

  beforeEach(() => {
    e.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "true";
    e.CAIRO_LITELLM_INGEST_SECRET = SECRET;
    createMany.mockClear();
    findMany.mockClear();
  });
  afterEach(() => {
    e.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = original.flag;
    e.CAIRO_LITELLM_INGEST_SECRET = original.secret;
  });

  it("answers 404 while the flag is off, even with a valid secret", async () => {
    e.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED = "false";
    expect(
      (await callHandler({ headers: auth, body: [samplePayload()] }))
        .statusCode,
    ).toBe(404);
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["no Authorization header", {}],
    [
      "the wrong secret",
      { authorization: "Bearer wrong-secret-wrong-secret-wrong-secret-0000" },
    ],
    ["a project-style basic auth header", { authorization: "Basic cGs6c2s=" }],
  ])("rejects %s with 401 and writes nothing", async (_n, headers) => {
    const res = await callHandler({ headers, body: [samplePayload()] });
    expect(res.statusCode).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects everything when no secret is configured", async () => {
    e.CAIRO_LITELLM_INGEST_SECRET = undefined;
    expect(
      (await callHandler({ headers: { authorization: "Bearer " }, body: [] }))
        .statusCode,
    ).toBe(401);
  });

  it("405 for anything but POST", async () => {
    expect(
      (await callHandler({ method: "GET", headers: auth })).statusCode,
    ).toBe(405);
  });

  it("200 with counts for the replayed sample, written with skipDuplicates", async () => {
    const res = await callHandler({ headers: auth, body: [samplePayload()] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: 1, inserted: 1, rejected: 0 });
    expect(createMany.mock.calls[0]![0]).toMatchObject({
      skipDuplicates: true,
    });
    expect(JSON.stringify(createMany.mock.calls[0]![0])).not.toContain(MARKER);
  });

  it("422 when every record is malformed; 400 when the body is not an array", async () => {
    expect(
      (await callHandler({ headers: auth, body: [{ nope: true }] })).statusCode,
    ).toBe(422);
    expect(
      (await callHandler({ headers: auth, body: { nope: true } })).statusCode,
    ).toBe(400);
  });

  it("503 (retryable) when the database write fails, and no detail leaks", async () => {
    createMany.mockRejectedValueOnce(
      new Error("password authentication failed for user rayin_litellm_writer"),
    );
    const res = await callHandler({ headers: auth, body: [samplePayload()] });
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("rayin_litellm_writer");
  });
  // -------------------------------------------------------------------------
  // Nothing from a request may reach a log line. The payload carries prompts,
  // error messages, tracebacks, model parameters, requester headers and user
  // emails; the receiver logs in exactly two places and neither may echo them.
  // -------------------------------------------------------------------------
  describe("logs never contain request content", () => {
    function spyOnEveryLogSink() {
      const calls: unknown[][] = [];
      const record = (...a: unknown[]) => {
        calls.push(a);
      };
      const spies = [
        vi.spyOn(logger, "error").mockImplementation(record as never),
        vi.spyOn(logger, "warn").mockImplementation(record as never),
        vi.spyOn(logger, "info").mockImplementation(record as never),
        vi.spyOn(logger, "debug").mockImplementation(record as never),
        vi.spyOn(console, "error").mockImplementation(record),
        vi.spyOn(console, "warn").mockImplementation(record),
        vi.spyOn(console, "log").mockImplementation(record),
      ];
      return {
        text: () =>
          JSON.stringify(calls, (_k, v: unknown) =>
            v instanceof Error
              ? { name: v.name, message: v.message, stack: v.stack }
              : v,
          ),
        count: () => calls.length,
        restore: () => spies.forEach((sp) => sp.mockRestore()),
      };
    }

    it("a rejected record: the log line has counts, field paths and codes, and none of the payload", async () => {
      const sink = spyOnEveryLogSink();
      try {
        const poisoned = samplePayload({
          id: "bad-1",
          total_tokens: MARKER, // wrong type, value is the marker
          [`unknown_${MARKER}`]: MARKER, // unknown KEY is the marker too
          error_str: MARKER,
          error_information: {
            error_class: "E",
            error_message: MARKER,
            traceback: MARKER,
          },
        });
        const res = await callHandler({
          headers: auth,
          body: [poisoned, samplePayload({ id: "ok-1" })],
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
          received: 2,
          inserted: 1,
          rejected: 1,
        });
        expect(sink.count()).toBeGreaterThan(0); // the rejection IS logged
        expect(sink.text()).toContain("total_tokens");
        expect(sink.text()).not.toContain(MARKER);
        expect(JSON.stringify(res.body)).not.toContain(MARKER);
      } finally {
        sink.restore();
      }
    });

    it("a database failure whose message echoes the row: only the error name and code are logged", async () => {
      const sink = spyOnEveryLogSink();
      try {
        // What a Prisma validation error really does: it prints its arguments.
        const echo = Object.assign(
          new Error(
            `Invalid createMany() invocation: { data: [ { endUser: "${MARKER}", requesterIp: "10.0.0.9" } ] }`,
          ),
          {
            name: "PrismaClientValidationError",
            code: "P2009",
            meta: { target: MARKER },
          },
        );
        createMany.mockRejectedValueOnce(echo);
        const res = await callHandler({
          headers: auth,
          body: [samplePayload()],
        });
        expect(res.statusCode).toBe(503);
        expect(sink.count()).toBe(1);
        expect(sink.text()).toContain("PrismaClientValidationError");
        expect(sink.text()).toContain("P2009");
        expect(sink.text()).not.toContain(MARKER);
        expect(sink.text()).not.toContain("10.0.0.9");
        expect(sink.text()).not.toContain("createMany() invocation");
        expect(JSON.stringify(res.body)).not.toContain(MARKER);
      } finally {
        sink.restore();
      }
    });

    it("an accepted batch and a refused request log nothing at all", async () => {
      const sink = spyOnEveryLogSink();
      try {
        await callHandler({ headers: auth, body: [samplePayload()] });
        await callHandler({ headers: {}, body: [samplePayload()] });
        await callHandler({
          headers: auth,
          body: { not: "an array", note: MARKER },
        });
        expect(sink.count()).toBe(0);
      } finally {
        sink.restore();
      }
    });
  });

  describe("describeErrorForLog", () => {
    it("keeps the class name and a short machine code, and drops everything else", () => {
      const e = Object.assign(new Error(`secret ${MARKER}`), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
      });
      expect(describeErrorForLog(e)).toEqual({
        errorName: "PrismaClientKnownRequestError",
        errorCode: "P2002",
      });
    });

    it("refuses a name or code that is not a plain identifier, so neither can smuggle text", () => {
      const e = Object.assign(new Error("x"), {
        name: `Bad name ${MARKER}`,
        code: `code with ${MARKER}`,
      });
      expect(describeErrorForLog(e)).toEqual({
        errorName: "UnknownError",
        errorCode: null,
      });
      expect(describeErrorForLog(MARKER)).toEqual({
        errorName: "UnknownError",
        errorCode: null,
      });
    });
  });
});
