import { Queue } from "bullmq";
import { QueueName, QueueJobs } from "../queues";
import { createBullMQQueueOptionsWithRedis } from "./redis";
import { scheduleRecurringJob } from "./scheduleRecurringJob";
import { logger } from "../logger";

// Nightly at 02:30 UTC -- off-peak for Bahrain (05:30 local), and well clear
// of the 06:00 UTC prompt-review scan. Exported so the schedule is testable.
export const ACME_GUARDRAIL_RETENTION_CRON_PATTERN = "30 2 * * *";

/**
 * ACME addition: nightly 30-day retention job for acme_guardrail_events
 * (POSTGRES-COMPLIANCE-FRAMEWORK.md §1.3). Archives rows older than
 * ACME_GUARDRAIL_RETENTION_DAYS to blob storage, verifies the archive, and
 * only then deletes them via the rayin_retention_purger role. See
 * worker/src/features/acmeGuardrailRetention for the handler.
 *
 * attempts: 1 on purpose. A failed run leaves every not-yet-verified row in
 * Postgres (delete only follows a verified upload), so the next nightly run
 * simply picks them up again -- an immediate automatic retry adds nothing
 * except more half-written archive objects when storage is the problem.
 */
export class AcmeGuardrailRetentionQueue {
  private static instance: Queue | null = null;

  public static getInstance(): Queue | null {
    if (AcmeGuardrailRetentionQueue.instance) {
      return AcmeGuardrailRetentionQueue.instance;
    }

    const queueOptionsWithRedis = createBullMQQueueOptionsWithRedis(
      QueueName.AcmeGuardrailRetentionQueue,
    );
    AcmeGuardrailRetentionQueue.instance = queueOptionsWithRedis
      ? new Queue(QueueName.AcmeGuardrailRetentionQueue, {
          ...queueOptionsWithRedis,
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 100,
            attempts: 1,
          },
        })
      : null;

    AcmeGuardrailRetentionQueue.instance?.on("error", (err) => {
      logger.error("AcmeGuardrailRetentionQueue error", err);
    });

    if (AcmeGuardrailRetentionQueue.instance) {
      scheduleRecurringJob(AcmeGuardrailRetentionQueue.instance, {
        jobName: QueueJobs.AcmeGuardrailRetentionJob,
        pattern: ACME_GUARDRAIL_RETENTION_CRON_PATTERN,
      });
    }

    return AcmeGuardrailRetentionQueue.instance;
  }
}
