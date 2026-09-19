import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LitellmHttpError,
  LitellmUnreachableError,
  type LitellmClient,
  type LitellmKeyRow,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmClient";
import { type LitellmEventInput } from "@/src/features/acme-enhancements/server/litellm/acmeLitellmEventWriter";
import {
  buildKeyAlias,
  compareKeyWithLive,
  createKey,
  getProjectSpend,
  hashLitellmKey,
  listProjectKeys,
  listUnmanagedKeys,
  LitellmInvalidStateError,
  LitellmNotFoundError,
  LitellmRotationPartialError,
  LitellmRotationRolledBackError,
  mergeCairoMetadata,
  resolvePartialRotation,
  revokeKey,
  rotateKey,
  updateKeyLimits,
  type LitellmDb,
  type LitellmServiceDeps,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmService";

// ADR-0003 / CHG-2026-005. No network, no database: LiteLLM and Prisma are
// in-memory fakes, the audit writer is a recorder.

const SCOPE = { orgId: "org-1", projectId: "proj-1" };
const ACTOR = { userId: "user-1", orgRole: "OWNER", projectRole: "OWNER" };
const LIMITS = {
  models: ["nvidia-nemotron"],
  maxBudget: 50,
  budgetDuration: "30d",
  rpmLimit: 60,
  tpmLimit: null,
};

type Row = Record<string, unknown> & { id: string };

function table(idField = "id") {
  const rows = new Map<string, Row>();
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as object)) {
        return ((v as { in: unknown[] }).in as unknown[]).includes(row[k]);
      }
      if (v && typeof v === "object" && "not" in (v as object)) {
        return row[k] !== (v as { not: unknown }).not;
      }
      return row[k] === v;
    });
  return {
    rows,
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = {
        createdAt: new Date("2026-09-19T00:00:00Z"),
        revokedAt: null,
        rotatedToKeyId: null,
        tokenHash: null,
        expiresAt: null,
        ...data,
      } as Row;
      rows.set(String(row[idField]), row);
      return row;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Row;
        data: Record<string, unknown>;
      }) => {
        const row = rows.get(String(where[idField]));
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      },
    ),
    findFirst: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].find((r) => matches(r, where)) ?? null,
    ),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...rows.values()].filter((r) => matches(r, where)),
    ),
    findUnique: vi.fn(
      async ({ where }: { where: Row }) =>
        rows.get(String(where[idField])) ?? null,
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: Row;
        create: Row;
        update: Record<string, unknown>;
      }) => {
        const existing = rows.get(String(where[idField]));
        if (existing) return Object.assign(existing, update);
        rows.set(String(create[idField]), create);
        return create;
      },
    ),
    count: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].filter((r) => matches(r, where)).length,
    ),
  };
}

function fakeLitellm() {
  const keys = new Map<string, LitellmKeyRow>();
  let n = 0;
  const client = {
    generateKey: vi.fn(async (settings: Record<string, unknown>) => {
      n += 1;
      const key = `sk-virtual-key-number-${n}-xxxxxxxx`;
      const token = hashLitellmKey(key);
      keys.set(token, {
        token,
        key_alias: settings.key_alias as string,
        spend: (settings.spend as number) ?? 0,
        max_budget: (settings.max_budget as number) ?? null,
        models: (settings.models as string[]) ?? [],
        team_id: (settings.team_id as string) ?? null,
        rpm_limit: (settings.rpm_limit as number) ?? null,
        tpm_limit: (settings.tpm_limit as number) ?? null,
        metadata: settings.metadata as Record<string, unknown>,
      });
      return { key, token, expires: null };
    }),
    keyInfo: vi.fn(async (token: string) => keys.get(token) ?? null),
    updateKey: vi.fn(
      async (token: string, settings: Record<string, unknown>) => {
        const k = keys.get(token)!;
        if (settings.metadata)
          k.metadata = settings.metadata as Record<string, unknown>;
        if ("max_budget" in settings)
          k.max_budget = settings.max_budget as number;
      },
    ),
    deleteKey: vi.fn(async (token: string) => {
      keys.delete(token);
    }),
    listAllKeys: vi.fn(async () => [...keys.values()]),
    dailyActivityForKey: vi.fn(
      async (_token: string): Promise<{ results: unknown[] }> => ({
        results: [],
      }),
    ),
  };
  return { keys, client };
}

