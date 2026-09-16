import { type Job } from "bullmq";
import { LATEST_PROMPT_LABEL } from "@langfuse/shared";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { env } from "../../env";

type DuePrompt = {
  projectId: string;
  projectName: string;
  promptName: string;
  version: number;
  reviewDate: string;
};

/**
 * Reads the review date out of a prompt's free-form `config` JSON. Anything
 * that isn't a plain object with a parseable `reviewDate` string is treated
 * as "no review date set" rather than an error -- config is shared,
 * user-editable JSON, not a schema this job owns exclusively.
 */
function extractReviewDate(config: unknown): Date | null {
  if (
    typeof config !== "object" ||
    config === null ||
    Array.isArray(config)
  ) {
    return null;
  }
  const raw = (config as Record<string, unknown>).reviewDate;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function postWebhookDigest(due: DuePrompt[]): Promise<void> {
  if (!env.ACME_PROMPT_REVIEW_WEBHOOK_URL || due.length === 0) return;

  const lines = due
    .slice(0, 20)
    .map(
      (d) =>
        `• *${d.promptName}* (v${d.version}, project "${d.projectName}") -- due ${d.reviewDate.slice(0, 10)}`,
    );
  const overflow = due.length > 20 ? `\n…and ${due.length - 20} more.` : "";

  try {
    await fetch(env.ACME_PROMPT_REVIEW_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:calendar: ${due.length} prompt${due.length === 1 ? "" : "s"} past review date\n${lines.join("\n")}${overflow}`,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    // A slow or unreachable webhook must never fail the job -- the ACME
    // Enhancements "Prompt Reviews" page still shows the due list either way.
    logger.warn("[AcmePromptReviewJob] Failed to POST review-date digest", {
      error,
    });
  }
}

export const handleAcmePromptReviewJob = async (
  job: Job,
): Promise<{ scanned: number; due: number }> => {
  const latestPrompts = await prisma.prompt.findMany({
    where: { labels: { has: LATEST_PROMPT_LABEL } },
    select: {
      projectId: true,
      name: true,
      version: true,
      config: true,
      project: { select: { name: true } },
    },
  });

  const now = new Date();
  const due: DuePrompt[] = [];

  for (const prompt of latestPrompts) {
    const reviewDate = extractReviewDate(prompt.config);
    if (reviewDate && reviewDate <= now) {
      due.push({
        projectId: prompt.projectId,
        projectName: prompt.project.name,
        promptName: prompt.name,
        version: prompt.version,
        reviewDate: reviewDate.toISOString(),
      });
    }
  }

  logger.info("[AcmePromptReviewJob] Nightly review-date scan complete", {
    jobId: job.id,
    scanned: latestPrompts.length,
    due: due.length,
  });

  await postWebhookDigest(due);

  return { scanned: latestPrompts.length, due: due.length };
};
