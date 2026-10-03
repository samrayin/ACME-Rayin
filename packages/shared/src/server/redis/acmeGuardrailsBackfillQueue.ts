import { Queue } from "bullmq";
import { QueueName, QueueJobs } from "../queues";
import { createBullMQQueueOptionsWithRedis } from "./redis";
import { scheduleRecurringJob } from "./scheduleRecurringJob";
import { logger } from "../logger";

/**
 * ACME addition (CHG-2026-098, Ledger P0-10): the scheduled backfill of
 * guardrail decisions whose durable push to CAIRO failed.
 *
 * rayin-guardrails pushes every decision and retries three times (~17.5s
 * worst case). When those are exhausted the event survives only in that
 * pod's in-memory ring buffer (200 entries, lost on restart). Until this
 * job, the only thing that ever drained that buffer was a human opening the
 * Guardrails page -- `rayin_push.py`'s docstring called that "the existing
 * pull-based reconciliation", but no such reconciliation existed.
 *
 * This job is that reconciliation. It narrows the loss window from
 * "unbounded, until someone looks" to one interval. It does NOT close two
 * other paths, and should not be described as closing P0-10:
 *   - a pod restart before the interval elapses still loses the buffer;
 *   - the buffer is per-pod and the Service load-balances, so one fetch
 *     drains one replica (there have been two since CHG-2026-088).
 * ADR-0022 is the durable outbox that closes all three.
 *
 * Handler: worker/src/features/acmeGuardrailsBackfill.
 */
export class AcmeGuardrailsBackfillQueue {
  private static instance: Queue | null = null;

  public static getInstance(): Queue | null {
    if (AcmeGuardrailsBackfillQueue.instance) {
      return AcmeGuardrailsBackfillQueue.instance;
    }

    const queueOptionsWithRedis = createBullMQQueueOptionsWithRedis(
      QueueName.AcmeGuardrailsBackfillQueue,
    );
    AcmeGuardrailsBackfillQueue.instance = queueOptionsWithRedis
      ? new Queue(QueueName.AcmeGuardrailsBackfillQueue, {
          ...queueOptionsWithRedis,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: 100,
            // No retries: the next run is minutes away and reads the same
            // buffer, which is append-only within a pod's life. A retry
            // would only add load against a service that is, by the time
            // this job matters, already having a bad day.
            attempts: 1,
          },
        })
      : null;

    AcmeGuardrailsBackfillQueue.instance?.on("error", (err) => {
      logger.error("AcmeGuardrailsBackfillQueue error", err);
    });

    if (AcmeGuardrailsBackfillQueue.instance) {
      scheduleRecurringJob(AcmeGuardrailsBackfillQueue.instance, {
        jobName: QueueJobs.AcmeGuardrailsBackfillJob,
        // Every 2 minutes. The bound that matters is the ring buffer's 200
        // entries: the interval has to be shorter than the time it takes
        // 200 decisions to pass through one pod, or events rotate out
        // before this job sees them. At the dev environment's volume that
        // is hours; at a busy customer's it could be minutes, so this
        // interval is a function of traffic and must be revisited per
        // deployment rather than treated as a constant.
        pattern: "*/2 * * * *",
      });
    }

    return AcmeGuardrailsBackfillQueue.instance;
  }
}
