/**
 * ACME addition: resolves the retention job's configuration from the worker
 * env (POSTGRES-COMPLIANCE-FRAMEWORK.md §1.3). Pure -- takes the env values as
 * an argument instead of importing `env` -- so the fail-closed rules below are
 * unit-testable without process-level env parsing.
 *
 * Fail-closed rules:
 *  - no RAYIN_RETENTION_PURGER_DATABASE_URL  -> disabled
 *  - no ACME_GUARDRAIL_ARCHIVE_BUCKET        -> disabled
 *  - purger URL identical to DATABASE_URL    -> disabled (that would be the
 *    general rayin_app_runtime connection wearing the purger's name)
 * There is no code path that falls back to the general DB connection.
 */

export type RetentionEnvInput = {
  DATABASE_URL?: string;
  RAYIN_RETENTION_PURGER_DATABASE_URL?: string;
  ACME_GUARDRAIL_RETENTION_DAYS: number;
  ACME_GUARDRAIL_RETENTION_BATCH_SIZE: number;
  ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN: number;
  ACME_GUARDRAIL_RETENTION_DRY_RUN: "true" | "false";
  ACME_GUARDRAIL_ARCHIVE_BUCKET?: string;
  ACME_GUARDRAIL_ARCHIVE_PREFIX: string;
};

export type RetentionSettings = {
  retentionDays: number;
  batchSize: number;
  maxBatchesPerRun: number;
  dryRun: boolean;
  archivePrefix: string;
};

export type ResolvedRetentionConfig =
  | { enabled: false; reasons: string[] }
  | {
      enabled: true;
      purgerDatabaseUrl: string;
      archiveBucket: string;
      settings: RetentionSettings;
    };

/** Normalises a prefix to "" or "something/" (no leading slash). */
export function normalizeArchivePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "");
  if (trimmed === "") return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function resolveRetentionConfig(
  input: RetentionEnvInput,
): ResolvedRetentionConfig {
  const reasons: string[] = [];
  const purgerUrl = input.RAYIN_RETENTION_PURGER_DATABASE_URL?.trim();
  const bucket = input.ACME_GUARDRAIL_ARCHIVE_BUCKET?.trim();

  if (!purgerUrl) {
    reasons.push("RAYIN_RETENTION_PURGER_DATABASE_URL is not configured");
  } else if (input.DATABASE_URL && purgerUrl === input.DATABASE_URL.trim()) {
    reasons.push(
      "RAYIN_RETENTION_PURGER_DATABASE_URL is identical to DATABASE_URL -- " +
        "refusing to purge through the general database connection",
    );
  }
  if (!bucket) {
    reasons.push("ACME_GUARDRAIL_ARCHIVE_BUCKET is not configured");
  }

  const retentionDays = Number(input.ACME_GUARDRAIL_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    reasons.push("ACME_GUARDRAIL_RETENTION_DAYS must be an integer >= 1");
  }
  const batchSize = Number(input.ACME_GUARDRAIL_RETENTION_BATCH_SIZE);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    reasons.push("ACME_GUARDRAIL_RETENTION_BATCH_SIZE must be an integer >= 1");
  }
  const maxBatchesPerRun = Number(
    input.ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN,
  );
  if (!Number.isInteger(maxBatchesPerRun) || maxBatchesPerRun < 1) {
    reasons.push(
      "ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN must be an integer >= 1",
    );
  }

  if (reasons.length > 0 || !purgerUrl || !bucket) {
    return { enabled: false, reasons };
  }

  return {
    enabled: true,
    purgerDatabaseUrl: purgerUrl,
    archiveBucket: bucket,
    settings: {
      retentionDays,
      batchSize,
      maxBatchesPerRun,
      // Anything other than an explicit "false" is a dry run.
      dryRun: input.ACME_GUARDRAIL_RETENTION_DRY_RUN !== "false",
      archivePrefix: normalizeArchivePrefix(input.ACME_GUARDRAIL_ARCHIVE_PREFIX),
    },
  };
}
