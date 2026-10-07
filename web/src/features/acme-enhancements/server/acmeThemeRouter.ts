/**
 * ACME enhancement — lets a project owner/admin pick from a small set of
 * accent-color and header-background presets, applied live across the app
 * without a redeploy. Stored in Project.metadata (a generic JSON column
 * Langfuse already has — no schema migration needed) under the "acmeTheme"
 * key, alongside whatever else may already live there.
 */
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import {
  ACME_ACCENT_COLOR_KEYS,
  ACME_DARK_ACCENT_KEYS,
  ACME_HEADER_BACKGROUND_KEYS,
  ACME_THEME_DEFAULT,
  type AcmeTheme,
} from "@/src/features/acme-enhancements/theme/acmeThemePresets";

const acmeThemeSchema = z.object({
  accentColor: z.enum(ACME_ACCENT_COLOR_KEYS),
  headerBackground: z.enum(ACME_HEADER_BACKGROUND_KEYS),
  // CHG-2026-127: optional, so a theme stored before dark-mode accents
  // existed still parses; it then gets the default (lime).
  darkAccentColor: z
    .enum(ACME_DARK_ACCENT_KEYS)
    .default(ACME_THEME_DEFAULT.darkAccentColor),
});

function parseAcmeTheme(metadata: unknown): AcmeTheme {
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : null;
  if (record?.acmeTheme) {
    const parsed = acmeThemeSchema.safeParse(record.acmeTheme);
    if (parsed.success) return parsed.data;
  }
  return ACME_THEME_DEFAULT;
}

export const acmeThemeRouter = createTRPCRouter({
  // No RBAC scope check beyond project membership -- every member of the
  // project needs to see the chosen theme, not just owners/admins.
  get: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { metadata: true },
      });
      return parseAcmeTheme(project.metadata);
    }),

  update: protectedProjectProcedure
    .input(
      z.object({ projectId: z.string() }).extend({
        ...acmeThemeSchema.shape,
        // Omitted (an older client): the stored dark accent is kept.
        darkAccentColor: z.enum(ACME_DARK_ACCENT_KEYS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "project:update",
      });

      const project = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { metadata: true },
      });
      const currentMetadata =
        project.metadata && typeof project.metadata === "object"
          ? (project.metadata as Record<string, unknown>)
          : {};

      const theme: AcmeTheme = {
        accentColor: input.accentColor,
        headerBackground: input.headerBackground,
        darkAccentColor:
          input.darkAccentColor ??
          parseAcmeTheme(project.metadata).darkAccentColor,
      };

      await ctx.prisma.project.update({
        where: { id: input.projectId },
        data: {
          metadata: { ...currentMetadata, acmeTheme: theme },
        },
      });

      return theme;
    }),
});
