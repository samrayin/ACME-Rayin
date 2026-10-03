/**
 * ACME enhancement — a read-only audit log viewer that does NOT require the
 * "audit-logs" Enterprise entitlement.
 *
 * Why this is a separate router rather than reusing `auditLogsRouter`:
 * audit-log WRITES are already ungated in Langfuse OSS (verified in
 * `web/src/features/audit-logs/auditLog.ts` — no plan/entitlement check on
 * the write path). Only the official VIEWER is entitlement-gated
 * (`web/src/server/api/routers/auditLogs.ts`, `throwIfNoEntitlement({
 * entitlement: "audit-logs", ... })`), and that viewer component
 * (`web/src/ee/features/audit-log-viewer/*`) lives under `web/src/ee/`,
 * which the root LICENSE carves out as EE-licensed — so it cannot be reused
 * or imported here regardless of what it does at runtime.
 *
 * This file re-implements the same read query directly against the
 * already-ungated data, in an MIT-licensed location, with normal project
 * RBAC (`projectAuditLogs:read` — the same permission scope the licensed UI
 * uses, which is just an access-control string, not EE-licensed code)
 * instead of the entitlement check. No write path — this is intentionally
 * read-only.
 */
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { paginationZod } from "@langfuse/shared";
import { AuditLogRecordType, type AuditLog } from "@langfuse/shared/src/db";
import { isContentFreeRole } from "@/src/features/rbac/server/securityRoleAllowList";
import { maskAuditLogStates } from "@/src/features/acme-enhancements/server/auditLogMasking";

type AcmeAuditLogActor =
  | { type: "API_KEY"; body: { id: string | null; publicKey: string | null } }
  | {
      type: "USER";
      body: {
        id: string | null;
        name: string | null;
        email: string | null;
        image: string | null;
      };
    }
  | null;

function mapActors(
  auditLogs: AuditLog[],
  userMap: Map<
    string,
    {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
    }
  >,
  apiKeyMap: Map<string, { id: string; publicKey: string }>,
) {
  return auditLogs.map((log) => {
    let actor: AcmeAuditLogActor = null;
    switch (log.type) {
      case AuditLogRecordType.USER:
        actor = {
          type: log.type,
          body: userMap.get(log.userId ?? "") ?? {
            id: log.userId,
            name: null,
            email: null,
            image: null,
          },
        };
        break;
      case AuditLogRecordType.API_KEY:
        actor = {
          type: log.type,
          body: apiKeyMap.get(log.apiKeyId ?? "") ?? {
            id: log.apiKeyId,
            publicKey: null,
          },
        };
        break;
      default:
        /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        const exhaustiveCheck: never = log.type;
        throw new Error(`Type ${log.type} not found`);
    }
    return { ...log, actor };
  });
}

export const acmeAuditLogsRouter = createTRPCRouter({
  all: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), ...paginationZod }))
    .query(async ({ ctx, input }) => {
      // Project access control only — deliberately no entitlement check.
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectAuditLogs:read",
      });

      const [auditLogs, totalCount] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          where: { projectId: input.projectId },
          orderBy: { createdAt: "desc" },
          skip: input.page * input.limit,
          take: input.limit,
        }),
        ctx.prisma.auditLog.count({ where: { projectId: input.projectId } }),
      ]);

      const userIds = [
        ...new Set(auditLogs.flatMap((l) => (l.userId ? [l.userId] : []))),
      ];
      const apiKeyIds = [
        ...new Set(auditLogs.flatMap((l) => (l.apiKeyId ? [l.apiKeyId] : []))),
      ];

      const [users, apiKeys] = await Promise.all([
        ctx.prisma.user.findMany({
          where: {
            id: { in: userIds },
            organizationMemberships: {
              some: {
                organization: { projects: { some: { id: input.projectId } } },
              },
            },
          },
          select: { id: true, name: true, email: true, image: true },
        }),
        ctx.prisma.apiKey.findMany({
          where: { id: { in: apiKeyIds }, projectId: input.projectId },
          select: { id: true, publicKey: true },
        }),
      ]);

      const userMap = new Map(users.map((u) => [u.id, u]));
      const apiKeyMap = new Map(apiKeys.map((k) => [k.id, k]));

      // ACME (CHG-2026-101, ADR-0011): the content-free roles read each
      // entry's before/after with metadata fields only. Masked here, on the
      // server, so the content never reaches their browser.
      const masked = isContentFreeRole(ctx.session.projectRole);
      const rows = masked
        ? auditLogs.map((log) => ({ ...log, ...maskAuditLogStates(log) }))
        : auditLogs;

      return {
        data: mapActors(rows, userMap, apiKeyMap),
        totalCount,
        masked,
      };
    }),
});
