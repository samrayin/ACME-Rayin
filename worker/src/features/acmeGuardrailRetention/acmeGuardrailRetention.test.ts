import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  ArchiveVerificationError,
  buildArchivePath,
  computeCutoff,
  runRetention,
  serializeBatch,
  type RetentionCursor,
  type RetentionDeps,
  type RetentionRow,
  type RetentionRunOptions,
} from "./runRetention";
import {
  normalizeArchivePrefix,
  resolveRetentionConfig,
  type RetentionEnvInput,
} from "./retentionConfig";

// ACME: unit tests for the acme_guardrail_events retention job. No database,
// no storage account: the job's side effects are injected fakes.

const NOW = new Date("2026-09-18T02:30:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function row(
  id: string,
  eventTime: Date,
  extra: Record<string, unknown> = {},
): RetentionRow {
  return {
    id,
    eventTime,
    projectId: "p1",
    agentId: "agent",
    action: "BLOCK",
    rawContentEncrypted: "iv:tag:CIPHERTEXT",
    ...extra,
  };
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

/** In-memory table + archive that honour the RetentionDeps contract. */
function fakeWorld(rows: RetentionRow[]) {
  const table = [...rows];
  const archive = new Map<string, Buffer>();
  const calls: string[] = [];
  const deps = {
    selectBatch: vi.fn(
      async (p: {
        cutoff: Date;
        after: RetentionCursor | null;
        limit: number;
      }): Promise<RetentionRow[]> => {
        calls.push("select");
        const after = p.after;
        return table
          .filter((r) => r.eventTime < p.cutoff)
          .filter(
            (r) =>
              !after ||
              r.eventTime > after.eventTime ||
              (r.eventTime.getTime() === after.eventTime.getTime() &&
                r.id > after.id),
          )
          .sort(
            (a, b) =>
              a.eventTime.getTime() - b.eventTime.getTime() ||
              (a.id < b.id ? -1 : 1),
          )
          .slice(0, p.limit);
      },
    ),
    uploadArchive: vi.fn(async (path: string, body: Buffer): Promise<void> => {
      calls.push("upload");
      archive.set(path, Buffer.from(body));
    }),
    readArchive: vi.fn(async (path: string): Promise<Uint8Array> => {
      calls.push("read");
      const b = archive.get(path);
      if (!b) throw new Error("not found");
      return new Uint8Array(b);
    }),
    deleteRows: vi.fn(
      async (p: { ids: string[]; cutoff: Date }): Promise<number> => {
        calls.push("delete");
        let n = 0;
        for (const id of p.ids) {
          const i = table.findIndex(
            (r) => r.id === id && r.eventTime < p.cutoff,
          );
          if (i >= 0) {
            table.splice(i, 1);
            n++;
          }
        }
        return n;
      },
    ),
    log: { info: vi.fn(), warn: vi.fn() },
  } satisfies RetentionDeps;
  return { deps, table, archive, calls };
}

const baseOpts: RetentionRunOptions = {
  retentionDays: 30,
  batchSize: 2,
  maxBatchesPerRun: 100,
  dryRun: false,
  archivePrefix: "guardrail-events/",
  now: NOW,
};

function archivedIds(archive: Map<string, Buffer>): string[][] {
  return [...archive.values()].map((b) =>
    gunzipSync(b)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).id as string),
  );
}

