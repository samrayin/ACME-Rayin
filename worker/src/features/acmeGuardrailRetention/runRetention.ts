/**
 * ACME addition: core of the nightly acme_guardrail_events retention job
 * (POSTGRES-COMPLIANCE-FRAMEWORK.md §1.3). Every side effect -- reading
 * rows, writing/reading the archive, deleting rows -- is injected through
 * `RetentionDeps`, so the ordering guarantees below are unit-tested without a
 * database or a storage account.
 *
 * Per batch, strictly in this order:
 *   1. select up to `batchSize` rows with event_time < cutoff, ordered by
 *      (event_time, id), keyset-paginated after the previous batch;
 *   2. serialise ALL columns as JSONL and gzip it (raw_content_encrypted is
 *      written as-is: ciphertext stays ciphertext);
 *   3. upload to <prefix>YYYY/MM/DD/<run>-bNNNN.jsonl.gz;
 *   4. read the object back and compare byte length + SHA-256;
 *   5. ONLY if 4 matched, delete exactly those row ids (still guarded by
 *      event_time < cutoff).
 * Any failure in 1-4 aborts the run before its delete; rows stay in Postgres
 * and the next nightly run retries them. Dry-run stops after 1.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RetentionRow = {
  id: string;
  eventTime: Date;
  [column: string]: unknown;
};

export type RetentionCursor = { eventTime: Date; id: string };

export type RetentionDeps = {
  selectBatch(params: {
    cutoff: Date;
    after: RetentionCursor | null;
    limit: number;
  }): Promise<RetentionRow[]>;
  uploadArchive(path: string, body: Buffer): Promise<void>;
  readArchive(path: string): Promise<Uint8Array>;
  deleteRows(params: { ids: string[]; cutoff: Date }): Promise<number>;
  log: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
  };
};

export type RetentionRunOptions = {
  retentionDays: number;
  batchSize: number;
  maxBatchesPerRun: number;
  dryRun: boolean;
  archivePrefix: string;
  now: Date;
};

export type RetentionRunSummary = {
  dryRun: boolean;
  cutoff: string;
  batches: number;
  selected: number;
  archived: number;
  deleted: number;
  archivePaths: string[];
  // true when the run stopped at maxBatchesPerRun with rows possibly left.
  hitBatchLimit: boolean;
};

export class ArchiveVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveVerificationError";
  }
}

/**
 * Rows with event_time strictly before this instant are eligible. Exact
 * millisecond arithmetic from `now` (not calendar-day truncation), so a
 * row is never purged before it is a full `retentionDays` old.
 */
export function computeCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error(
      `retentionDays must be an integer >= 1, got ${String(retentionDays)}`,
    );
  }
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * <prefix>YYYY/MM/DD/guardrail-events-<runStamp>-b<NNNN>.jsonl.gz, dated by
 * the run (UTC). Each object's rows are self-describing (event_time is in
 * every line), so the run date is only a partition for lifecycle policies.
 */
export function buildArchivePath(
  prefix: string,
  runAt: Date,
  batchIndex: number,
): string {
  const yyyy = pad(runAt.getUTCFullYear(), 4);
  const mm = pad(runAt.getUTCMonth() + 1, 2);
  const dd = pad(runAt.getUTCDate(), 2);
  const stamp = runAt.toISOString().replace(/[-:.]/g, "");
  return `${prefix}${yyyy}/${mm}/${dd}/guardrail-events-${stamp}-b${pad(batchIndex, 4)}.jsonl.gz`;
}

/** One JSON object per line, every column; Dates as ISO-8601 strings. */
export function serializeBatch(rows: RetentionRow[]): Buffer {
  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  return gzipSync(Buffer.from(jsonl, "utf8"));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runRetention(
  deps: RetentionDeps,
  opts: RetentionRunOptions,
): Promise<RetentionRunSummary> {
  const cutoff = computeCutoff(opts.now, opts.retentionDays);
  const summary: RetentionRunSummary = {
    dryRun: opts.dryRun,
    cutoff: cutoff.toISOString(),
    batches: 0,
    selected: 0,
    archived: 0,
    deleted: 0,
    archivePaths: [],
    hitBatchLimit: false,
  };

  let after: RetentionCursor | null = null;

  for (let batchIndex = 0; batchIndex < opts.maxBatchesPerRun; batchIndex++) {
    const rows = await deps.selectBatch({
      cutoff,
      after,
      limit: opts.batchSize,
    });
    if (rows.length === 0) break;

    // Defensive: never act on a row the query should not have returned.
    const tooNew = rows.find((r) => !(r.eventTime < cutoff));
    if (tooNew) {
      throw new Error(
        `selectBatch returned row ${tooNew.id} at or after the cutoff -- aborting before any archive or delete`,
      );
    }

    summary.batches++;
    summary.selected += rows.length;
    const last = rows[rows.length - 1];
    after = { eventTime: last.eventTime, id: last.id };
    const path = buildArchivePath(opts.archivePrefix, opts.now, batchIndex);
    const ids = rows.map((r) => r.id);

    if (opts.dryRun) {
      summary.archivePaths.push(path);
      deps.log.info("[AcmeGuardrailRetention] DRY RUN: would archive and delete batch", {
        batchIndex,
        rows: rows.length,
        path,
        firstEventTime: rows[0].eventTime.toISOString(),
        lastEventTime: last.eventTime.toISOString(),
      });
    } else {
      const body = serializeBatch(rows);
      const expectedSha = sha256Hex(body);

      await deps.uploadArchive(path, body);

      const readBack = await deps.readArchive(path);
      const actualSha = sha256Hex(readBack);
      if (readBack.byteLength !== body.byteLength || actualSha !== expectedSha) {
        throw new ArchiveVerificationError(
          `Archive verification failed for ${path}: expected ${body.byteLength} bytes / sha256 ${expectedSha}, ` +
            `read back ${readBack.byteLength} bytes / sha256 ${actualSha}. No rows deleted for this batch.`,
        );
      }
      summary.archived += rows.length;
      summary.archivePaths.push(path);

      const deleted = await deps.deleteRows({ ids, cutoff });
      summary.deleted += deleted;
      if (deleted !== ids.length) {
        // Fewer is possible (e.g. a row removed between select and delete);
        // more is impossible (DELETE is bounded by these ids). Either way the
        // archive already holds every selected row.
        deps.log.warn("[AcmeGuardrailRetention] Deleted count differs from archived count", {
          batchIndex,
          path,
          archived: ids.length,
          deleted,
        });
      }
      deps.log.info("[AcmeGuardrailRetention] Batch archived, verified and deleted", {
        batchIndex,
        path,
        rows: rows.length,
        deleted,
        bytes: body.byteLength,
        sha256: expectedSha,
      });
    }

    if (rows.length < opts.batchSize) break;
    if (batchIndex === opts.maxBatchesPerRun - 1) {
      summary.hitBatchLimit = true;
    }
  }

  return summary;
}
