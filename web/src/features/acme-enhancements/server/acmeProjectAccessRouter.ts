/**
 * ACME project access policy router (ADR-0011 section 5, CHG-2026-059 c).
 *
 * Organisation admins set, per person and project, a ceiling role that can
 * only narrow the person's organisation role (see projectAccessPolicy.ts).
 * Every change is written to the audit log. The session callback in
 * server/auth.ts applies the ceilings.
 */
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { Role } from "@langfuse/shared";
import { type PrismaClient } from "@langfuse/shared/src/db";
import {
  createTRPCRouter,
  protectedOrganizationProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { orderedRoles } from "@/src/features/rbac/constants/orderedRoles";
import { auditLog } from "@/src/features/audit-logs/server";
import {
  isValidCeiling,
  validCeilingsFor,
} from "@/src/features/acme-enhancements/projectAccess/projectAccessPolicy";
import { isProjectAccessPolicyEnabled } from "@/src/features/acme-enhancements/projectAccess/loadProjectAccessCeilings";

const targetInput = z.object({
  orgId: z.string(),
  projectId: z.string(),
  userId: z.string(),
});

/**
 * Loads the target membership and applies the checks every write shares:
 * the member and the project belong to this organisation, the caller is not
 * limiting themselves, and the caller's role is not lower than the target's
 * (as for upstream member edits).
 */
async function loadTarget(
  prisma: PrismaClient,
  session: { user: { id: string }; orgRole: Role },
  input: z.infer<typeof targetInput>,
): Promise<{ orgMembershipId: string; orgRole: Role }> {
  if (input.userId === session.user.id)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You cannot set a project access limit on yourself.",
    });

  const [membership, project] = await Promise.all([
    prisma.organizationMembership.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
      select: { id: true, role: true },
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, orgId: input.orgId, deletedAt: null },
      select: { id: true },
    }),
  ]);
  if (!membership || !project)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Member or project not found in this organization.",
    });
  if (orderedRoles[session.orgRole] < orderedRoles[membership.role])
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot limit a member whose role is higher than your own.",
    });
  return { orgMembershipId: membership.id, orgRole: membership.role };
}

export const acmeProjectAccessRouter = createTRPCRouter({
  overview: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organizationMembers:CUD",
      });

      const [memberships, projects, policies] = await Promise.all([
        ctx.prisma.organizationMembership.findMany({
          where: { orgId: input.orgId },
          select: {
            userId: true,
            role: true,
            user: { select: { name: true, email: true } },
          },
          orderBy: { user: { email: "asc" } },
        }),
        ctx.prisma.project.findMany({
          where: { orgId: input.orgId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        ctx.prisma.acmeProjectAccess.findMany({
          where: { orgId: input.orgId },
          select: {
            projectId: true,
            userId: true,
            ceilingRole: true,
            updatedAt: true,
          },
        }),
      ]);

      const orgRoleOf = new Map(memberships.map((m) => [m.userId, m.role]));
      return {
        enabled: isProjectAccessPolicyEnabled(),
        members: memberships.map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          orgRole: m.role,
          validCeilings: validCeilingsFor(m.role),
        })),
        projects,
        policies: policies.map((p) => {
          const orgRole = orgRoleOf.get(p.userId);
          return {
            ...p,
            // False when the organisation role changed after the limit was
            // set. Such a row hides the project until an admin reviews it.
            valid:
              orgRole !== undefined && isValidCeiling(orgRole, p.ceilingRole),
          };
        }),
      };
    }),

  set: protectedOrganizationProcedure
    .input(targetInput.extend({ ceilingRole: z.enum(Role) }))
    .mutation(async ({ ctx, input }) => {
      throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organizationMembers:CUD",
      });
      const target = await loadTarget(ctx.prisma, ctx.session, input);
      if (!isValidCeiling(target.orgRole, input.ceilingRole))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${input.ceilingRole} limit would grant access that the member's organization role (${target.orgRole}) does not have. A project access limit can only narrow access.`,
        });

      const where = {
        projectId_userId: { projectId: input.projectId, userId: input.userId },
      };
      const before = await ctx.prisma.acmeProjectAccess.findUnique({ where });
      const after = await ctx.prisma.acmeProjectAccess.upsert({
        where,
        create: {
          orgId: input.orgId,
          orgMembershipId: target.orgMembershipId,
          projectId: input.projectId,
          userId: input.userId,
          ceilingRole: input.ceilingRole,
          createdBy: ctx.session.user.id,
        },
        update: { ceilingRole: input.ceilingRole },
      });
      await auditLog({
        session: ctx.session,
        resourceType: "acmeProjectAccess",
        resourceId: after.id,
        action: before ? "update" : "create",
        before: before ?? undefined,
        after,
      });
      return after;
    }),

  remove: protectedOrganizationProcedure
    .input(targetInput)
    .mutation(async ({ ctx, input }) => {
      throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organizationMembers:CUD",
      });
      await loadTarget(ctx.prisma, ctx.session, input);
      const before = await ctx.prisma.acmeProjectAccess.findUnique({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
      });
      if (!before) return { removed: false };
      await ctx.prisma.acmeProjectAccess.delete({ where: { id: before.id } });
      await auditLog({
        session: ctx.session,
        resourceType: "acmeProjectAccess",
        resourceId: before.id,
        action: "delete",
        before,
      });
      return { removed: true };
    }),
});
