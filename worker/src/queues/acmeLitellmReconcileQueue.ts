import { Processor } from "bullmq";
import {
  instrumentAsync,
  logger,
  QueueJobs,
} from "@langfuse/shared/src/server";
import { handleAcmeLitellmReconcileJob } from "../features/acmeLitellmReconcile/handleAcmeLitellmReconcileJob";
import { SpanKind } from "@opentelemetry/api";

export const acmeLitellmReconcileQueueProcessor: Processor = async (job) => {
  if (job.name === QueueJobs.AcmeLitellmReconcileJob) {
    return await instrumentAsync(
      {
        name: "process acme-litellm-reconcile",
        startNewTrace: true,
        spanKind: SpanKind.CONSUMER,
      },
      async () => {
        try {
          return await handleAcmeLitellmReconcileJob();
        } catch (error) {
          // reconcileOnce records LiteLLM failures as a run row itself; this
          // is for what it cannot record, e.g. the writer connection is down.
          logger.error(
            "[AcmeLitellmReconcileJob] Error executing reconciliation",
            {
              jobId: job.id,
              error,
            },
          );
          throw error;
        }
      },
    );
  }
};
