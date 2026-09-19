import { describe, it, expect, vi } from "vitest";
import {
  FIRST_RUN_LOOKBACK_MS,
  OVERLAP_MS,
  PAGE_SIZE,
  SETTLE_MS,
  formatForLitellm,
  parseUtc,
  reconcileOnce,
  rowFromSpendLog,
  type KeyOwner,
  type ReconcileDeps,
} from "../features/acmeLitellmReconcile/reconcileCore";

// ADR-0003 §4.4 / CHG-2026-008. No LiteLLM, no Redis, no database: every
// dependency of the reconciliation pass is a fake.

const NOW = new Date("2026-09-19T15:00:00.000Z");
const KNOWN = "a".repeat(64);
const MARKER = "CAIRO-SECRET-PROMPT-MARKER-91c2";

function spendRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    request_id: id,
    startTime: "2026-09-19 14:10:00.123000",
    endTime: "2026-09-19T14:10:02.500000",
    status: "success",
    call_type: "acompletion",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    model_group: "nvidia-nemotron",
    custom_llm_provider: "openrouter",
    api_key: KNOWN,
    team_id: null,
    end_user: "",
    requester_ip_address: "10.224.0.17",
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    spend: 0,
    cache_hit: "False",
    metadata: {
      litellm_call_id: `call-${id}`,
      user_api_key_alias: "cairo-bot",
      status: "success",
    },
    ...extra,
  };
}

function setup(
  pages: unknown[][],
  opts: {
    mirror?: Array<{ requestId: string; litellmCallId: string | null }>;
    last?: Date | null;
  } = {},
) {
  const mirror = [...(opts.mirror ?? [])];
  const runs: Array<Record<string, unknown>> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const fetchSpendLogsPage = vi.fn(async ({ page }: { page: number }) => ({
    data: pages[page - 1] ?? [],
    total_pages: pages.length,
  }));
  const deps: ReconcileDeps = {
    now: () => NOW,
    redact: (t) => t.replace(/sk-[A-Za-z0-9-]+/g, "[REDACTED]"),
    lastSuccessfulWindowEnd: async () => opts.last ?? null,
    fetchSpendLogsPage,
    findExisting: async ({ requestIds, callIds }) => ({
      requestIds: new Set(
        mirror
          .filter((m) => requestIds.includes(m.requestId))
          .map((m) => m.requestId),
      ),
      callIds: new Set(
        mirror
          .filter((m) => m.litellmCallId && callIds.includes(m.litellmCallId))
          .map((m) => m.litellmCallId!),
      ),
    }),
    lookupKeyOwners: async (hashes) =>
      new Map<string, KeyOwner>(
        hashes.includes(KNOWN)
          ? [
              [
                KNOWN,
                { cairoKeyId: "key-1", orgId: "org-1", projectId: "proj-1" },
              ],
            ]
          : [],
      ),
    insertRows: async (rows) => {
      for (const r of rows) {
        inserted.push(r as unknown as Record<string, unknown>);
        mirror.push({
          requestId: r.requestId,
          litellmCallId: r.litellmCallId ?? null,
        });
      }
      return rows.length;
    },
    recordRun: async (run) => {
      runs.push(run as unknown as Record<string, unknown>);
    },
  };
  return { deps, runs, inserted, fetchSpendLogsPage };
}

