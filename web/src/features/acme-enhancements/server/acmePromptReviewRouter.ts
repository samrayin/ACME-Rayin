/**
 * ACME addition: prompt review-date management. Stores an optional
 * `reviewDate` in Prompt.config (free-form JSON, no migration needed) on a
 * prompt's latest version, and lets a project member list what's currently
 * past due. The actual nightly scan + webhook digest lives in the worker
 * (worker/src/features/acmePromptReview/handleAcmePromptReviewJob.ts) --
 * this router only covers what the UI needs: read the due list, and set/
 * clear a review date.
 *
 * Gated on the existing prompts:read / prompts:CUD scopes rather than a new
 * RBAC scope -- setting a review date is not more sensitive than editing the
 * prompt itself, so it doesn't need its own permission tier.
 */
import { z } from "zod";
import { createTRPCRouter, protectedProjectProcedure } from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { prisma, Prisma } from "@langfuse/shared/src/db";
import { LATEST_PROMPT_LABEL } from "@langfuse/shared";
import { TRPCError } from "@trpc/server";

function extractReviewDate(config: unknown): string | null {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return null;
  }
  const raw = (config as Record<string, unknown>).reviewDate;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const acmePromptReviewRouter = createTRPCRouter({
  listDue: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const latestPrompts = await prisma.prompt.findMany({
        where: {
          projectId: input.projectId,
          labels: { has: LATEST_PROMPT_LABEL },
        },
        select: { id: true, name: true, version: true, config: true },
        orderBy: { name: "asc" },
      });

      const now = new Date();
      const due = latestPrompts
        .map((p) => ({ ...p, reviewDate: extractReviewDate(p.config) }))
        .filter(
          (p): p is typeof p & { reviewDate: string } =>
            p.reviewDate !== null && new Date(p.reviewDate) <= now,
        )
        .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate))
        .map((p) => ({
          promptId: p.id,
          name: p.name,
          version: p.version,
          reviewDate: p.reviewDate,
        }));

      return { due };
    }),

  // Every latest-version prompt name with its current review date (or null),
  // for the "set a review date" picker -- separate from listDue since the UI
  // needs the full set, not just what's overdue.
  listAll: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const latestPrompts = await prisma.prompt.findMany({
        where: {
          projectId: input.projectId,
          labels: { has: LATEST_PROMPT_LABEL },
        },
        select: { id: true, name: true, version: true, config: true },
        orderBy: { name: "asc" },
      });

      return {
        prompts: latestPrompts.map((p) => ({
          promptId: p.id,
          name: p.name,
          version: p.version,
          reviewDate: extractReviewDate(p.config),
        })),
      };
    }),

  setReviewDate: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptId: z.string(),
        // null clears the review date
        reviewDate: z.string().datetime().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const prompt = await prisma.prompt.findFirst({
        where: { id: input.promptId, projectId: input.projectId },
        select: { id: true, config: true },
      });
      if (!prompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found in this project.",
        });
      }

      const existingConfig =
        typeof prompt.config === "object" &&
        prompt.config !== null &&
        !Array.isArray(prompt.config)
          ? (prompt.config as Record<string, unknown>)
          : {};

      const nextConfig = { ...existingConfig };
      if (input.reviewDate === null) {
        delete nextConfig.reviewDate;
      } else {
        nextConfig.reviewDate = input.reviewDate;
      }

      await prisma.prompt.update({
        where: { id: prompt.id },
        data: { config: nextConfig as Prisma.InputJsonObject },
      });

      return { success: true as const };
    }),
});
