import { describe, it, expect, vi } from "vitest";
import {
  auditedMutation,
  buildLitellmEventRow,
  LitellmAuditIntentError,
  LitellmAuditOutcomeError,
  scrubForRecord,
  type LitellmEventInput,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmEventWriter";

// ADR-0003 §3.6: INTENT before the mutation, OUTCOME before the caller gets a
// result. No database: the write function is a fake.

const CONTEXT = {
  action: "key.create" as const,
  resourceType: "litellmKey" as const,
  resourceId: "key-1",
  orgId: "org-1",
  projectId: "proj-1",
  actor: { userId: "user-1", orgRole: "OWNER", projectRole: "OWNER" },
  before: null,
};

describe("scrubForRecord", () => {
  it("drops secret-named properties and redacts key-shaped strings, keeps token hashes", () => {
    const out = scrubForRecord({
      key: "sk-should-never-be-here-123",
      nested: {
        api_key: "x",
        note: "value sk-abcdef1234567 leaked",
        tokenHash: "a".repeat(64),
      },
      list: [{ secret: "s" }, "sk-zzzzzzzzzzzz"],
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("sk-");
    expect(text).not.toContain("api_key");
    expect(text).toContain("a".repeat(64));
  });
});

describe("buildLitellmEventRow", () => {
  it("an INTENT row has no outcome; an OUTCOME row always has one", () => {
    const base = { ...CONTEXT, correlationId: "c-1" };
    expect(
      buildLitellmEventRow({ ...base, phase: "INTENT" }).outcome,
    ).toBeUndefined();
    expect(
      buildLitellmEventRow({ ...base, phase: "OUTCOME", outcome: "SUCCESS" })
        .outcome,
    ).toBe("SUCCESS");
    // An OUTCOME row with no explicit outcome must not read as a success.
    expect(buildLitellmEventRow({ ...base, phase: "OUTCOME" }).outcome).toBe(
      "FAILURE",
    );
  });

  it("scrubs key material out of before/after/errorMessage", () => {
    const row = buildLitellmEventRow({
      ...CONTEXT,
      correlationId: "c-1",
      phase: "OUTCOME",
      outcome: "FAILURE",
      after: { key: "sk-secret-secret-secret", alias: "a" },
      errorMessage: "LiteLLM said sk-secret-secret-secret is bad",
    });
    expect(JSON.stringify(row)).not.toContain("sk-secret");
  });
});

describe("auditedMutation", () => {
  it("writes INTENT, runs, writes OUTCOME(SUCCESS), in that order, with one correlation ID", async () => {
    const order: string[] = [];
    const rows: LitellmEventInput[] = [];
    const write = vi.fn(async (r: LitellmEventInput) => {
      order.push(`write:${r.phase}`);
      rows.push(r);
    });
    const result = await auditedMutation(
      CONTEXT,
      async () => {
        order.push("run");
        return { result: 42, after: { status: "ACTIVE" } };
      },
      write,
    );
    expect(result).toBe(42);
    expect(order).toEqual(["write:INTENT", "run", "write:OUTCOME"]);
    expect(rows[1]!.outcome).toBe("SUCCESS");
    expect(rows[0]!.correlationId).toBe(rows[1]!.correlationId);
  });

  it("does NOT perform the mutation when the INTENT row cannot be written", async () => {
    const run = vi.fn();
    const write = vi.fn(async () => {
      throw new Error("permission denied for table acme_litellm_events");
    });
    await expect(auditedMutation(CONTEXT, run, write)).rejects.toBeInstanceOf(
      LitellmAuditIntentError,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("records OUTCOME(FAILURE) and rethrows the original error when the mutation fails", async () => {
    const rows: LitellmEventInput[] = [];
    const write = vi.fn(async (r: LitellmEventInput) => {
      rows.push(r);
    });
    const boom = new Error("LiteLLM returned 500");
    await expect(
      auditedMutation(
        CONTEXT,
        async () => {
          throw boom;
        },
        write,
      ),
    ).rejects.toBe(boom);
    expect(rows.map((r) => [r.phase, r.outcome])).toEqual([
      ["INTENT", undefined],
      ["OUTCOME", "FAILURE"],
    ]);
    expect(rows[1]!.errorMessage).toContain("500");
  });

  it("never reports success when the mutation worked but the OUTCOME row could not be written", async () => {
    let n = 0;
    const write = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("db down");
    });
    await expect(
      auditedMutation(CONTEXT, async () => ({ result: "ok" }), write),
    ).rejects.toBeInstanceOf(LitellmAuditOutcomeError);
  });

  it("records PARTIAL when the operation says so", async () => {
    const rows: LitellmEventInput[] = [];
    const write = vi.fn(async (r: LitellmEventInput) => {
      rows.push(r);
    });
    await auditedMutation(
      CONTEXT,
      async () => ({
        result: null,
        outcome: "PARTIAL" as const,
        errorMessage: "half done",
      }),
      write,
    );
    expect(rows[1]!.outcome).toBe("PARTIAL");
  });
});
