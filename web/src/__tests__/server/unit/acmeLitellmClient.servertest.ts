import { describe, it, expect, vi } from "vitest";
import {
  createLitellmClient,
  LitellmHttpError,
  LitellmResponseShapeError,
  LitellmUnreachableError,
  redact,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmClient";

// ADR-0003 / CHG-2026-005. No network, no database: fetch is a fake.

const MASTER = "sk-master-SECRET-value-1234567890";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
}

function clientWith(fetchFn: unknown) {
  const sleepFn = vi.fn(async (_ms: number) => undefined);
  const client = createLitellmClient({
    baseUrl: "http://litellm.test:4000/",
    masterKey: MASTER,
    fetchFn: fetchFn as typeof fetch,
    sleepFn,
    readRetryDelaysMs: [1, 2],
  });
  return { client, sleepFn };
}

describe("redact", () => {
  it("removes the master key and anything shaped like a LiteLLM key", () => {
    const out = redact(`bad key ${MASTER} and also sk-abcdef123456`, MASTER);
    expect(out).not.toContain(MASTER);
    expect(out).not.toContain("sk-abcdef123456");
    expect(out).toContain("[REDACTED]");
  });
});

describe("acmeLitellmClient", () => {
  it("sends the master key as a bearer token and litellm-changed-by on mutations", async () => {
    const fetchFn = vi.fn(async (_url: URL, _init: RequestInit) =>
      jsonResponse(200, {
        key: "sk-new-virtual-key-000000",
        token: "a".repeat(64),
      }),
    );
    const { client } = clientWith(fetchFn);
    await client.generateKey({ key_alias: "x" }, "user-42");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("http://litellm.test:4000/key/generate");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${MASTER}`);
    expect(headers["litellm-changed-by"]).toBe("user-42");
  });

  it("never puts the master key in an error, even when LiteLLM echoes it back", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(401, {
        error: { message: `Invalid key ${MASTER} supplied` },
      }),
    );
    const { client } = clientWith(fetchFn);
    const err = await client.deleteKey("hash", "u").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LitellmHttpError);
    expect((err as Error).message).not.toContain(MASTER);
    expect(
      JSON.stringify(err, Object.getOwnPropertyNames(err as object)),
    ).not.toContain(MASTER);
  });

  it("never puts the master key in an unreachable error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError(
        `connect ECONNREFUSED while sending Bearer ${MASTER}`,
      );
    });
    const { client } = clientWith(fetchFn);
    const err = await client.listAllKeys().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LitellmUnreachableError);
    expect((err as Error).message).not.toContain(MASTER);
  });

  it("retries reads with backoff on network failure and 5xx, then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(503, "busy"))
      .mockResolvedValueOnce(jsonResponse(200, { keys: [], total_count: 0 }));
    const { client, sleepFn } = clientWith(fetchFn);
    await expect(client.listAllKeys()).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });

  it("does not retry a read on a 4xx", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(403, { error: "nope" }));
    const { client } = clientWith(fetchFn);
    await expect(client.listAllKeys()).rejects.toBeInstanceOf(LitellmHttpError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("NEVER retries a mutation, even on a timeout: a blind retry could mint a second key", async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const { client, sleepFn } = clientWith(fetchFn);
    await expect(
      client.generateKey({ key_alias: "x" }, "u"),
    ).rejects.toBeInstanceOf(LitellmUnreachableError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("recognises LiteLLM's Enterprise refusal", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(400, {
        detail: {
          error: "You must be a LiteLLM Enterprise user to use this feature.",
        },
      }),
    );
    const { client } = clientWith(fetchFn);
    const err = (await client
      .deleteKey("h", "u")
      .catch((e: unknown) => e)) as LitellmHttpError;
    expect(err.status).toBe(400);
    expect(err.isEnterpriseGated).toBe(true);
  });

  it("raises a shape error when a create response has no key", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { token: "abc" }));
    const { client } = clientWith(fetchFn);
    await expect(client.generateKey({}, "u")).rejects.toBeInstanceOf(
      LitellmResponseShapeError,
    );
  });

  it("keyInfo returns null for a key LiteLLM does not have", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(404, { error: { message: "not found" } }),
    );
    const { client } = clientWith(fetchFn);
    await expect(client.keyInfo("h")).resolves.toBeNull();
  });

  it("filters daily activity to one key by token hash", async () => {
    const fetchFn = vi.fn(async (_url: URL) =>
      jsonResponse(200, { results: [] }),
    );
    const { client } = clientWith(fetchFn);
    await client.dailyActivityForKey("hash-1", "2026-09-01", "2026-09-19");
    const url = fetchFn.mock.calls[0]![0];
    expect(url.pathname).toBe("/user/daily/activity");
    expect(url.searchParams.get("api_key")).toBe("hash-1");
  });

  it("tolerates both breakdown shapes", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        results: [
          {
            date: "2026-09-19",
            metrics: { spend: 1, api_requests: 2 },
            breakdown: {
              model_groups: { a: { metrics: { spend: 1 } }, b: { spend: 3 } },
            },
          },
        ],
      }),
    );
    const { client } = clientWith(fetchFn);
    const r = await client.dailyActivityForKey("h", "2026-09-19", "2026-09-19");
    const groups = r.results[0]!.breakdown!.model_groups!;
    expect(groups.a!.metrics.spend).toBe(1);
    expect(groups.b!.metrics.spend).toBe(3);
  });
});