describe("computeCutoff", () => {
  it("is exactly retentionDays before now", () => {
    expect(computeCutoff(NOW, 30).getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(computeCutoff(NOW, 7).toISOString()).toBe(
      "2026-09-11T02:30:00.000Z",
    );
  });

  it("rejects non-integer or < 1 day values", () => {
    expect(() => computeCutoff(NOW, 0)).toThrow();
    expect(() => computeCutoff(NOW, -5)).toThrow();
    expect(() => computeCutoff(NOW, 1.5)).toThrow();
    expect(() => computeCutoff(NOW, Number.NaN)).toThrow();
  });
});

describe("buildArchivePath / normalizeArchivePrefix", () => {
  it("partitions by run date (UTC) under the prefix", () => {
    expect(buildArchivePath("guardrail-events/", NOW, 3)).toBe(
      "guardrail-events/2026/09/18/guardrail-events-20260918T023000000Z-b0003.jsonl.gz",
    );
  });

  it("normalises prefixes", () => {
    expect(normalizeArchivePrefix("guardrail-events")).toBe(
      "guardrail-events/",
    );
    expect(normalizeArchivePrefix("/a/b/")).toBe("a/b/");
    expect(normalizeArchivePrefix("  ")).toBe("");
  });
});

describe("serializeBatch", () => {
  it("writes every column as gzipped JSONL and leaves ciphertext untouched", () => {
    const rows = [
      row("a", new Date("2026-08-01T00:00:00Z"), {
        piiFindings: [{ entity_type: "EMAIL" }],
        redactedText: null,
      }),
    ];
    const lines = gunzipSync(serializeBatch(rows))
      .toString("utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      id: "a",
      eventTime: "2026-08-01T00:00:00.000Z",
      projectId: "p1",
      agentId: "agent",
      action: "BLOCK",
      rawContentEncrypted: "iv:tag:CIPHERTEXT",
      piiFindings: [{ entity_type: "EMAIL" }],
      redactedText: null,
    });
  });
});

describe("runRetention: batch selection and cutoff", () => {
  it("only touches rows older than the cutoff, in bounded (event_time, id)-ordered batches", async () => {
    const { deps, table, archive } = fakeWorld([
      row("c", daysAgo(40)),
      row("a", daysAgo(45)),
      row("e", daysAgo(31)),
      row("b", daysAgo(45)), // same event_time as "a": id breaks the tie
      row("young1", daysAgo(29)),
      row("exactly-at-cutoff", daysAgo(30)), // not strictly older: kept
      row("young2", daysAgo(1)),
    ]);

    const summary = await runRetention(deps, baseOpts);

    expect(summary).toMatchObject({
      dryRun: false,
      cutoff: daysAgo(30).toISOString(),
      batches: 2,
      selected: 4,
      archived: 4,
      deleted: 4,
      hitBatchLimit: false,
    });
    expect(table.map((r) => r.id).sort()).toEqual([
      "exactly-at-cutoff",
      "young1",
      "young2",
    ]);
    expect(archivedIds(archive)).toEqual([
      ["a", "b"],
      ["c", "e"],
    ]);
    for (const [p] of deps.selectBatch.mock.calls) {
      expect(p.limit).toBe(2);
      expect(p.cutoff.toISOString()).toBe(summary.cutoff);
    }
    // Delete is always bounded by the same cutoff too.
    for (const [p] of deps.deleteRows.mock.calls) {
      expect(p.cutoff.toISOString()).toBe(summary.cutoff);
    }
  });

  it("uses the configured retention period, not a fixed 30", async () => {
    const { deps, table } = fakeWorld([
      row("old", daysAgo(100)),
      row("mid", daysAgo(60)),
    ]);
    const summary = await runRetention(deps, {
      ...baseOpts,
      retentionDays: 90,
    });
    expect(summary.deleted).toBe(1);
    expect(table.map((r) => r.id)).toEqual(["mid"]);
  });

  it("stops at maxBatchesPerRun and reports it", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(`r${i}`, daysAgo(40 + i)),
    );
    const { deps, table } = fakeWorld(rows);
    const summary = await runRetention(deps, {
      ...baseOpts,
      maxBatchesPerRun: 2,
    });
    expect(summary.batches).toBe(2);
    expect(summary.deleted).toBe(4);
    expect(summary.hitBatchLimit).toBe(true);
    expect(table).toHaveLength(6);
  });

  it("does nothing when no rows are past the cutoff", async () => {
    const { deps } = fakeWorld([row("young", daysAgo(2))]);
    const summary = await runRetention(deps, baseOpts);
    expect(summary).toMatchObject({ batches: 0, selected: 0, deleted: 0 });
    expect(deps.uploadArchive).not.toHaveBeenCalled();
    expect(deps.deleteRows).not.toHaveBeenCalled();
  });

  it("aborts without archiving or deleting if a selected row is not past the cutoff", async () => {
    const { deps } = fakeWorld([]);
    deps.selectBatch.mockResolvedValueOnce([row("new", NOW)]);
    await expect(runRetention(deps, baseOpts)).rejects.toThrow(/cutoff/);
    expect(deps.uploadArchive).not.toHaveBeenCalled();
    expect(deps.deleteRows).not.toHaveBeenCalled();
  });
});