function setup() {
  const litellm = fakeLitellm();
  const db = {
    acmeLitellmKey: table(),
    acmeLitellmTeam: table(),
    acmeLitellmSpendSnapshot: table("cacheKey"),
  };
  const events: LitellmEventInput[] = [];
  const deps: LitellmServiceDeps = {
    client: litellm.client as unknown as LitellmClient,
    db: db as unknown as LitellmDb,
    write: async (e) => {
      events.push(e);
    },
    now: () => new Date("2026-09-19T12:00:00Z"),
  };
  return { ...litellm, db, events, deps };
}

describe("mergeCairoMetadata", () => {
  it("keeps everything LiteLLM put in metadata and replaces only cairo_* keys", () => {
    const merged = mergeCairoMetadata(
      {
        tags: ["a"],
        temp_budget_increase: 5,
        guardrails: ["x"],
        cairo_key_id: "old",
      },
      { cairo_key_id: "new", cairo_managed: true },
    );
    expect(merged).toEqual({
      tags: ["a"],
      temp_budget_increase: 5,
      guardrails: ["x"],
      cairo_key_id: "new",
      cairo_managed: true,
    });
  });

  it("refuses to write a non-cairo key", () => {
    expect(() => mergeCairoMetadata({}, { tags: ["x"] })).toThrow(/cairo_/);
  });
});

describe("buildKeyAlias", () => {
  it("is stable for generation 1 and carries a generation suffix after rotation", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(buildKeyAlias("Chat Widget!", id, 1)).toBe(
      "cairo-chat-widget-0f8fad5b",
    );
    expect(buildKeyAlias("Chat Widget!", id, 3)).toBe(
      "cairo-chat-widget-0f8fad5b-r3",
    );
  });
});

describe("createKey", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("writes a PENDING row before LiteLLM is called, then ACTIVE with the token hash", async () => {
    const statusAtCall: unknown[] = [];
    t.client.generateKey.mockImplementationOnce(async (settings) => {
      statusAtCall.push([...t.db.acmeLitellmKey.rows.values()][0]!.status);
      const key = "sk-only-once-aaaaaaaaaaaa";
      t.keys.set(hashLitellmKey(key), {
        token: hashLitellmKey(key),
        metadata: settings.metadata as never,
      });
      return { key, token: hashLitellmKey(key), expires: null };
    });
    const out = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "Chat widget",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    expect(statusAtCall).toEqual(["PENDING"]);
    const row = [...t.db.acmeLitellmKey.rows.values()][0]!;
    expect(row.status).toBe("ACTIVE");
    expect(row.tokenHash).toBe(hashLitellmKey(out.secret));
    expect(row.projectId).toBe("proj-1");
  });

  it("tags the LiteLLM key with CAIRO project, org, user and key id in metadata, never in tags", async () => {
    await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "k",
      teamId: null,
      expiresInDays: 30,
      ...LIMITS,
    });
    const sent = t.client.generateKey.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(sent.tags).toBeUndefined();
    expect(sent.model_max_budget).toBeUndefined();
    expect(sent.duration).toBe("30d");
    expect(sent.metadata).toMatchObject({
      cairo_managed: true,
      cairo_org_id: "org-1",
      cairo_project_id: "proj-1",
      cairo_created_by: "user-1",
    });
  });

  it("returns the secret once and writes it NOWHERE: not the row, not the audit record", async () => {
    const out = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "k",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    expect(out.secret).toMatch(/^sk-/);
    expect(
      JSON.stringify([...t.db.acmeLitellmKey.rows.values()]),
    ).not.toContain(out.secret);
    expect(JSON.stringify(t.events)).not.toContain(out.secret);
    expect(JSON.stringify(out.key)).not.toContain(out.secret);
    expect(t.events.map((e) => [e.action, e.phase, e.outcome])).toEqual([
      ["key.create", "INTENT", undefined],
      ["key.create", "OUTCOME", "SUCCESS"],
    ]);
  });

  it("marks the row FAILED and records FAILURE when LiteLLM refuses", async () => {
    t.client.generateKey.mockRejectedValueOnce(
      new LitellmHttpError("/key/generate", 400, "bad"),
    );
    await expect(
      createKey(t.deps, SCOPE, ACTOR, {
        displayName: "k",
        teamId: null,
        expiresInDays: null,
        ...LIMITS,
      }),
    ).rejects.toBeInstanceOf(LitellmHttpError);
    expect([...t.db.acmeLitellmKey.rows.values()][0]!.status).toBe("FAILED");
    expect(t.events.at(-1)!.outcome).toBe("FAILURE");
  });

  it("removes the LiteLLM key again if CAIRO cannot record it", async () => {
    t.db.acmeLitellmKey.update.mockRejectedValueOnce(new Error("db down"));
    await expect(
      createKey(t.deps, SCOPE, ACTOR, {
        displayName: "k",
        teamId: null,
        expiresInDays: null,
        ...LIMITS,
      }),
    ).rejects.toThrow("db down");
    expect(t.client.deleteKey).toHaveBeenCalledTimes(1);
    expect(t.keys.size).toBe(0);
  });

  it("refuses a team from another project without calling LiteLLM", async () => {
    await t.db.acmeLitellmTeam.create({
      data: { id: "team-x", projectId: "OTHER", status: "ACTIVE" },
    });
    await expect(
      createKey(t.deps, SCOPE, ACTOR, {
        displayName: "k",
        teamId: "team-x",
        expiresInDays: null,
        ...LIMITS,
      }),
    ).rejects.toBeInstanceOf(LitellmNotFoundError);
    expect(t.client.generateKey).not.toHaveBeenCalled();
    expect(t.events).toHaveLength(0);
  });
});

