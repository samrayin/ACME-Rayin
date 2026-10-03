import { Processor } from "bullmq";
import {
  instrumentAsync,
  logger,
  QueueJobs,
} from "@langfuse/shared/src/server";
import { handleAcmeGuardrailsBackfillJob } from "../features/acmeGuardrailsBackfill/handleAcmeGuardrailsBackfillJob";
import { SpanKind } from "@opentelemetry/api";

export const acmeGuardrailsBackfillQueueProcessor: Processor = async (job) => {
  if (job.name === QueueJobs.AcmeGuardrailsBackfillJob) {
    return await instrumentAsync(
      {
        name: "process acme-guardrails-backfill",
        startNewTrace: true,
        spanKind: SpanKind.CONSUMER,
      },
      async () => {
        try {
          return await handleAcmeGuardrailsBackfillJob();
        } catch (error) {
          // rayin-guardrails being unreachable is the ordinary case this
          // job exists for -- it is logged and rethrown so a persistently
          // undrained buffer shows up as a failing job rather than as
          // silence. BullMQ keeps the last 100 failures.
          logger.error(
            "[AcmeGuardrailsBackfillJob] Error draining the guardrails buffer",
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
