/**
 * ACME addition (EYEON telemetry ingest, LLD section 6): minute-bucket counters.
 *
 * Counts only. No key, no value, no id beyond the project and the key lineage.
 * Counters are collected in memory and written in batches by a dedicated
 * least-privilege role (rayin_telemetry_writer: INSERT and UPDATE on the stats
 * table, nothing else). If that role's connection string is not configured the
 * counters stay in memory: there is no fallback to the general connection.
 *
 * Failure here never affects a request: a failed write is dropped and the only
 * thing logged is the error's name.
 */

export const STAT_COLUMNS = [
  "accepted",
  "spans_in",
  "spans_out",
  "attrs_dropped",
  "dropped_not_allowlisted",
  "dropped_reserved",
  "dropped_cost",
  "dropped_content",
  "dropped_bad_value",
  "dropped_user_id",
  "dropped_spans",
  "dropped_events",
  "dropped_links",
  "names_normalised",
  "rejected_malformed",
  "rejected_filter",
  // The engine refused the ingest's OWN filtered output. A server-side fault,
  // kept apart from rejected_malformed, which means the caller sent bad input.
  "rejected_handoff",
  "rejected_auth",
  "rejected_disabled",
  "rejected_size",
  "rejected_type",
  "rejected_rate",
  "rejected_engine",
  "policy_downgraded",
] as const;

export type StatColumn = (typeof STAT_COLUMNS)[number];
export type StatsDelta = Partial<Record<StatColumn, number>>;

/** Used for requests that never reached a project (auth failures). */
export const UNATTRIBUTED = "-";

export type StatsRow = {
  projectId: string;
  lineageId: string;
  bucketStart: Date;
  counters: Record<StatColumn, number>;
  lastReceivedAt: Date;
};

function zero(): Record<StatColumn, number> {
  const out = {} as Record<StatColumn, number>;
  for (const c of STAT_COLUMNS) out[c] = 0;
  return out;
}

export type StatsRecorderDeps = {
  now: () => number;
  write: (rows: StatsRow[]) => Promise<void>;
  /** A flush is attempted at most this often, from the next record() call. */
  flushEveryMs?: number;
  onWriteError?: (errorName: string) => void;
};

export function createStatsRecorder(deps: StatsRecorderDeps) {
  const every = deps.flushEveryMs ?? 10_000;
  let pending = new Map<string, StatsRow>();
  let lastFlush = deps.now();
  let flushing = false;

  async function flush(): Promise<void> {
    if (flushing || pending.size === 0) return;
    flushing = true;
    const rows = [...pending.values()];
    pending = new Map();
    lastFlush = deps.now();
    try {
      await deps.write(rows);
    } catch (error) {
      deps.onWriteError?.(error instanceof Error ? error.name : "Error");
    } finally {
      flushing = false;
    }
  }

  return {
    record(
      projectId: string | null,
      lineageId: string | null,
      delta: StatsDelta,
    ): void {
      const nowMs = deps.now();
      const bucket = new Date(Math.floor(nowMs / 60_000) * 60_000);
      const project = projectId ?? UNATTRIBUTED;
      const lineage = lineageId ?? UNATTRIBUTED;
      const id = `${project}|${lineage}|${bucket.getTime()}`;
      let row = pending.get(id);
      if (row === undefined) {
        row = {
          projectId: project,
          lineageId: lineage,
          bucketStart: bucket,
          counters: zero(),
          lastReceivedAt: new Date(nowMs),
        };
        pending.set(id, row);
      }
      for (const c of STAT_COLUMNS) {
        const v = delta[c];
        if (v !== undefined && Number.isFinite(v) && v > 0) {
          row.counters[c] += Math.floor(v);
        }
      }
      row.lastReceivedAt = new Date(nowMs);
      // flush() handles its own write errors; the catch only satisfies the
      // no-floating-promises rule for a call that is deliberately not awaited.
      if (nowMs - lastFlush >= every) flush().catch(() => undefined);
    },
    flush,
    /** For tests and the health view: what is waiting to be written. */
    snapshot(): StatsRow[] {
      return [...pending.values()];
    },
  };
}

/**
 * The upsert. Column names come from the closed STAT_COLUMNS list above and
 * every value is a bound parameter.
 */
export function buildUpsertSql(): string {
  const cols = STAT_COLUMNS.map((c) => `"${c}"`);
  const params = STAT_COLUMNS.map((_, i) => `$${i + 4}`);
  const updates = STAT_COLUMNS.map(
    (c) => `"${c}" = "acme_telemetry_ingest_stats"."${c}" + EXCLUDED."${c}"`,
  );
  return (
    `INSERT INTO "acme_telemetry_ingest_stats" ` +
    `("project_id", "lineage_id", "bucket_start", ${cols.join(", ")}, "last_received_at") ` +
    `VALUES ($1, $2, $3, ${params.join(", ")}, $${STAT_COLUMNS.length + 4}) ` +
    `ON CONFLICT ("project_id", "lineage_id", "bucket_start") DO UPDATE SET ` +
    `${updates.join(", ")}, ` +
    `"last_received_at" = GREATEST("acme_telemetry_ingest_stats"."last_received_at", EXCLUDED."last_received_at")`
  );
}

export function upsertParams(row: StatsRow): unknown[] {
  return [
    row.projectId,
    row.lineageId,
    row.bucketStart,
    ...STAT_COLUMNS.map((c) => row.counters[c]),
    row.lastReceivedAt,
  ];
}