describe("project scoping", () => {
  it("a key id from another project does not resolve, and LiteLLM is never called", async () => {
    const t = setup();
    const made = await createKey(
      t.deps,
      { orgId: "org-1", projectId: "OTHER" },
      ACTOR,
      {
        displayName: "theirs",
        teamId: null,
        expiresInDays: null,
        ...LIMITS,
      },
    );
    t.client.deleteKey.mockClear();
    for (const attempt of [
      () => revokeKey(t.deps, SCOPE, ACTOR, made.key.id),
      () => rotateKey(t.deps, SCOPE, ACTOR, made.key.id),
      () => updateKeyLimits(t.deps, SCOPE, ACTOR, made.key.id, LIMITS),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(LitellmNotFoundError);
    }
    expect(t.client.deleteKey).not.toHaveBeenCalled();
    expect(t.client.updateKey).not.toHaveBeenCalled();
    expect(t.keys.size).toBe(1);
  });
});

describe("updateKeyLimits", () => {
  it("sends the MERGED metadata, preserving what LiteLLM stored there", async () => {
    const t = setup();
    const made = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "k",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    const token = hashLitellmKey(made.secret);
    t.keys.get(token)!.metadata = {
      ...t.keys.get(token)!.metadata,
      tags: ["finance"],
      temp_budget_increase: 10,
    };
    await updateKeyLimits(t.deps, SCOPE, ACTOR, made.key.id, {
      ...LIMITS,
      maxBudget: 75,
    });
    const sent = t.client.updateKey.mock.calls[0]![1] as {
      metadata: Record<string, unknown>;
    };
    expect(sent.metadata.tags).toEqual(["finance"]);
    expect(sent.metadata.temp_budget_increase).toBe(10);
    expect(sent.metadata.cairo_key_id).toBe(made.key.id);
  });
});

describe("rotateKey (compose-and-revoke, not native rotation)", () => {
  async function withKey() {
    const t = setup();
    const made = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "Chat",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.keys.get(hashLitellmKey(made.secret))!.spend = 12.5;
    t.events.length = 0;
    return { t, made };
  }

  it("creates the new key, deletes the old one, under ONE correlation ID", async () => {
    const { t, made } = await withKey();
    const out = await rotateKey(t.deps, SCOPE, ACTOR, made.key.id);
    expect(out.status).toBe("rotated");
    expect(out.secret).not.toBe(made.secret);
    expect(t.keys.has(hashLitellmKey(made.secret))).toBe(false);
    expect(t.keys.has(hashLitellmKey(out.secret))).toBe(true);
    expect(new Set(t.events.map((e) => e.correlationId)).size).toBe(1);
    expect(
      t.events.map((e) => `${e.action}:${e.phase}:${e.outcome ?? ""}`),
    ).toEqual([
      "key.rotate:INTENT:",
      "key.rotate.create:INTENT:",
      "key.rotate.create:OUTCOME:SUCCESS",
      "key.rotate.revoke:INTENT:",
      "key.rotate.revoke:OUTCOME:SUCCESS",
      "key.rotate:OUTCOME:SUCCESS",
    ]);
    expect(JSON.stringify(t.events)).not.toContain(out.secret);
  });

  it("carries spend to the new key so rotating cannot reset a budget, and suffixes the alias", async () => {
    const { t, made } = await withKey();
    await rotateKey(t.deps, SCOPE, ACTOR, made.key.id);
    const sent = t.client.generateKey.mock.calls.at(-1)![0] as Record<
      string,
      unknown
    >;
    expect(sent.spend).toBe(12.5);
    expect(sent.key_alias).toMatch(/-r2$/);
    expect(sent.max_budget).toBe(50);
    const rows = [...t.db.acmeLitellmKey.rows.values()];
    expect(rows.find((r) => r.id === made.key.id)!.status).toBe("ROTATED");
    expect(new Set(rows.map((r) => r.lineageId)).size).toBe(1);
  });

  it("if the revoke fails, removes the new key and reports failure: the old key is untouched", async () => {
    const { t, made } = await withKey();
    const oldToken = hashLitellmKey(made.secret);
    t.client.deleteKey.mockImplementationOnce(async () => {
      throw new LitellmHttpError("/key/delete", 500, "boom");
    });
    await expect(
      rotateKey(t.deps, SCOPE, ACTOR, made.key.id),
    ).rejects.toBeInstanceOf(LitellmRotationRolledBackError);
    expect([...t.keys.keys()]).toEqual([oldToken]);
    expect(
      [...t.db.acmeLitellmKey.rows.values()].find((r) => r.id === made.key.id)!
        .status,
    ).toBe("ACTIVE");
    expect(t.events.at(-1)).toMatchObject({
      action: "key.rotate",
      phase: "OUTCOME",
      outcome: "FAILURE",
    });
    expect(
      t.events.some(
        (e) => e.action === "key.rotate.compensate" && e.outcome === "SUCCESS",
      ),
    ).toBe(true);
  });

  it("if the revoke AND the compensation fail: PARTIAL, never success, no secret revealed", async () => {
    const { t, made } = await withKey();
    t.client.deleteKey.mockRejectedValue(
      new LitellmUnreachableError("/key/delete", "down"),
    );
    const err = await rotateKey(t.deps, SCOPE, ACTOR, made.key.id).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LitellmRotationPartialError);
    expect((err as Error).message).not.toMatch(/sk-/);
    expect(t.keys.size).toBe(2); // both live: this is exactly what must be surfaced
    const old = [...t.db.acmeLitellmKey.rows.values()].find(
      (r) => r.id === made.key.id,
    )!;
    expect(old.status).toBe("ROTATION_PARTIAL");
    expect(old.rotatedToKeyId).toBe(
      (err as LitellmRotationPartialError).newKeyId,
    );
    expect(t.events.at(-1)).toMatchObject({
      action: "key.rotate",
      phase: "OUTCOME",
      outcome: "PARTIAL",
    });
  });

  it("resolvePartialRotation removes the unrevealed new key and restores ACTIVE", async () => {
    const { t, made } = await withKey();
    t.client.deleteKey.mockRejectedValue(
      new LitellmUnreachableError("/key/delete", "down"),
    );
    await rotateKey(t.deps, SCOPE, ACTOR, made.key.id).catch(() => undefined);
    t.client.deleteKey.mockReset();
    t.client.deleteKey.mockImplementation(async (token: string) => {
      t.keys.delete(token);
    });
    await resolvePartialRotation(t.deps, SCOPE, ACTOR, made.key.id);
    expect([...t.keys.keys()]).toEqual([hashLitellmKey(made.secret)]);
    expect(
      [...t.db.acmeLitellmKey.rows.values()].find((r) => r.id === made.key.id)!
        .status,
    ).toBe("ACTIVE");
  });

  it("refuses to rotate a key that is not active", async () => {
    const { t, made } = await withKey();
    await revokeKey(t.deps, SCOPE, ACTOR, made.key.id);
    await expect(
      rotateKey(t.deps, SCOPE, ACTOR, made.key.id),
    ).rejects.toBeInstanceOf(LitellmInvalidStateError);
  });
});