describe("runRetention: no delete unless the upload is verified", () => {
  const oldRows = () => [row("a", daysAgo(40)), row("b", daysAgo(41))];

  it("deletes only after upload and read-back, for exactly the archived ids", async () => {
    const { deps, calls } = fakeWorld(oldRows());
    await runRetention(deps, baseOpts);
    expect(calls).toEqual(["select", "upload", "read", "delete", "select"]);
    expect(deps.deleteRows.mock.calls[0][0].ids).toEqual(["b", "a"]);
  });

  it("does not delete when the upload throws", async () => {
    const { deps, table } = fakeWorld(oldRows());
    deps.uploadArchive.mockRejectedValueOnce(new Error("storage down"));
    await expect(runRetention(deps, baseOpts)).rejects.toThrow("storage down");
    expect(deps.deleteRows).not.toHaveBeenCalled();
    expect(table).toHaveLength(2);
  });

  it("does not delete when the read-back fails", async () => {
    const { deps, table } = fakeWorld(oldRows());
    deps.readArchive.mockRejectedValueOnce(new Error("404"));
    await expect(runRetention(deps, baseOpts)).rejects.toThrow("404");
    expect(deps.deleteRows).not.toHaveBeenCalled();
    expect(table).toHaveLength(2);
  });

  it("does not delete when the read-back size differs", async () => {
    const { deps, table } = fakeWorld(oldRows());
    deps.readArchive.mockResolvedValueOnce(new Uint8Array(3));
    await expect(runRetention(deps, baseOpts)).rejects.toBeInstanceOf(
      ArchiveVerificationError,
    );
    expect(deps.deleteRows).not.toHaveBeenCalled();
    expect(table).toHaveLength(2);
  });

  it("does not delete when the read-back checksum differs (same size, one byte flipped)", async () => {
    const { deps, archive, table } = fakeWorld(oldRows());
    deps.readArchive.mockImplementationOnce(async (path: string) => {
      const copy = new Uint8Array(archive.get(path)!);
      copy[copy.length - 1] ^= 0xff;
      return copy;
    });
    await expect(runRetention(deps, baseOpts)).rejects.toBeInstanceOf(
      ArchiveVerificationError,
    );
    expect(deps.deleteRows).not.toHaveBeenCalled();
    expect(table).toHaveLength(2);
  });

  it("keeps earlier verified batches deleted but stops before the failing batch's delete", async () => {
    const rows = [0, 1, 2, 3].map((i) => row(`r${i}`, daysAgo(50 - i)));
    const { deps, archive, table } = fakeWorld(rows);
    deps.readArchive
      .mockImplementationOnce(async (p: string) => new Uint8Array(archive.get(p)!))
      .mockImplementationOnce(async () => new Uint8Array(1));
    await expect(runRetention(deps, baseOpts)).rejects.toBeInstanceOf(
      ArchiveVerificationError,
    );
    expect(deps.deleteRows).toHaveBeenCalledTimes(1);
    expect(table.map((r) => r.id)).toEqual(["r2", "r3"]);
  });
});

describe("runRetention: dry run", () => {
  it("reports what would be archived and deleted but writes and deletes nothing", async () => {
    const rows = [0, 1, 2, 3, 4].map((i) => row(`r${i}`, daysAgo(40 + i)));
    const { deps, table } = fakeWorld(rows);
    const summary = await runRetention(deps, { ...baseOpts, dryRun: true });
    expect(summary).toMatchObject({
      dryRun: true,
      selected: 5,
      batches: 3,
      archived: 0,
      deleted: 0,
    });
    expect(summary.archivePaths).toHaveLength(3);
    expect(deps.uploadArchive).not.toHaveBeenCalled();
    expect(deps.readArchive).not.toHaveBeenCalled();
    expect(deps.deleteRows).not.toHaveBeenCalled();
    expect(table).toHaveLength(5);
  });
});