describe("reconcileOnce", () => {
  it("finds a REAL gap: inserts what the push missed and records a non-zero gap count", async () => {
    const t = setup(
      [[spendRow("delivered"), spendRow("lost-1"), spendRow("lost-2")]],
      {
        mirror: [{ requestId: "delivered", litellmCallId: "call-delivered" }],
      },
    );
    const out = await reconcileOnce(t.deps);
    expect(out).toMatchObject({
      status: "success",
      rowsChecked: 3,
      gapCount: 2,
      inserted: 2,
    });
    expect(t.inserted.map((r) => r.requestId).sort()).toEqual([
      "lost-1",
      "lost-2",
    ]);
    expect(t.inserted.every((r) => r.source === "RECONCILE")).toBe(true);
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({
      status: "success",
      gapCount: 2,
      inserted: 2,
      rowsChecked: 3,
    });
  });

  it("records a zero gap, and inserts nothing, when the push delivered everything", async () => {
    const t = setup([[spendRow("a"), spendRow("b")]], {
      mirror: [
        { requestId: "a", litellmCallId: "call-a" },
        { requestId: "b", litellmCallId: "call-b" },
      ],
    });
    expect(await reconcileOnce(t.deps)).toMatchObject({
      gapCount: 0,
      inserted: 0,
    });
    expect(t.runs[0]).toMatchObject({ status: "success", gapCount: 0 });
  });

  it("does NOT count a cache hit as a gap: the ids differ, the litellm_call_id matches", async () => {
    // LiteLLM appends _cache_hit<time> independently on each path.
    const t = setup(
      [
        [
          spendRow("gen-1_cache_hit1789827031.55", {
            metadata: { litellm_call_id: "call-shared" },
          }),
        ],
      ],
      {
        mirror: [
          {
            requestId: "gen-1_cache_hit1789827031.21",
            litellmCallId: "call-shared",
          },
        ],
      },
    );
    expect(await reconcileOnce(t.deps)).toMatchObject({
      gapCount: 0,
      inserted: 0,
    });
  });

  it("derives the project from the key hash; the master key and unknown keys get none", async () => {
    const t = setup([
      [
        spendRow("managed"),
        spendRow("unmanaged", { api_key: "b".repeat(64) }),
        spendRow("master", { api_key: "litellm_proxy_master_key" }),
      ],
    ]);
    await reconcileOnce(t.deps);
    const by = Object.fromEntries(t.inserted.map((r) => [r.requestId, r]));
    expect(by.managed).toMatchObject({
      projectId: "proj-1",
      orgId: "org-1",
      cairoKeyId: "key-1",
    });
    expect(by.unmanaged).toMatchObject({
      projectId: null,
      apiKeyHash: "b".repeat(64),
    });
    expect(by.master).toMatchObject({ projectId: null, apiKeyHash: null });
  });

  it("copies no prompt or response text even if LiteLLM's row carried some", async () => {
    const t = setup([
      [
        spendRow("x", {
          messages: [{ content: MARKER }],
          response: MARKER,
          proxy_server_request: { body: MARKER },
          metadata: {
            litellm_call_id: "c",
            spend_logs_metadata: { n: MARKER },
            error_information: { error_class: "E", error_message: MARKER },
          },
        }),
      ],
    ]);
    await reconcileOnce(t.deps);
    expect(JSON.stringify(t.inserted)).not.toContain(MARKER);
    expect(t.inserted[0]).toMatchObject({ errorClass: "E" });
  });

  it("when LiteLLM cannot be read: records a FAILURE run, redacted, and the gap is not reported as zero-and-fine", async () => {
    const t = setup([]);
    t.fetchSpendLogsPage.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED with Bearer sk-master-key-abcdef"),
    );
    const out = await reconcileOnce(t.deps);
    expect(out.status).toBe("failure");
    expect(t.runs[0]).toMatchObject({ status: "failure", rowsChecked: 0 });
    expect(String(t.runs[0]!.errorMessage)).toContain("ECONNREFUSED");
    expect(String(t.runs[0]!.errorMessage)).not.toContain("sk-master");
  });

  it("marks the run PARTIAL when a spend-log row cannot be read, and still mirrors the rest", async () => {
    const t = setup([
      [
        spendRow("ok"),
        { request_id: "", startTime: "" },
        spendRow("bad-time", { startTime: "not a date" }),
      ],
    ]);
    const out = await reconcileOnce(t.deps);
    expect(out.status).toBe("partial");
    expect(t.inserted.map((r) => r.requestId)).toEqual(["ok"]);
    expect(String(t.runs[0]!.errorMessage)).toMatch(/could not be read/);
  });

  it("pages through LiteLLM until a short page", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      spendRow(`p1-${i}`),
    );
    const t = setup([full, [spendRow("p2-0")]]);
    const out = await reconcileOnce(t.deps);
    expect(t.fetchSpendLogsPage).toHaveBeenCalledTimes(2);
    expect(out.rowsChecked).toBe(PAGE_SIZE + 1);
  });

  it("window: first run looks back 7 days; rows younger than the settle time are left to the push", async () => {
    const t = setup([[]]);
    const out = await reconcileOnce(t.deps);
    expect(out.windowEnd.getTime()).toBe(NOW.getTime() - SETTLE_MS);
    expect(out.windowStart.getTime()).toBe(
      NOW.getTime() - SETTLE_MS - FIRST_RUN_LOOKBACK_MS,
    );
    expect(t.fetchSpendLogsPage.mock.calls[0]![0]).toMatchObject({
      endDate: "2026-09-19 14:58:00",
      page: 1,
    });
  });

  it("window: later runs overlap the last SUCCESSFUL window", async () => {
    const last = new Date("2026-09-19T14:50:00.000Z");
    const out = await reconcileOnce(setup([[]], { last }).deps);
    expect(out.windowStart.getTime()).toBe(last.getTime() - OVERLAP_MS);
  });
});

describe("helpers", () => {
  it("parseUtc treats LiteLLM's zoneless timestamps as UTC", () => {
    expect(parseUtc("2026-09-19 14:10:00")!.toISOString()).toBe(
      "2026-09-19T14:10:00.000Z",
    );
    expect(parseUtc("2026-09-19T14:10:00Z")!.toISOString()).toBe(
      "2026-09-19T14:10:00.000Z",
    );
    expect(parseUtc("2026-09-19T17:10:00+03:00")!.toISOString()).toBe(
      "2026-09-19T14:10:00.000Z",
    );
    expect(parseUtc("nonsense")).toBeNull();
  });

  it("formatForLitellm matches the format /spend/logs/v2 accepted live", () => {
    expect(formatForLitellm(new Date("2026-09-19T14:58:00.999Z"))).toBe(
      "2026-09-19 14:58:00",
    );
  });

  it("rowFromSpendLog keeps exactly the mirror's columns", () => {
    const row = rowFromSpendLog(spendRow("x") as never, new Map());
    expect(Object.keys(row!).sort()).toEqual(
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
    expect(row).toMatchObject({ cacheHit: false, source: "RECONCILE" });
  });
});
