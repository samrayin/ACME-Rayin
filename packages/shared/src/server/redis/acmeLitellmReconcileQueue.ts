import { Queue } from "bullmq";
import { QueueName, QueueJobs } from "../queues";
import { createBullMQQueueOptionsWithRedis } from "./redis";
import { scheduleRecurringJob } from "./scheduleRecurringJob";
import { logger } from "../logger";

/**
 * ACME addition (ADR-0003 §4.4, CHG-2026-008): the scheduled reconciliation
 * of CAIRO's LiteLLM request-log mirror against LiteLLM's own spend logs.
 * Push is fast but can lose events; this pass is what makes the mirror
 * complete and, above all, makes a gap VISIBLE. Handler:
 * worker/src/features/acmeLitellmReconcile.
 */
export class AcmeLitellmReconcileQueue {
  private static instance: Queue | null = null;

  public static getInstance(): Queue | null {
    if (AcmeLitellmReconcileQueue.instance) {
      return AcmeLitellmReconcileQueue.instance;
    }

    const queueOptionsWithRedis = createBullMQQueueOptionsWithRedis(
      QueueName.AcmeLitellmReconcileQueue,
    );
    AcmeLitellmReconcileQueue.instance = queueOptionsWithRedis
      ? new Queue(QueueName.AcmeLitellmReconcileQueue, {
          ...queueOptionsWithRedis,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: 100,
            // No retries: the next run is five minutes away and covers an
            // overlapping window, so a retry only adds load.
            attempts: 1,
          },
        })
      : null;

    AcmeLitellmReconcileQueue.instance?.on("error", (err) => {
      logger.error("AcmeLitellmReconcileQueue error", err);
    });

    if (AcmeLitellmReconcileQueue.instance) {
      scheduleRecurringJob(AcmeLitellmReconcileQueue.instance, {
        jobName: QueueJobs.AcmeLitellmReconcileJob,
        pattern: "*/5 * * * *",
      });
    }

    return AcmeLitellmReconcileQueue.instance;
  }
}
