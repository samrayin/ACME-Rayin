/**
 * ACME (CHG-2026-135, ADR-0026 §12.2): the EYEON shell's switches, read by
 * the console.
 *
 * `railStatus` says whether the navigation rail is on
 * (CAIRO_EYEON_RAIL_ENABLED, server-only, default off). The rail belongs to
 * the shell around every page, not to a project's data, so this asks only that
 * the person is signed in: no project and no scope. It returns that one
 * setting and reads nothing else. It is not a project procedure, so the
 * content-free roles' allow-lists, which guard project procedures, do not
 * apply to it and need no entry.
 */
import {
  createTRPCRouter,
  authenticatedProcedure,
} from "@/src/server/api/trpc";
import { env } from "@/src/env.mjs";

export const eyeonShellRouter = createTRPCRouter({
  railStatus: authenticatedProcedure.query(() => ({
    enabled: env.CAIRO_EYEON_RAIL_ENABLED === "true",
  })),
});