describe("revokeKey", () => {
  it("treats a key already absent in LiteLLM as revoked, and says so in the record", async () => {
    const t = setup();
    const made = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "k",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.client.deleteKey.mockRejectedValueOnce(
      new LitellmHttpError("/key/delete", 404, "not found"),
    );
    await revokeKey(t.deps, SCOPE, ACTOR, made.key.id);
    expect(t.events.at(-1)!.after).toMatchObject({
      status: "REVOKED",
      alreadyAbsentInLitellm: true,
    });
  });

  it("when LiteLLM is unreachable: nothing changes and the failure is recorded", async () => {
    const t = setup();
    const made = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "k",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.client.deleteKey.mockRejectedValueOnce(
      new LitellmUnreachableError("/key/delete", "down"),
    );
    await expect(
      revokeKey(t.deps, SCOPE, ACTOR, made.key.id),
    ).rejects.toBeInstanceOf(LitellmUnreachableError);
    expect([...t.db.acmeLitellmKey.rows.values()][0]!.status).toBe("ACTIVE");
    expect(t.events.at(-1)!.outcome).toBe("FAILURE");
  });
});

describe("listing, drift and degradation", () => {
  it("detects drifted, missing and in-sync keys by cairo_key_id", async () => {
    const t = setup();
    const a = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "a",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    const b = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "b",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    const c = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "c",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.keys.get(hashLitellmKey(b.secret))!.max_budget = 999; // changed behind CAIRO's back
    t.keys.delete(hashLitellmKey(c.secret)); // deleted behind CAIRO's back
    const out = await listProjectKeys(t.deps, SCOPE);
    const drift = Object.fromEntries(
      out.keys.map((k) => [k.displayName, [k.drift, k.driftFields]]),
    );
    expect(drift).toEqual({
      a: ["in_sync", []],
      b: ["drifted", ["maxBudget"]],
      c: ["missing", []],
    });
    expect(a.key.id).toBeTruthy();
  });

  it("degrades to CAIRO's own rows when LiteLLM is unreachable", async () => {
    const t = setup();
    await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "a",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.client.listAllKeys.mockRejectedValueOnce(
      new LitellmUnreachableError("/key/list", "down"),
    );
    const out = await listProjectKeys(t.deps, SCOPE);
    expect(out.reachable).toBe(false);
    expect(out.keys).toHaveLength(1);
    expect(out.keys[0]!.drift).toBe("unknown");
  });

  it("unmanaged keys are the ones without cairo_managed, and expose no full hash", async () => {
    const t = setup();
    await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "a",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.keys.set("f".repeat(64), {
      token: "f".repeat(64),
      key_alias: "chat-widget",
      metadata: {},
    });
    const out = await listUnmanagedKeys(t.deps);
    expect(out.map((k) => k.alias)).toEqual(["chat-widget"]);
    expect(JSON.stringify(out)).not.toContain("f".repeat(64));
  });

  it("compareKeyWithLive ignores model order", () => {
    expect(
      compareKeyWithLive(
        {
          models: ["a", "b"],
          maxBudget: 1,
          rpmLimit: null,
          tpmLimit: null,
          litellmTeamId: null,
        },
        { token: "t", models: ["b", "a"], max_budget: 1 },
      ),
    ).toEqual([]);
  });
});

