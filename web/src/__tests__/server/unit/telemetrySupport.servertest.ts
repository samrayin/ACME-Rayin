import { describe, it, expect, vi } from "vitest";
import {
  createKeyAuthenticator,
  extractPresentedKey,
  hashKey,
  isKeyUsable,
  KEY_CACHE_TTL_MS,
  type KeyRecord,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryAuth";
import {
  createPolicyCache,
  resolveEffectivePolicy,
  type PolicyRow,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryPolicy";
import { createKeyedRateLimiter } from "@/src/features/acme-enhancements/server/telemetry/telemetryRateLimit";
import {
  STAMPED_KEYS,
  stampResourceSpans,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryStamp";
import {
  buildUpsertSql,
  createStatsRecorder,
  STAT_COLUMNS,
  UNATTRIBUTED,
  upsertParams,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryStats";
import {
  contentModesGateEnabled,
  DEFAULT_RATE_PER_KEY_PER_MIN,
  telemetryIngestEnabled,
  telemetryMaxBodyBytes,
  telemetryRatePerKeyPerMin,
  telemetryReaderDatabaseUrl,
  telemetryWriterDatabaseUrl,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryFlags";
import type { FilteredResourceSpans } from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";

// ---------------------------------------------------------------------- auth

const KEY = "synthetic-test-key-0001";
const KEY_HASH = hashKey(KEY);
const T0 = 1_790_000_000_000;

function keyRecord(overrides: Partial<KeyRecord> = {}): KeyRecord {
  return {
    id: "key-1",
    orgId: "org-1",
    projectId: "proj-1",
    lineageId: "lineage-1",
    displayName: "pilot-chat",
    tokenHash: KEY_HASH,
    status: "ACTIVE",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("extractPresentedKey", () => {
  it("reads Authorization: Bearer, any case of the scheme", () => {
    expect(extractPresentedKey({ authorization: `Bearer ${KEY}` })).toBe(KEY);
    expect(extractPresentedKey({ authorization: `bearer ${KEY}` })).toBe(KEY);
  });

  it("reads x-api-key", () => {
    expect(extractPresentedKey({ "x-api-key": KEY })).toBe(KEY);
  });

  it("prefers Authorization, falls through when it is not Bearer", () => {
    expect(
      extractPresentedKey({ authorization: "Bearer a", "x-api-key": "b" }),
    ).toBe("a");
    expect(
      extractPresentedKey({
        authorization: "Basic dXNlcjpwdw==",
        "x-api-key": "b",
      }),
    ).toBe("b");
  });

  it("refuses an empty, spaced, multi-token or oversized key", () => {
    expect(extractPresentedKey({})).toBeUndefined();
    expect(extractPresentedKey({ authorization: "Bearer " })).toBeUndefined();
    expect(
      extractPresentedKey({ authorization: "Bearer a b" }),
    ).toBeUndefined();
    expect(extractPresentedKey({ "x-api-key": "a b" })).toBeUndefined();
    expect(
      extractPresentedKey({ authorization: `Bearer ${"a".repeat(513)}` }),
    ).toBeUndefined();
  });
});

describe("createKeyAuthenticator", () => {
  function setup(record: KeyRecord | null, opts: { now?: () => number } = {}) {
    let nowMs = T0;
    const lookup = vi.fn(async (_hash: string) => record);
    const auth = createKeyAuthenticator({
      lookup,
      now: opts.now ?? (() => nowMs),
    });
    return {
      auth,
      lookup,
      advance: (ms: number) => {
        nowMs += ms;
      },
      setRecord: (r: KeyRecord | null) => {
        record = r;
      },
    };
  }
  const bearer = { authorization: `Bearer ${KEY}` };

  it("returns the owner taken from the key ROW", async () => {
    const { auth, lookup } = setup(keyRecord());
    await expect(auth.authenticate(bearer)).resolves.toEqual({
      keyId: "key-1",
      orgId: "org-1",
      projectId: "proj-1",
      lineageId: "lineage-1",
      displayName: "pilot-chat",
    });
    expect(lookup).toHaveBeenCalledWith(KEY_HASH);
  });

  it("looks the key up by its SHA-256, never by the key itself", async () => {
    const { auth, lookup } = setup(keyRecord());
    await auth.authenticate(bearer);
    for (const call of lookup.mock.calls) {
      expect(call[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(call[0]).not.toContain(KEY);
    }
  });

  it.each([
    ["no header", {}, keyRecord()],
    ["unknown key", bearer, null],
    ["revoked (revokedAt)", bearer, keyRecord({ revokedAt: new Date(T0 - 1) })],
    ["revoked (status)", bearer, keyRecord({ status: "REVOKED" })],
    ["rotated out", bearer, keyRecord({ status: "ROTATED" })],
    ["rotation partial", bearer, keyRecord({ status: "ROTATION_PARTIAL" })],
    ["never confirmed", bearer, keyRecord({ status: "PENDING" })],
    ["create failed", bearer, keyRecord({ status: "FAILED" })],
    ["expired", bearer, keyRecord({ expiresAt: new Date(T0 - 1000) })],
    ["row has no hash", bearer, keyRecord({ tokenHash: null })],
    ["row hash differs", bearer, keyRecord({ tokenHash: hashKey("another") })],
    ["malformed header", { authorization: "Bearer" }, keyRecord()],
  ])(
    "%s: null, with no way to tell the cases apart",
    async (_n, headers, rec) => {
      const { auth } = setup(rec as KeyRecord | null);
      await expect(auth.authenticate(headers as any)).resolves.toBeNull();
    },
  );

  it("a key that has not expired yet is accepted", async () => {
    const { auth } = setup(keyRecord({ expiresAt: new Date(T0 + 60_000) }));
    await expect(auth.authenticate(bearer)).resolves.not.toBeNull();
  });

  it("caches a found key, so a burst is one lookup", async () => {
    const { auth, lookup, advance } = setup(keyRecord());
    await auth.authenticate(bearer);
    advance(10_000);
    await auth.authenticate(bearer);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("a revoke shows within the 30 s cache lifetime (SEC-1)", async () => {
    const { auth, lookup, advance, setRecord } = setup(keyRecord());
    await expect(auth.authenticate(bearer)).resolves.not.toBeNull();
    setRecord(keyRecord({ status: "REVOKED", revokedAt: new Date(T0 + 1000) }));
    advance(KEY_CACHE_TTL_MS - 1);
    await expect(auth.authenticate(bearer)).resolves.not.toBeNull(); // still cached
    advance(2);
    await expect(auth.authenticate(bearer)).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("the cache lifetime can be lowered but never raised above 30 s", async () => {
    let nowMs = T0;
    const lookup = vi.fn(async () => keyRecord());
    const auth = createKeyAuthenticator({
      lookup,
      now: () => nowMs,
      ttlMs: 10 * 60_000,
    });
    await auth.authenticate(bearer);
    nowMs += KEY_CACHE_TTL_MS + 1;
    await auth.authenticate(bearer);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("expiry is checked on every request, even on a cache hit", async () => {
    const { auth, lookup, advance } = setup(
      keyRecord({ expiresAt: new Date(T0 + 5_000) }),
    );
    await expect(auth.authenticate(bearer)).resolves.not.toBeNull();
    advance(6_000);
    await expect(auth.authenticate(bearer)).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("remembers a miss only briefly, so a new key works within seconds", async () => {
    const { auth, lookup, advance, setRecord } = setup(null);
    await expect(auth.authenticate(bearer)).resolves.toBeNull();
    await auth.authenticate(bearer);
    expect(lookup).toHaveBeenCalledTimes(1);
    setRecord(keyRecord());
    advance(5_001);
    await expect(auth.authenticate(bearer)).resolves.not.toBeNull();
  });

  it("the cache is bounded: hostile random keys cannot grow it", async () => {
    let nowMs = T0;
    const lookup = vi.fn(async () => null);
    const auth = createKeyAuthenticator({
      lookup,
      now: () => nowMs,
      maxEntries: 3,
    });
    for (let n = 0; n < 10; n++) {
      await auth.authenticate({ authorization: `Bearer junk-${n}` });
    }
    lookup.mockClear();
    // The oldest are gone, so asking again is a fresh lookup.
    await auth.authenticate({ authorization: "Bearer junk-0" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("isKeyUsable agrees with the status values the console writes", () => {
    expect(isKeyUsable(keyRecord(), T0)).toBe(true);
    expect(isKeyUsable(keyRecord({ status: "REVOKED" }), T0)).toBe(false);
  });
});

// -------------------------------------------------------------------- policy

function policyRow(overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    projectId: "proj-1",
    enabled: true,
    contentMode: "metadata",
    userIdMode: "hash",
    attributeAllowlistExtra: [],
    retentionDays: null,
    version: 3,
    userHashSalt: "salt-1",
    ...overrides,
  };
}

describe("resolveEffectivePolicy", () => {
  it("no row is refused (the default for an unconfigured project is off)", () => {
    expect(resolveEffectivePolicy(null, false)).toBeNull();
  });

  it("enabled = false is refused", () => {
    expect(
      resolveEffectivePolicy(policyRow({ enabled: false }), false),
    ).toBeNull();
  });

  it("metadata is metadata, not downgraded", () => {
    const p = resolveEffectivePolicy(policyRow(), false)!;
    expect(p.contentMode).toBe("metadata");
    expect(p.downgraded).toBe(false);
    expect(p.version).toBe(3);
    expect(p.userHashSalt).toBe("salt-1");
  });

  it.each(["redacted", "full"] as const)(
    "%s is handled as metadata and counted, gate off",
    (mode) => {
      const p = resolveEffectivePolicy(
        policyRow({ contentMode: mode }),
        false,
      )!;
      expect(p.contentMode).toBe("metadata");
      expect(p.requestedContentMode).toBe(mode);
      expect(p.downgraded).toBe(true);
    },
  );

  it.each(["redacted", "full"] as const)(
    "%s stays metadata even with the gate on: no content mode is built in this change",
    (mode) => {
      const p = resolveEffectivePolicy(policyRow({ contentMode: mode }), true)!;
      expect(p.contentMode).toBe("metadata");
      expect(p.downgraded).toBe(true);
      expect(p.gateOpen).toBe(true);
    },
  );
});

describe("createPolicyCache", () => {
  it("caches for 30 s, then reloads", async () => {
    let nowMs = T0;
    const load = vi.fn(async () => policyRow());
    const cache = createPolicyCache({ load, now: () => nowMs });
    await cache.get("proj-1");
    nowMs += 29_000;
    await cache.get("proj-1");
    expect(load).toHaveBeenCalledTimes(1);
    nowMs += 2_000;
    await cache.get("proj-1");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("caches a missing row too", async () => {
    const load = vi.fn(async () => null);
    const cache = createPolicyCache({ load, now: () => T0 });
    await expect(cache.get("proj-x")).resolves.toBeNull();
    await cache.get("proj-x");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves a stale row up to 5 minutes when the table is unreachable, then fails closed", async () => {
    let nowMs = T0;
    let up = true;
    const load = vi.fn(async () => {
      if (!up) throw new Error("db down");
      return policyRow({ version: 7 });
    });
    const cache = createPolicyCache({ load, now: () => nowMs });
    await cache.get("proj-1");
    up = false;
    nowMs += 4 * 60_000;
    await expect(cache.get("proj-1")).resolves.toMatchObject({ version: 7 });
    nowMs += 2 * 60_000;
    await expect(cache.get("proj-1")).rejects.toThrow("db down");
  });

  it("an unreachable table with nothing cached fails closed at once", async () => {
    const cache = createPolicyCache({
      load: async () => {
        throw new Error("db down");
      },
      now: () => T0,
    });
    await expect(cache.get("proj-1")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- rate limit

describe("createKeyedRateLimiter", () => {
  it("allows the limit, then refuses with a Retry-After", () => {
    const limiter = createKeyedRateLimiter(600, 60_000);
    for (let n = 0; n < 600; n++) {
      expect(limiter.check("key-a", T0).allowed).toBe(true);
    }
    const over = limiter.check("key-a", T0 + 10_000);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSec).toBe(50);
  });

  it("opens a new window after a minute", () => {
    const limiter = createKeyedRateLimiter(1, 60_000);
    expect(limiter.check("k", T0).allowed).toBe(true);
    expect(limiter.check("k", T0 + 1).allowed).toBe(false);
    expect(limiter.check("k", T0 + 60_000).allowed).toBe(true);
  });

  it("one key's flood does not touch another key", () => {
    const limiter = createKeyedRateLimiter(2, 60_000);
    limiter.check("flooder", T0);
    limiter.check("flooder", T0);
    expect(limiter.check("flooder", T0).allowed).toBe(false);
    expect(limiter.check("quiet", T0).allowed).toBe(true);
  });

  it("is bounded in the number of keys it remembers", () => {
    const limiter = createKeyedRateLimiter(1, 60_000, 5);
    for (let n = 0; n < 50; n++) limiter.check(`k-${n}`, T0);
    // The earliest keys were forgotten, so they get a fresh allowance.
    expect(limiter.check("k-0", T0).allowed).toBe(true);
  });
});

// --------------------------------------------------------------------- stamp

describe("stampResourceSpans", () => {
  const filtered: FilteredResourceSpans[] = [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: "pilot" } }],
      },
      scopeSpans: [
        {
          scope: { name: "x" },
          spans: [
            {
              traceId: "a".repeat(32),
              spanId: "b".repeat(16),
              name: "chat",
              kind: 3,
              startTimeUnixNano: "1",
              attributes: [
                { key: "gen_ai.request.model", value: { stringValue: "m" } },
                // Defence in depth: the filter strips these, the stamp must too.
                { key: "eyeon.source", value: { stringValue: "attacker" } },
                { key: "eyeon.trust", value: { stringValue: "verified" } },
                {
                  key: "eyeon.user_hash",
                  value: { stringValue: "deadbeefdeadbeef" },
                },
              ],
              events: [],
              status: { code: 0 },
              userHash: "0123456789abcdef",
            },
          ],
        },
      ],
    },
  ];
  const ctx = {
    application: "pilot-chat",
    keyLineage: "lineage-1",
    contentMode: "metadata",
    policyVersion: 3,
    allowlistVersion: "2026-10-13.1",
    batchId: "batch-1",
    userIdMode: "hash" as const,
  };
  const attrsOf = (out: unknown[]) =>
    new Map(
      ((out as any)[0].scopeSpans[0].spans[0].attributes as any[]).map((a) => [
        a.key,
        a.value,
      ]),
    );

  it("writes every server label and overwrites what the app sent", () => {
    const a = attrsOf(stampResourceSpans(filtered, ctx));
    expect(a.get("eyeon.source")).toEqual({ stringValue: "app" });
    expect(a.get("eyeon.trust")).toEqual({ stringValue: "asserted" });
    expect(a.get("eyeon.application")).toEqual({ stringValue: "pilot-chat" });
    expect(a.get("eyeon.key_lineage")).toEqual({ stringValue: "lineage-1" });
    expect(a.get("eyeon.content_mode")).toEqual({ stringValue: "metadata" });
    expect(a.get("eyeon.policy_version")).toEqual({ intValue: "3" });
    expect(a.get("eyeon.allowlist_version")).toEqual({
      stringValue: "2026-10-13.1",
    });
    expect(a.get("eyeon.ingest_batch")).toEqual({ stringValue: "batch-1" });
    expect(a.get("eyeon.user_hash")).toEqual({
      stringValue: "0123456789abcdef",
    });
    expect(a.get("gen_ai.request.model")).toEqual({ stringValue: "m" });
  });

  it("each stamped key appears exactly once", () => {
    const out = stampResourceSpans(filtered, ctx) as any;
    const keys: string[] = out[0].scopeSpans[0].spans[0].attributes.map(
      (a: any) => a.key,
    );
    for (const k of STAMPED_KEYS) {
      expect(keys.filter((x) => x === k).length).toBeLessThanOrEqual(1);
    }
    expect(keys.filter((k) => k === "eyeon.source")).toHaveLength(1);
  });

  it("eyeon.user_hash only in hash mode", () => {
    for (const mode of ["drop", "pass"] as const) {
      const a = attrsOf(
        stampResourceSpans(filtered, { ...ctx, userIdMode: mode }),
      );
      expect(a.has("eyeon.user_hash")).toBe(false);
    }
  });

  it("no eyeon.user_hash when no id was sent", () => {
    const noUser = structuredClone(filtered);
    delete noUser[0].scopeSpans[0].spans[0].userHash;
    noUser[0].scopeSpans[0].spans[0].attributes =
      noUser[0].scopeSpans[0].spans[0].attributes.filter(
        (a) => a.key !== "eyeon.user_hash",
      );
    expect(
      attrsOf(stampResourceSpans(noUser, ctx)).has("eyeon.user_hash"),
    ).toBe(false);
  });

  it("the internal userHash field does not leave the stamp", () => {
    expect(JSON.stringify(stampResourceSpans(filtered, ctx))).not.toContain(
      '"userHash"',
    );
  });
});

// --------------------------------------------------------------------- stats

describe("createStatsRecorder", () => {
  it("accumulates per project, lineage and minute bucket", () => {
    let nowMs = T0;
    // No automatic flush here: this test is about accumulation only.
    const rec = createStatsRecorder({
      now: () => nowMs,
      write: async () => {},
      flushEveryMs: Number.MAX_SAFE_INTEGER,
    });
    rec.record("p", "l", { accepted: 1, spans_in: 3, attrs_dropped: 4 });
    rec.record("p", "l", { accepted: 1, spans_in: 2 });
    nowMs += 61_000;
    rec.record("p", "l", { accepted: 1 });
    const rows = rec.snapshot();
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.counters.spans_in === 5)!;
    expect(first.counters.accepted).toBe(2);
    expect(first.counters.attrs_dropped).toBe(4);
    expect(first.bucketStart.getTime() % 60_000).toBe(0);
  });

  it("files an unauthenticated request under the sentinel, not a project", () => {
    const rec = createStatsRecorder({ now: () => T0, write: async () => {} });
    rec.record(null, null, { rejected_auth: 1 });
    const [row] = rec.snapshot();
    expect(row.projectId).toBe(UNATTRIBUTED);
    expect(row.lineageId).toBe(UNATTRIBUTED);
    expect(row.counters.rejected_auth).toBe(1);
  });

  it("ignores negative, fractional and non-finite increments safely", () => {
    const rec = createStatsRecorder({ now: () => T0, write: async () => {} });
    rec.record("p", "l", {
      accepted: -5,
      spans_in: Number.NaN,
      spans_out: 2.9,
    });
    const [row] = rec.snapshot();
    expect(row.counters.accepted).toBe(0);
    expect(row.counters.spans_in).toBe(0);
    expect(row.counters.spans_out).toBe(2);
  });

  it("flush hands the rows to the writer and clears them", async () => {
    const write = vi.fn(async () => {});
    const rec = createStatsRecorder({ now: () => T0, write });
    rec.record("p", "l", { accepted: 1 });
    await rec.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(rec.snapshot()).toHaveLength(0);
  });

  it("a failed write is dropped and reports the error NAME only", async () => {
    const onWriteError = vi.fn();
    const rec = createStatsRecorder({
      now: () => T0,
      write: async () => {
        throw new TypeError(
          // Assembled, so no connection-string-with-password literal sits in source.
          ["connection string postgres:", "//user:", "SECRET", "@host/db"].join(
            "",
          ),
        );
      },
      onWriteError,
    });
    rec.record("p", "l", { accepted: 1 });
    await rec.flush();
    expect(onWriteError).toHaveBeenCalledWith("TypeError");
    expect(JSON.stringify(onWriteError.mock.calls)).not.toContain("SECRET");
  });
});

describe("the counters upsert", () => {
  it("names every column in the list and in the update, and only those", () => {
    const sql = buildUpsertSql();
    for (const c of STAT_COLUMNS) {
      // column list, SET target, stored value, EXCLUDED value
      expect(sql.split(`"${c}"`).length - 1).toBe(4);
    }
  });

  it("binds every value: placeholders match the parameters", () => {
    const sql = buildUpsertSql();
    const params = upsertParams({
      projectId: "p",
      lineageId: "l",
      bucketStart: new Date(T0),
      counters: Object.fromEntries(STAT_COLUMNS.map((c) => [c, 1])) as any,
      lastReceivedAt: new Date(T0),
    });
    const highest = Math.max(
      ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
    );
    expect(params).toHaveLength(highest);
    expect(sql).not.toMatch(/'/); // no literal value in the statement
  });
});

// --------------------------------------------------------------------- flags

describe("flags", () => {
  it("ingest is off unless exactly 'true'", () => {
    expect(telemetryIngestEnabled({})).toBe(false);
    for (const v of ["TRUE", "1", "yes", "True", ""]) {
      expect(
        telemetryIngestEnabled({ EYEON_TELEMETRY_INGEST_ENABLED: v }),
      ).toBe(false);
    }
    expect(
      telemetryIngestEnabled({ EYEON_TELEMETRY_INGEST_ENABLED: "true" }),
    ).toBe(true);
  });

  it("the content-mode gate is off unless exactly 'true'", () => {
    expect(contentModesGateEnabled({})).toBe(false);
    expect(
      contentModesGateEnabled({
        EYEON_TELEMETRY_CONTENT_MODES_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it("the body limit may only be lowered", () => {
    const upstream = 512 * 1024 * 1024;
    expect(telemetryMaxBodyBytes(upstream, {})).toBe(upstream);
    expect(
      telemetryMaxBodyBytes(upstream, {
        EYEON_TELEMETRY_MAX_BODY_BYTES: "4194304",
      }),
    ).toBe(4194304);
    expect(
      telemetryMaxBodyBytes(upstream, {
        EYEON_TELEMETRY_MAX_BODY_BYTES: String(upstream * 4),
      }),
    ).toBe(upstream);
    for (const bad of ["0", "-1", "abc", "1e9", ""]) {
      expect(
        telemetryMaxBodyBytes(upstream, {
          EYEON_TELEMETRY_MAX_BODY_BYTES: bad,
        }),
      ).toBe(upstream);
    }
  });

  it("the rate defaults to 600 and rejects nonsense", () => {
    expect(telemetryRatePerKeyPerMin({})).toBe(DEFAULT_RATE_PER_KEY_PER_MIN);
    expect(DEFAULT_RATE_PER_KEY_PER_MIN).toBe(600);
    expect(
      telemetryRatePerKeyPerMin({ EYEON_TELEMETRY_RATE_PER_KEY_PER_MIN: "30" }),
    ).toBe(30);
    for (const bad of ["0", "-5", "x", ""]) {
      expect(
        telemetryRatePerKeyPerMin({
          EYEON_TELEMETRY_RATE_PER_KEY_PER_MIN: bad,
        }),
      ).toBe(600);
    }
  });

  it("the writer connection string is undefined when unset", () => {
    expect(telemetryWriterDatabaseUrl({})).toBeUndefined();
    expect(
      telemetryWriterDatabaseUrl({ RAYIN_TELEMETRY_WRITER_DATABASE_URL: "" }),
    ).toBeUndefined();
  });

  it("the reader connection string is undefined when unset, and is read from its own setting only", () => {
    expect(telemetryReaderDatabaseUrl({})).toBeUndefined();
    expect(
      telemetryReaderDatabaseUrl({ RAYIN_TELEMETRY_READER_DATABASE_URL: "" }),
    ).toBeUndefined();
    // A writer string must never stand in for the reader, or the reverse.
    expect(
      telemetryReaderDatabaseUrl({
        RAYIN_TELEMETRY_WRITER_DATABASE_URL: "x://w",
      }),
    ).toBeUndefined();
    expect(
      telemetryWriterDatabaseUrl({
        RAYIN_TELEMETRY_READER_DATABASE_URL: "x://r",
      }),
    ).toBeUndefined();
    expect(
      telemetryReaderDatabaseUrl({
        RAYIN_TELEMETRY_READER_DATABASE_URL: "x://r",
      }),
    ).toBe("x://r");
  });
});
