import { Processor } from "bullmq";
import { instrumentAsync, logger, QueueJobs } from "@langfuse/shared/src/server";
import { handleAcmePromptReviewJob } from "../features/acmePromptReview/handleAcmePromptReviewJob";
import { SpanKind } from "@opentelemetry/api";

export const acmePromptReviewQueueProcessor: Processor = async (job) => {
  if (job.name === QueueJobs.AcmePromptReviewJob) {
    return await instrumentAsync(
      {
        name: "process acme-prompt-review",
        startNewTrace: true,
        spanKind: SpanKind.CONSUMER,
      },
      async () => {
        logger.info("[AcmePromptReviewJob] Executing nightly review-date scan", {
          jobId: job.id,
          jobName: job.name,
          timestamp: new Date().toISOString(),
        });
        try {
          return await handleAcmePromptReviewJob(job);
        } catch (error) {
          logger.error("[AcmePromptReviewJob] Error executing review-date scan", {
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