describe("getProjectSpend", () => {
  it("asks LiteLLM only about THIS project's keys and adds them up", async () => {
    const t = setup();
    const mine = await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "mine",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    await createKey(t.deps, { orgId: "org-1", projectId: "OTHER" }, ACTOR, {
      displayName: "theirs",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    t.client.dailyActivityForKey.mockImplementation(async () => ({
      results: [
        {
          date: "2026-09-19",
          metrics: {
            spend: 0,
            api_requests: 3,
            total_tokens: 120,
            successful_requests: 3,
          },
          breakdown: {
            model_groups: {
              "nvidia-nemotron": {
                metrics: { api_requests: 3, total_tokens: 120 },
              },
            },
          },
        },
      ],
    }));
    const out = await getProjectSpend(
      t.deps,
      SCOPE,
      "2026-09-01",
      "2026-09-19",
    );
    expect(t.client.dailyActivityForKey).toHaveBeenCalledTimes(1);
    expect(t.client.dailyActivityForKey.mock.calls[0]![0]).toBe(
      hashLitellmKey(mine.secret),
    );
    expect(out.data!.totals.requests).toBe(3);
    expect(out.data!.byModel).toEqual([
      expect.objectContaining({ model: "nvidia-nemotron", requests: 3 }),
    ]);
    expect(out.data!.byTeam[0]!.teamAlias).toBe("No team");
  });

  it("serves the last snapshot, marked stale, when LiteLLM is unreachable", async () => {
    const t = setup();
    await createKey(t.deps, SCOPE, ACTOR, {
      displayName: "mine",
      teamId: null,
      expiresInDays: null,
      ...LIMITS,
    });
    await getProjectSpend(t.deps, SCOPE, "2026-09-01", "2026-09-19");
    // age the snapshot past its max age, then take the gateway away
    [...t.db.acmeLitellmSpendSnapshot.rows.values()][0]!.fetchedAt = new Date(
      "2026-09-19T11:00:00Z",
    );
    t.client.dailyActivityForKey.mockRejectedValue(
      new LitellmUnreachableError("/user/daily/activity", "down"),
    );
    const out = await getProjectSpend(
      t.deps,
      SCOPE,
      "2026-09-01",
      "2026-09-19",
    );
    expect(out.stale).toBe(true);
    expect(out.fetchedAt).toBe("2026-09-19T11:00:00.000Z");
    expect(out.data).not.toBeNull();
  });
});
