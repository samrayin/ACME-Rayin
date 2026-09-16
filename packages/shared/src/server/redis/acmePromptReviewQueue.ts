import { Queue } from "bullmq";
import { QueueName, QueueJobs } from "../queues";
import { createBullMQQueueOptionsWithRedis } from "./redis";
import { scheduleRecurringJob } from "./scheduleRecurringJob";
import { logger } from "../logger";

/**
 * ACME addition: nightly scan for prompts past their configured review date
 * (stored in Prompt.config.reviewDate, a free-form JSON field -- no schema
 * migration needed). See worker/src/features/acmePromptReview for the
 * handler and web/src/features/acme-enhancements/server/acmePromptReviewRouter.ts
 * for where reviewDate gets set and the due list gets read.
 */
export class AcmePromptReviewQueue {
  private static instance: Queue | null = null;

  public static getInstance(): Queue | null {
    if (AcmePromptReviewQueue.instance) {
      return AcmePromptReviewQueue.instance;
    }

    const queueOptionsWithRedis = createBullMQQueueOptionsWithRedis(
      QueueName.AcmePromptReviewQueue,
    );
    AcmePromptReviewQueue.instance = queueOptionsWithRedis
      ? new Queue(QueueName.AcmePromptReviewQueue, {
          ...queueOptionsWithRedis,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: 100,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          },
        })
      : null;

    AcmePromptReviewQueue.instance?.on("error", (err) => {
      logger.error("AcmePromptReviewQueue error", err);
    });

    if (AcmePromptReviewQueue.instance) {
      // Run once a day at 06:00 UTC -- a daily digest, not a live alert;
      // review-date is a calendar-granularity concept, not a real-time one.
      scheduleRecurringJob(AcmePromptReviewQueue.instance, {
        jobName: QueueJobs.AcmePromptReviewJob,
        pattern: "0 6 * * *",
      });
    }

    return AcmePromptReviewQueue.instance;
  }
}