describe("resolveRetentionConfig: disabled unless configured", () => {
  const full: RetentionEnvInput = {
    DATABASE_URL: "postgresql://app@db/langfuse",
    RAYIN_RETENTION_PURGER_DATABASE_URL: "postgresql://purger@db/langfuse",
    ACME_GUARDRAIL_RETENTION_DAYS: 30,
    ACME_GUARDRAIL_RETENTION_BATCH_SIZE: 1000,
    ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN: 100,
    ACME_GUARDRAIL_RETENTION_DRY_RUN: "false",
    ACME_GUARDRAIL_ARCHIVE_BUCKET: "guardrail-archive",
    ACME_GUARDRAIL_ARCHIVE_PREFIX: "guardrail-events/",
  };

  it("is enabled when both the purger URL and archive bucket are set", () => {
    const c = resolveRetentionConfig(full);
    expect(c).toEqual({
      enabled: true,
      purgerDatabaseUrl: full.RAYIN_RETENTION_PURGER_DATABASE_URL,
      archiveBucket: "guardrail-archive",
      settings: {
        retentionDays: 30,
        batchSize: 1000,
        maxBatchesPerRun: 100,
        dryRun: false,
        archivePrefix: "guardrail-events/",
      },
    });
  });

  it("is disabled without the purger URL (never falls back to DATABASE_URL)", () => {
    const c = resolveRetentionConfig({
      ...full,
      RAYIN_RETENTION_PURGER_DATABASE_URL: undefined,
    });
    expect(c).toEqual({
      enabled: false,
      reasons: [expect.stringContaining("RAYIN_RETENTION_PURGER_DATABASE_URL")],
    });
  });

  it("is disabled without an archive bucket", () => {
    const c = resolveRetentionConfig({
      ...full,
      ACME_GUARDRAIL_ARCHIVE_BUCKET: " ",
    });
    expect(c).toEqual({
      enabled: false,
      reasons: [expect.stringContaining("ACME_GUARDRAIL_ARCHIVE_BUCKET")],
    });
  });

  it("is disabled when neither is set", () => {
    const c = resolveRetentionConfig({
      ...full,
      RAYIN_RETENTION_PURGER_DATABASE_URL: undefined,
      ACME_GUARDRAIL_ARCHIVE_BUCKET: undefined,
    });
    expect(c.enabled).toBe(false);
    expect(c.enabled === false && c.reasons).toHaveLength(2);
  });

  it("is disabled when the purger URL is just the general DATABASE_URL", () => {
    const c = resolveRetentionConfig({
      ...full,
      RAYIN_RETENTION_PURGER_DATABASE_URL: full.DATABASE_URL,
    });
    expect(c.enabled).toBe(false);
  });

  it("is disabled on an invalid retention period instead of guessing one", () => {
    expect(
      resolveRetentionConfig({ ...full, ACME_GUARDRAIL_RETENTION_DAYS: 0 })
        .enabled,
    ).toBe(false);
    expect(
      resolveRetentionConfig({
        ...full,
        ACME_GUARDRAIL_RETENTION_DAYS: undefined as unknown as number,
      }).enabled,
    ).toBe(false);
  });

  it("reads the retention period from config, not a literal", () => {
    const c = resolveRetentionConfig({
      ...full,
      ACME_GUARDRAIL_RETENTION_DAYS: 90,
    });
    expect(c.enabled && c.settings.retentionDays).toBe(90);
  });

  it("treats anything but an explicit 'false' as a dry run", () => {
    const c = resolveRetentionConfig({
      ...full,
      ACME_GUARDRAIL_RETENTION_DRY_RUN: "true",
    });
    expect(c.enabled && c.settings.dryRun).toBe(true);
    const d = resolveRetentionConfig({
      ...full,
      ACME_GUARDRAIL_RETENTION_DRY_RUN: undefined as unknown as "true",
    });
    expect(d.enabled && d.settings.dryRun).toBe(true);
  });
});
