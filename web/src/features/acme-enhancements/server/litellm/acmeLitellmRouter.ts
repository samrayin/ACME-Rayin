/**
 * ACME addition (ADR-0003, CHG-2026-005): CAIRO as the only control plane for
 * the LiteLLM gateway.
 *
 * Every procedure:
 *  - is behind CAIRO_LITELLM_MANAGEMENT_ENABLED (default off). `status` is the
 *    one exception: it is how the UI learns the feature is off.
 *  - enforces a CAIRO project scope with throwIfNoProjectAccess. CAIRO RBAC is
 *    authoritative; LiteLLM's own users and roles are never consulted.
 *  - is scoped to input.projectId on the server. A key or team id from
 *    another project does not resolve.
 *  - never returns key material, except `createKey` / `rotateKey`, which
 *    return the new secret exactly once, straight from LiteLLM's response.
 *
 * Security Analyst: only `status` and `events` are on the allow-list
 * (securityRoleAllowList.ts); everything else is blocked for that role.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProjectProcedure,
  protectedProjectProcedureWithoutTracing,
} from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import {
  getLitellmClient,
  isLitellmManagementEnabled,
  LitellmHttpError,
  LitellmNotConfiguredError,
  LitellmResponseShapeError,
  LitellmUnreachableError,
} from "./acmeLitellmClient";
import {
  LitellmAuditIntentError,
  LitellmAuditOutcomeError,
  writeLitellmEvent,
  type LitellmEventActor,
} from "./acmeLitellmEventWriter";
import {
  createKey,
  createTeam,
  deleteTeam,
  getCatalogue,
  getProjectSpend,
  listProjectKeys,
  listProjectTeams,
  listUnmanagedKeys,
  LitellmInvalidStateError,
  LitellmNotFoundError,
  LitellmRotationPartialError,
  LitellmRotationRolledBackError,
  resolvePartialRotation,
  revokeKey,
  rotateKey,
  updateKeyLimits,
  updateTeamLimits,
  type LitellmServiceDeps,
} from "./acmeLitellmService";
import {
  EndpointRejectedError,
  parseAllowlist,
} from "./acmeLitellmEndpointGuard";
import {
  createModel,
  createRouter,
  deleteModel,
  listModels,
  testRouting,
  updateModel,
  updateRouter,
  type ModelsDeps,
} from "./acmeLitellmModels";

const limitsInput = {
  models: z.array(z.string().min(1).max(200)).max(100).default([]),
  maxBudget: z.number().positive().max(1_000_000).nullable().default(null),
  // LiteLLM duration string: 30s / 30m / 30h / 30d / 1mo.
  budgetDuration: z
    .string()
    .regex(/^\d{1,4}(s|m|h|d|mo)$/)
    .nullable()
    .default(null),
  rpmLimit: z
    .number()
    .int()
    .positive()
    .max(10_000_000)
    .nullable()
    .default(null),
  tpmLimit: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000)
    .nullable()
    .default(null),
};

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function assertEnabled() {
  if (!isLitellmManagementEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "LiteLLM management is switched off on this deployment (CAIRO_LITELLM_MANAGEMENT_ENABLED).",
    });
  }
}

function assertRequestLogsEnabled() {
  assertEnabled();
  if (env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED !== "true") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Gateway request logs are switched off on this deployment (CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED).",
    });
  }
}

// ADR-0010 (CHG-2026-056). Separate from CAIRO_LITELLM_MANAGEMENT_ENABLED:
// keys and teams can be managed while models stay read-only.
function isModelManagementEnabled(): boolean {
  return env.CAIRO_LITELLM_MODEL_MANAGEMENT_ENABLED === "true";
}

function assertModelManagementEnabled() {
  assertEnabled();
  if (!isModelManagementEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Model management is switched off on this deployment (CAIRO_LITELLM_MODEL_MANAGEMENT_ENABLED).",
    });
  }
}

function modelsDeps(): ModelsDeps {
  return {
    ...deps(),
    allowlist: parseAllowlist(env.CAIRO_LITELLM_MODEL_ENDPOINT_ALLOWLIST),
  };
}

const modelNameInput = z.string().min(1).max(100);

// The provider key is length-checked only. No pattern: a failed pattern
// check must never be a reason to echo the value back.
const credentialInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }),
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("reference"), name: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("secret"), value: z.string().min(1).max(4096) }),
]);

const modelInput = z.object({
  projectId: z.string(),
  modelName: modelNameInput,
  providerModel: z.string().min(3).max(220),
  apiBase: z.string().max(500).nullable().default(null),
  apiVersion: z.string().max(40).nullable().default(null),
  rpm: z.number().int().positive().max(10_000_000).nullable().default(null),
  tpm: z.number().int().positive().max(1_000_000_000).nullable().default(null),
  credential: credentialInput,
});

const tiersInput = z.object({
  SIMPLE: modelNameInput,
  MEDIUM: modelNameInput,
  COMPLEX: modelNameInput,
  REASONING: modelNameInput,
});

const routerInput = z.object({
  projectId: z.string(),
  modelName: modelNameInput,
  tiers: tiersInput,
  defaultModel: modelNameInput,
});

function deps(): LitellmServiceDeps {
  return { client: getLitellmClient(), db: prisma, write: writeLitellmEvent };
}

function actorOf(session: {
  user: { id: string };
  orgRole?: string | null;
  projectRole?: string | null;
}): LitellmEventActor {
  return {
    userId: session.user.id,
    orgRole: session.orgRole ?? null,
    projectRole: session.projectRole ?? null,
  };
}

/**
 * Maps this feature's typed errors to tRPC errors. Messages from the client
 * module are already redacted; nothing here adds request detail.
 */
