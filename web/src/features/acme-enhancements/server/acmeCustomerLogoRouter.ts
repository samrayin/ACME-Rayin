/**
 * ACME (CHG-2026-124, ADR-0025): the customer's own logo, one per
 * organization, shown beside the EYEON wordmark in the sidebar.
 *
 * Every member of the organization reads it (the sidebar needs it on every
 * page). Only a role with organization:update (Owner, Admin) uploads or
 * removes it, and each change is audit-logged with the file's type, size,
 * dimensions and SHA-256, never the image itself.
 *
 * Stored in its own table, not in Organization.metadata: the session callback
 * copies that metadata into every session, and a logo there would ride along
 * on every request.
 */
import { createHash } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedOrganizationProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  ACME_LOGO_LIMITS,
  ACME_LOGO_TYPES,
  checkLogo,
} from "@/src/features/acme-enhancements/server/acmeCustomerLogoCheck";

/** Base64 of the largest accepted file, with a little room. */
const MAX_BASE64_LENGTH = Math.ceil((ACME_LOGO_LIMITS.maxBytes * 4) / 3) + 8;

const LOGO_METADATA = {
  contentType: true,
  width: true,
  height: true,
  sizeBytes: true,
  sha256: true,
  updatedAt: true,
} as const;

export const acmeCustomerLogoRouter = createTRPCRouter({
  get: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      const logo = await ctx.prisma.acmeOrganizationLogo.findUnique({
        where: { orgId: input.orgId },
        select: { ...LOGO_METADATA, data: true },
      });
      if (!logo) return null;
      return {
        src: `data:${logo.contentType};base64,${Buffer.from(logo.data).toString("base64")}`,
        width: logo.width,
        height: logo.height,
        sizeBytes: logo.sizeBytes,
        updatedAt: logo.updatedAt,
      };
    }),

  upload: protectedOrganizationProcedure
    .input(
      z.object({
        orgId: z.string(),
        contentType: z.enum(ACME_LOGO_TYPES),
        dataBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organization:update",
      });
      const bytes = new Uint8Array(Buffer.from(input.dataBase64, "base64"));
      const check = checkLogo(bytes, input.contentType);
      if (!check.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const row = {
        contentType: check.contentType,
        data: Buffer.from(bytes),
        width: check.width,
        height: check.height,
        sizeBytes: check.sizeBytes,
        sha256,
        updatedBy: ctx.session.user.id,
      };

      const before = await ctx.prisma.acmeOrganizationLogo.findUnique({
        where: { orgId: input.orgId },
        select: LOGO_METADATA,
      });
      const after = await ctx.prisma.acmeOrganizationLogo.upsert({
        where: { orgId: input.orgId },
        create: { orgId: input.orgId, ...row },
        update: row,
        select: LOGO_METADATA,
      });
      await auditLog({
        session: ctx.session,
        resourceType: "acmeOrganizationLogo",
        resourceId: input.orgId,
        action: before ? "replace" : "upload",
        before: before ?? undefined,
        after,
      });
      return after;
    }),

  remove: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organization:update",
      });
      const before = await ctx.prisma.acmeOrganizationLogo.findUnique({
        where: { orgId: input.orgId },
        select: LOGO_METADATA,
      });
      if (!before) return { removed: false };
      await ctx.prisma.acmeOrganizationLogo.delete({
        where: { orgId: input.orgId },
      });
      await auditLog({
        session: ctx.session,
        resourceType: "acmeOrganizationLogo",
        resourceId: input.orgId,
        action: "remove",
        before,
      });
      return { removed: true };
    }),
});
