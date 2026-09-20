/**
 * ACME addition: wires the nightly acme_guardrail_events retention job
 * (runRetention.ts) to its real dependencies -- the rayin_retention_purger
 * PrismaClient and the repo's StorageService (the same abstraction batch
 * exports use; Azure Blob vs S3 follows LANGFUSE_USE_AZURE_BLOB).
 */
import { Readable } from "node:stream";
import { type Job } from "bullmq";
import {
  logger,
  StorageServiceFactory,
  type StorageService,
} from "@langfuse/shared/src/server";
import { env } from "../../env";
import { resolveRetentionConfig } from "./retentionConfig";
import { getPurgerClient } from "./purgerClient";
import {
  runRetention,
  type RetentionDeps,
  type RetentionRow,
  type RetentionRunSummary,
} from "./runRetention";

let archiveStorage: StorageService | null = null;

function getArchiveStorage(bucketName: string): StorageService {
  archiveStorage ??= StorageServiceFactory.getInstance({
    bucketName,
    accessKeyId: env.ACME_GUARDRAIL_ARCHIVE_ACCESS_KEY_ID,
    secretAccessKey: env.ACME_GUARDRAIL_ARCHIVE_SECRET_ACCESS_KEY,
    endpoint: env.ACME_GUARDRAIL_ARCHIVE_ENDPOINT,
    region: env.ACME_GUARDRAIL_ARCHIVE_REGION,
    forcePathStyle: env.ACME_GUARDRAIL_ARCHIVE_FORCE_PATH_STYLE === "true",
    awsSse: env.ACME_GUARDRAIL_ARCHIVE_SSE,
    awsSseKmsKeyId: env.ACME_GUARDRAIL_ARCHIVE_SSE_KMS_KEY_ID,
  });
  return archiveStorage;
}

export type AcmeGuardrailRetentionJobResult =
  | { status: "disabled"; reasons: string[] }
  | ({ status: "completed" } & RetentionRunSummary);

export const handleAcmeGuardrailRetentionJob = async (
  job: Job,
): Promise<AcmeGuardrailRetentionJobResult> => {
  const config = resolveRetentionConfig({
    DATABASE_URL: env.DATABASE_URL,
    RAYIN_RETENTION_PURGER_DATABASE_URL: env.RAYIN_RETENTION_PURGER_DATABASE_URL,
    ACME_GUARDRAIL_RETENTION_DAYS: env.ACME_GUARDRAIL_RETENTION_DAYS,
    ACME_GUARDRAIL_RETENTION_BATCH_SIZE: env.ACME_GUARDRAIL_RETENTION_BATCH_SIZE,
    ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN:
      env.ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN,
    ACME_GUARDRAIL_RETENTION_DRY_RUN: env.ACME_GUARDRAIL_RETENTION_DRY_RUN,
    ACME_GUARDRAIL_ARCHIVE_BUCKET: env.ACME_GUARDRAIL_ARCHIVE_BUCKET,
    ACME_GUARDRAIL_ARCHIVE_PREFIX: env.ACME_GUARDRAIL_ARCHIVE_PREFIX,
  });

  if (!config.enabled) {
    // Fail closed, loudly: nothing is read, archived or deleted.
    logger.warn(
      "[AcmeGuardrailRetention] Retention job DISABLED -- nothing archived or deleted",
      { jobId: job.id, reasons: config.reasons },
    );
    return { status: "disabled", reasons: config.reasons };
  }

  const client = getPurgerClient(config.purgerDatabaseUrl);
  const storage = getArchiveStorage(config.archiveBucket);

  const deps: RetentionDeps = {
    selectBatch: async ({ cutoff, after, limit }) => {
      const rows = await client.acmeGuardrailEvent.findMany({
        where: {
          eventTime: { lt: cutoff },
          ...(after
            ? {
                OR: [
                  { eventTime: { gt: after.eventTime } },
                  { eventTime: after.eventTime, id: { gt: after.id } },
                ],
              }
            : {}),
        },
        // No `select`: every column is archived, including ones added later.
        orderBy: [{ eventTime: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows as RetentionRow[];
    },
    uploadArchive: async (path, body) => {
      await storage.uploadFile({
        fileName: path,
        fileType: "application/gzip",
        data: Readable.from([body]),
      });
    },
    readArchive: (path) => storage.downloadBytes(path),
    deleteRows: async ({ ids, cutoff }) => {
      const { count } = await client.acmeGuardrailEvent.deleteMany({
        where: { id: { in: ids }, eventTime: { lt: cutoff } },
      });
      return count;
    },
    log: {
      info: (message, meta) => logger.info(message, meta),
      warn: (message, meta) => logger.warn(message, meta),
    },
  };

  const summary = await runRetention(deps, {
    ...config.settings,
    now: new Date(),
  });

  logger.info("[AcmeGuardrailRetention] Run complete", {
    jobId: job.id,
    dryRun: summary.dryRun,
    retentionDays: config.settings.retentionDays,
    cutoff: summary.cutoff,
    batches: summary.batches,
    selected: summary.selected,
    archived: summary.archived,
    deleted: summary.deleted,
    hitBatchLimit: summary.hitBatchLimit,
  });

  return { status: "completed", ...summary };
};