async function guarded<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    if (e instanceof LitellmNotFoundError)
      throw new TRPCError({ code: "NOT_FOUND", message: e.message });
    if (e instanceof LitellmInvalidStateError)
      throw new TRPCError({ code: "CONFLICT", message: e.message });
    if (e instanceof EndpointRejectedError)
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    if (e instanceof LitellmNotConfiguredError)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    if (e instanceof LitellmUnreachableError) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message:
          "The LiteLLM gateway is unreachable, so nothing was changed. Management is read-only until it is back.",
      });
    }
    if (e instanceof LitellmHttpError) {
      throw new TRPCError({
        code: e.status >= 500 ? "BAD_GATEWAY" : "BAD_REQUEST",
        message: e.isEnterpriseGated
          ? "LiteLLM refused this: it needs a LiteLLM Enterprise licence, which this deployment does not have."
          : `LiteLLM refused this request (${e.status}): ${e.message}`,
      });
    }
    if (e instanceof LitellmResponseShapeError)
      throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
    if (
      e instanceof LitellmAuditIntentError ||
      e instanceof LitellmAuditOutcomeError ||
      e instanceof LitellmRotationPartialError ||
      e instanceof LitellmRotationRolledBackError
    ) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: e.message,
      });
    }
    logger.error(`acmeLitellm.${what} failed`, {
      error: e instanceof Error ? e.message : String(e),
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${what} failed.`,
    });
  }
}

export const acmeLitellmRouter = createTRPCRouter({
  /** Is the feature on, configured and reachable? Never throws for "off". */
  status: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "project:read",
      });
      const enabled = isLitellmManagementEnabled();
      const configured = Boolean(
        env.LITELLM_BASE_URL && env.LITELLM_MASTER_KEY,
      );
      const auditConfigured = Boolean(env.RAYIN_LITELLM_WRITER_DATABASE_URL);
      const reachable =
        enabled && configured ? await getLitellmClient().readiness() : null;
      const requestLogsEnabled =
        env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED === "true";
      return {
        enabled,
        configured,
        auditConfigured,
        reachable,
        requestLogsEnabled,
        modelManagementEnabled: enabled && isModelManagementEnabled(),
      };
    }),

  // ----- keys -------------------------------------------------------------
  keys: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:read",
      });
      assertEnabled();
      return guarded("keys", () =>
        listProjectKeys(deps(), {
          orgId: ctx.session.orgId,
          projectId: input.projectId,
        }),
      );
    }),

  /**
   * Keys that exist in LiteLLM but were not issued by CAIRO. They belong to no
   * project, so only an organisation OWNER may see them. Read-only.
   */
  unmanagedKeys: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:read",
      });
      assertEnabled();
      if (ctx.session.orgRole !== "OWNER" && !ctx.session.user.admin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Keys created outside CAIRO belong to no project and are visible to organisation owners only.",
        });
      }
      return guarded("unmanagedKeys", () => listUnmanagedKeys(deps()));
    }),

  createKey: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        displayName: z.string().trim().min(1).max(80),
        teamId: z.string().nullable().default(null),
        expiresInDays: z
          .number()
          .int()
          .positive()
          .max(3650)
          .nullable()
          .default(null),
        ...limitsInput,
      }),
    )
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      const { projectId, ...rest } = input;
      return guarded("createKey", () =>
        createKey(
          deps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          rest,
        ),
      );
    }),

  updateKey: protectedProjectProcedure
    .input(
      z.object({ projectId: z.string(), keyId: z.string(), ...limitsInput }),
    )
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      const { projectId, keyId, ...limits } = input;
      return guarded("updateKey", () =>
        updateKeyLimits(
          deps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          keyId,
          limits,
        ),
      );
    }),

  revokeKey: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), keyId: z.string() }))
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      return guarded("revokeKey", () =>
        revokeKey(
          deps(),
          { orgId: ctx.session.orgId, projectId: input.projectId },
          actorOf(ctx.session),
          input.keyId,
        ),
      );
    }),

  /** Compose-and-revoke. NOT native rotation (Enterprise-gated in LiteLLM). */
  rotateKey: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), keyId: z.string() }))
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      return guarded("rotateKey", () =>
        rotateKey(
          deps(),
          { orgId: ctx.session.orgId, projectId: input.projectId },
          actorOf(ctx.session),
          input.keyId,
        ),
      );
    }),

  resolvePartialRotation: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), keyId: z.string() }))
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      return guarded("resolvePartialRotation", () =>
        resolvePartialRotation(
          deps(),
          { orgId: ctx.session.orgId, projectId: input.projectId },
          actorOf(ctx.session),
          input.keyId,
        ),
      );
    }),

  // ----- teams ------------------------------------------------------------
  teams: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:read",
      });
      assertEnabled();
      return guarded("teams", () =>
        listProjectTeams(deps(), {
          orgId: ctx.session.orgId,
          projectId: input.projectId,
        }),
      );
    }),

  createTeam: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        teamAlias: z.string().trim().min(1).max(80),
        ...limitsInput,
      }),
    )
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      const { projectId, ...rest } = input;
      return guarded("createTeam", () =>
        createTeam(
          deps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          rest,
        ),
      );
    }),

  updateTeam: protectedProjectProcedure
    .input(
      z.object({ projectId: z.string(), teamId: z.string(), ...limitsInput }),
    )
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      const { projectId, teamId, ...limits } = input;
      return guarded("updateTeam", () =>
        updateTeamLimits(
          deps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          teamId,
          limits,
        ),
      );
    }),

  deleteTeam: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), teamId: z.string() }))
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:CUD",
      });
      assertEnabled();
      return guarded("deleteTeam", () =>
        deleteTeam(
          deps(),
          { orgId: ctx.session.orgId, projectId: input.projectId },
          actorOf(ctx.session),
          input.teamId,
        ),
      );
    }),

  // ----- models and smart router (ADR-0010) ------------------------------
  models: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:read",
      });
      assertEnabled();
      return guarded("models", () => listModels(modelsDeps()));
    }),

  // Untraced: the input can carry a provider key (ADR-0010 §4).
  createModel: protectedProjectProcedureWithoutTracing
    .input(modelInput)
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayModels:CUD",
      });
      assertModelManagementEnabled();
      const { projectId, ...model } = input;
      return guarded("createModel", () =>
        createModel(
          modelsDeps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          model,
        ),
      );
    }),

  // Untraced: the input can carry a provider key (ADR-0010 §4).
  updateModel: protectedProjectProcedureWithoutTracing
    .input(modelInput.extend({ modelId: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayModels:CUD",
      });
      assertModelManagementEnabled();
      const { projectId, modelId, ...model } = input;
      return guarded("updateModel", () =>
        updateModel(
          modelsDeps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          modelId,
          model,
        ),
      );
    }),

  deleteModel: protectedProjectProcedure
    .input(
      z.object({ projectId: z.string(), modelId: z.string().min(1).max(200) }),
    )
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayModels:CUD",
      });
      assertModelManagementEnabled();
      return guarded("deleteModel", () =>
        deleteModel(
          modelsDeps(),
          { orgId: ctx.session.orgId, projectId: input.projectId },
          actorOf(ctx.session),
          input.modelId,
        ),
      );
    }),

  createRouter: protectedProjectProcedure
    .input(routerInput)
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayModels:CUD",
      });
      assertModelManagementEnabled();
      const { projectId, ...router } = input;
      return guarded("createRouter", () =>
        createRouter(
          modelsDeps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          router,
        ),
      );
    }),

  updateRouter: protectedProjectProcedure
    .input(routerInput.extend({ modelId: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayModels:CUD",
      });
      assertModelManagementEnabled();
      const { projectId, modelId, ...router } = input;
      return guarded("updateRouter", () =>
        updateRouter(
          modelsDeps(),
          { orgId: ctx.session.orgId, projectId },
          actorOf(ctx.session),
          modelId,
          router,
        ),
      );
    }),

  // Untraced: the sample prompt is content. Nothing is stored or routed.
  testRouting: protectedProjectProcedureWithoutTracing
    .input(
      z.object({
        projectId: z.string(),
        tiers: tiersInput,
        defaultModel: modelNameInput,
        prompt: z.string().min(1).max(4000),
      }),
    )
    .mutation(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayModels:CUD",
      });
      assertModelManagementEnabled();
      const { tiers, defaultModel, prompt } = input;
      return guarded("testRouting", () =>
        testRouting(modelsDeps(), { tiers, defaultModel, prompt }),
      );
    }),

  // ----- catalogue and spend ---------------------------------------------
  catalogue: protectedProjectProcedure
    .input(
      z.object({ projectId: z.string(), refresh: z.boolean().default(false) }),
    )
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:read",
      });
      assertEnabled();
      // A forced refresh calls every provider for real: CUD holders only.
      if (input.refresh) {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "llmGateway:CUD",
        });
      }
      return guarded("catalogue", () => getCatalogue(deps(), input.refresh));
    }),

  spend: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: dateInput,
        endDate: dateInput,
      }),
    )
    .query(({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGateway:read",
      });
      assertEnabled();
      if (input.startDate > input.endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "startDate must not be after endDate.",
        });
      }
      return guarded("spend", () =>
        getProjectSpend(
          deps(),
          { orgId: ctx.session.orgId, projectId: input.projectId },
          input.startDate,
          input.endDate,
        ),
      );
    }),

  // ----- the append-only record ------------------------------------------
  /** Read through the general connection, which holds SELECT only on this table. */
  events: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        page: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        correlationId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayLogs:read",
      });
      assertEnabled();
      const where = {
        projectId: input.projectId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      };
      const [rows, totalCount] = await Promise.all([
        ctx.prisma.acmeLitellmEvent.findMany({
          where,
          orderBy: [{ eventTime: "desc" }, { id: "desc" }],
          skip: input.page * input.limit,
          take: input.limit,
        }),
        ctx.prisma.acmeLitellmEvent.count({ where }),
      ]);
      const userIds = [...new Set(rows.map((r) => r.actorUserId))];
      const users = await ctx.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      const userById = new Map(users.map((u) => [u.id, u]));
      return {
        totalCount,
        events: rows.map((r) => ({
          ...r,
          eventTime: r.eventTime.toISOString(),
          actor: userById.get(r.actorUserId) ?? {
            id: r.actorUserId,
            name: null,
            email: null,
          },
        })),
      };
    }),
  // ----- gateway request logs (CHG-2026-008) ------------------------------
  /**
   * CAIRO's append-only mirror of gateway requests. Metadata only. `scope:
   * "project"` = requests made with keys this project issued. `scope:
   * "unattributed"` = requests made with keys CAIRO did not issue; they
   * belong to no project, so only an organisation OWNER may see them.
   */
  requestLogs: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        scope: z.enum(["project", "unattributed"]).default("project"),
        page: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayLogs:read",
      });
      assertRequestLogsEnabled();
      if (
        input.scope === "unattributed" &&
        ctx.session.orgRole !== "OWNER" &&
        !ctx.session.user.admin
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Requests made with keys created outside CAIRO belong to no project and are visible to organisation owners only.",
        });
      }
      // The project comes from the session-checked input, never from a row.
      const where =
        input.scope === "project"
          ? { projectId: input.projectId }
          : { projectId: null };
      const [rows, totalCount] = await Promise.all([
        ctx.prisma.acmeLitellmRequestLog.findMany({
          where,
          orderBy: [{ startTime: "desc" }, { id: "desc" }],
          skip: input.page * input.limit,
          take: input.limit,
        }),
        ctx.prisma.acmeLitellmRequestLog.count({ where }),
      ]);
      const keyIds = [
        ...new Set(
          rows.map((r) => r.cairoKeyId).filter((k): k is string => k !== null),
        ),
      ];
      const keys = keyIds.length
        ? await ctx.prisma.acmeLitellmKey.findMany({
            where: { id: { in: keyIds }, projectId: input.projectId },
            select: { id: true, displayName: true },
          })
        : [];
      const nameById = new Map(keys.map((k) => [k.id, k.displayName]));
      return {
        totalCount,
        logs: rows.map((r) => ({
          id: r.id,
          requestId: r.requestId,
          source: r.source,
          startTime: r.startTime.toISOString(),
          durationMs: r.endTime
            ? r.endTime.getTime() - r.startTime.getTime()
            : null,
          status: r.status,
          errorClass: r.errorClass,
          modelGroup: r.modelGroup ?? r.model,
          provider: r.provider,
          keyName: r.cairoKeyId ? (nameById.get(r.cairoKeyId) ?? null) : null,
          keyAlias: r.keyAlias,
          endUser: r.endUser,
          requesterIp: r.requesterIp,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          totalTokens: r.totalTokens,
          spend: r.spend,
          cacheHit: r.cacheHit,
        })),
      };
    }),

  /**
   * Is the mirror complete? Last reconciliation, its gap count, and how the
   * last 24 hours of records arrived. Gateway-wide counts, no request detail.
   */
  reconcileStatus: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmGatewayLogs:read",
      });
      assertRequestLogsEnabled();
      const since = new Date(Date.now() - 24 * 3_600_000);
      const [lastRun, lastSuccess, recentRuns, pushed24h, reconciled24h] =
        await Promise.all([
          ctx.prisma.acmeLitellmReconcileRun.findFirst({
            orderBy: { finishedAt: "desc" },
          }),
          ctx.prisma.acmeLitellmReconcileRun.findFirst({
            where: { status: "success" },
            orderBy: { finishedAt: "desc" },
          }),
          ctx.prisma.acmeLitellmReconcileRun.findMany({
            where: { finishedAt: { gte: since } },
            orderBy: { finishedAt: "desc" },
            take: 300,
          }),
          ctx.prisma.acmeLitellmRequestLog.count({
            where: { source: "PUSH", receivedAt: { gte: since } },
          }),
          ctx.prisma.acmeLitellmRequestLog.count({
            where: { source: "RECONCILE", receivedAt: { gte: since } },
          }),
        ]);
      const view = (r: typeof lastRun) =>
        r && {
          finishedAt: r.finishedAt.toISOString(),
          windowStart: r.windowStart.toISOString(),
          windowEnd: r.windowEnd.toISOString(),
          status: r.status,
          rowsChecked: r.rowsChecked,
          gapCount: r.gapCount,
          inserted: r.inserted,
          errorMessage: r.errorMessage,
        };
      const STALE_AFTER_MS = 15 * 60_000;
      return {
        lastRun: view(lastRun),
        lastSuccess: view(lastSuccess),
        // No successful pass in 15 minutes = the completeness claim is stale.
        stale:
          !lastSuccess ||
          Date.now() - lastSuccess.finishedAt.getTime() > STALE_AFTER_MS,
        runs24h: recentRuns.length,
        failedRuns24h: recentRuns.filter((r) => r.status !== "success").length,
        gapCount24h: recentRuns.reduce((n, r) => n + r.gapCount, 0),
        pushed24h,
        reconciled24h,
      };
    }),
});
