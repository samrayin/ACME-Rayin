import { Processor } from "bullmq";
import { instrumentAsync, logger, QueueJobs } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";
import { handleAcmeGuardrailRetentionJob } from "../features/acmeGuardrailRetention/handleAcmeGuardrailRetentionJob";

// ACME addition: processor for the nightly acme_guardrail_events retention
// job. See packages/shared/src/server/redis/acmeGuardrailRetentionQueue.ts.
export const acmeGuardrailRetentionQueueProcessor: Processor = async (job) => {
  if (job.name === QueueJobs.AcmeGuardrailRetentionJob) {
    return await instrumentAsync(
      {
        name: "process acme-guardrail-retention",
        startNewTrace: true,
        spanKind: SpanKind.CONSUMER,
      },
      async () => {
        logger.info("[AcmeGuardrailRetention] Executing nightly retention run", {
          jobId: job.id,
          jobName: job.name,
          timestamp: new Date().toISOString(),
        });
        try {
          return await handleAcmeGuardrailRetentionJob(job);
        } catch (error) {
          logger.error("[AcmeGuardrailRetention] Retention run failed; rows not yet verified in the archive were left in place", {
            jobId: job.id,
            error,
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },
    );
  }
};
