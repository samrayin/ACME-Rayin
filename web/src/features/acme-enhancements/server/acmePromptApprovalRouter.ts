/**
 * ACME addition: a request/approve/reject trail for pushing a prompt
 * version to a label (e.g. "production") before go-live.
 *
 * Deliberately sits alongside Langfuse's own promptProtectedLabels
 * (Enterprise-gated, checked via checkHasProtectedLabels -- see
 * promptRouter.ts) rather than replacing it: that feature is a permission
 * check ("can this user push this label at all"), this is a named-approver
 * audit trail ("who asked, who approved, when"). A deployment can use
 * either, both, or neither.
 *
 * request: prompts:CUD -- same bar as editing the prompt itself.
 * approve/reject: project:update -- owner/admin only, same sensitivity as
 * UI Customization and the Guardrails config write path (acmeGuardrailsRouter
 * updateConfig), since approving changes what's live for every user.
 */
import { z } from "zod";
import { createTRPCRouter, protectedProjectProcedure } from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { prisma } from "@langfuse/shared/src/db";
import { removeLabelsFromPreviousPromptVersions } from "@/src/features/prompts/server/utils/updatePromptLabels";
import { TRPCError } from "@trpc/server";

export const acmePromptApprovalRouter = createTRPCRouter({
  request: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptId: z.string(),
        targetLabel: z.string().min(1).max(100),
        comment: z.string().max(2000).optional(),
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
        select: { id: true, name: true, version: true },
      });
      if (!prompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found in this project.",
        });
      }

      // A prompt version already has an unresolved (pending) request for
      // this exact label -- don't let a second one pile up silently.
      const existingPending = await prisma.acmePromptApproval.findFirst({
        where: {
          projectId: input.projectId,
          promptId: input.promptId,
          targetLabel: input.targetLabel,
          status: "PENDING",
        },
        select: { id: true },
      });
      if (existingPending) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A pending approval request for label "${input.targetLabel}" on this prompt version already exists.`,
        });
      }

      const approval = await prisma.acmePromptApproval.create({
        data: {
          projectId: input.projectId,
          promptId: prompt.id,
          promptName: prompt.name,
          promptVersion: prompt.version,
          targetLabel: input.targetLabel,
          requestedBy: ctx.session.user.id,
          requestComment: input.comment,
        },
      });

      return approval;
    }),

  approve: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        approvalId: z.string(),
        comment: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "project:update",
      });

      const approval = await prisma.acmePromptApproval.findFirst({
        where: { id: input.approvalId, projectId: input.projectId },
      });
      if (!approval) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found." });
      }
      if (approval.status !== "PENDING") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Approval request is already ${approval.status.toLowerCase()}.`,
        });
      }

      // Segregation of duties: OWNER and ADMIN hold both prompts:CUD and
      // project:update, so without this check the same person could request
      // and approve their own prompt promotion. Compliance framework §4.2.
      if (approval.requestedBy === ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot approve your own prompt approval request.",
        });
      }

      const targetPrompt = await prisma.prompt.findFirst({
        where: { id: approval.promptId, projectId: input.projectId },
        select: { id: true, labels: true },
      });
      if (!targetPrompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "The prompt version this request was for no longer exists.",
        });
      }

      // Same two-step relabel Langfuse's own updatePrompts action uses: strip
      // the label off whichever version currently holds it, then add it here
      // -- a label lives on exactly one version at a time.
      const { updates } = await removeLabelsFromPreviousPromptVersions({
        prisma,
        projectId: input.projectId,
        promptName: approval.promptName,
        labelsToRemove: [approval.targetLabel],
      });

      await prisma.$transaction([
        ...updates,
        prisma.prompt.update({
          where: { id: targetPrompt.id },
          data: {
            labels: targetPrompt.labels.includes(approval.targetLabel)
              ? targetPrompt.labels
              : [...targetPrompt.labels, approval.targetLabel],
          },
        }),
        prisma.acmePromptApproval.update({
          where: { id: approval.id },
          data: {
            status: "APPROVED",
            reviewedBy: ctx.session.user.id,
            reviewedAt: new Date(),
            reviewComment: input.comment,
          },
        }),
      ]);

      return { success: true as const };
    }),

  reject: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        approvalId: z.string(),
        comment: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "project:update",
      });

      const approval = await prisma.acmePromptApproval.findFirst({
        where: { id: input.approvalId, projectId: input.projectId },
      });
      if (!approval) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found." });
      }
      if (approval.status !== "PENDING") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Approval request is already ${approval.status.toLowerCase()}.`,
        });
      }

      await prisma.acmePromptApproval.update({
        where: { id: approval.id },
        data: {
          status: "REJECTED",
          reviewedBy: ctx.session.user.id,
          reviewedAt: new Date(),
          reviewComment: input.comment,
        },
      });

      return { success: true as const };
    }),

  listPending: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      return prisma.acmePromptApproval.findMany({
        where: { projectId: input.projectId, status: "PENDING" },
        orderBy: { requestedAt: "asc" },
      });
    }),

  listHistory: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      return prisma.acmePromptApproval.findMany({
        where: { projectId: input.projectId, status: { in: ["APPROVED", "REJECTED"] } },
        orderBy: { reviewedAt: "desc" },
        take: input.limit,
      });
    }),
});
