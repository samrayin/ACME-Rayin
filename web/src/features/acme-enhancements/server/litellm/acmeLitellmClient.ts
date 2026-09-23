/**
 * ACME addition (ADR-0003, CHG-2026-005): the ONLY code in this repo that
 * holds LiteLLM's master key and calls LiteLLM's management API.
 *
 * Rules this file exists to enforce:
 *  - Server-side only. Never import this from a component or a page.
 *  - The master key is never returned, logged, put in an error message or
 *    stored. Every error leaving this module goes through `redact()`.
 *  - Reads are retried with backoff; mutations are NEVER retried
 *    automatically -- /key/generate and friends are not idempotent, and a
 *    blind retry after a timeout could mint a second key.
 *  - Only endpoints present in the LiteLLM 1.100.1 OpenAPI schema are used
 *    (verified against the running gateway, 2026-09-19). /global/spend/*
 *    answers but is absent from the schema, so it is deliberately not here.
 *  - Response bodies are parsed leniently (unknown fields dropped): LiteLLM
 *    adds fields freely between releases. Strictness lives on the inbound
 *    receiver (CHG-2026-008), not here.
 */
import { z } from "zod";
import { env } from "@/src/env.mjs";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The flag is on but LITELLM_BASE_URL / LITELLM_MASTER_KEY are not set. */
export class LitellmNotConfiguredError extends Error {
  constructor() {
    super(
      "LiteLLM management is not configured: LITELLM_BASE_URL and LITELLM_MASTER_KEY must both be set.",
    );
    this.name = "LitellmNotConfiguredError";
  }
}

/** Network failure or timeout: the gateway could not be reached at all. */
export class LitellmUnreachableError extends Error {
  constructor(
    public readonly endpoint: string,
    detail: string,
  ) {
    super(`LiteLLM is unreachable (${endpoint}): ${detail}`);
    this.name = "LitellmUnreachableError";
  }
}

/** LiteLLM answered with a non-2xx status. */
export class LitellmHttpError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    detail: string,
  ) {
    super(`LiteLLM returned ${status} for ${endpoint}: ${detail}`);
    this.name = "LitellmHttpError";
  }
  /** LiteLLM's own message when a feature needs an Enterprise licence. */
  get isEnterpriseGated(): boolean {
    return /enterprise|premium/i.test(this.message);
  }
}

/** LiteLLM answered 2xx but not with the shape this client relies on. */
export class LitellmResponseShapeError extends Error {
  constructor(
    public readonly endpoint: string,
    detail: string,
  ) {
    super(`LiteLLM returned an unexpected response for ${endpoint}: ${detail}`);
    this.name = "LitellmResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const KEY_LIKE = /\bsk-[A-Za-z0-9_-]{6,}/g;

/**
 * Removes the master key and anything shaped like a LiteLLM key from a
 * string before it can reach a log line, an error message or a client.
 */
export function redact(
  text: string,
  masterKey: string | undefined,
  extraSecrets: readonly string[] = [],
): string {
  let out = text;
  for (const secret of [masterKey, ...extraSecrets]) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out.replace(KEY_LIKE, "[REDACTED]");
}

// ---------------------------------------------------------------------------
// Response schemas (lenient: unknown fields are dropped)
// ---------------------------------------------------------------------------

const metadataSchema = z.record(z.string(), z.unknown()).nullish();

export const litellmKeyRowSchema = z.object({
  // LiteLLM's SHA-256 of the key, never the key itself.
  token: z.string(),
  key_alias: z.string().nullish(),
  key_name: z.string().nullish(),
  spend: z.number().nullish(),
  max_budget: z.number().nullish(),
  budget_duration: z.string().nullish(),
  expires: z.string().nullish(),
  models: z.array(z.string()).nullish(),
  team_id: z.string().nullish(),
  rpm_limit: z.number().nullish(),
  tpm_limit: z.number().nullish(),
  blocked: z.boolean().nullish(),
  metadata: metadataSchema,
  created_at: z.string().nullish(),
  last_active: z.string().nullish(),
});
export type LitellmKeyRow = z.infer<typeof litellmKeyRowSchema>;

const keyListResponseSchema = z.object({
  keys: z.array(litellmKeyRowSchema),
  total_count: z.number().nullish(),
  current_page: z.number().nullish(),
  total_pages: z.number().nullish(),
});

const generateKeyResponseSchema = z.object({
  // The secret. Returned ONCE by LiteLLM; passed through to the caller of
  // generateKey and never stored or logged by this module.
  key: z.string().min(1),
  token: z.string().nullish(),
  token_id: z.string().nullish(),
  key_alias: z.string().nullish(),
  expires: z.string().nullish(),
});

const keyInfoResponseSchema = z.object({
  key: z.string(),
  info: litellmKeyRowSchema.omit({ token: true }).extend({
    token: z.string().nullish(),
  }),
});

export const litellmTeamRowSchema = z.object({
  team_id: z.string(),
  team_alias: z.string().nullish(),
  max_budget: z.number().nullish(),
  budget_duration: z.string().nullish(),
  spend: z.number().nullish(),
  models: z.array(z.string()).nullish(),
  rpm_limit: z.number().nullish(),
  tpm_limit: z.number().nullish(),
  blocked: z.boolean().nullish(),
  metadata: metadataSchema,
  members_with_roles: z
    .array(
      z.object({
        role: z.string().nullish(),
        user_id: z.string().nullish(),
      }),
    )
    .nullish(),
});
export type LitellmTeamRow = z.infer<typeof litellmTeamRowSchema>;

const teamListV2ResponseSchema = z.object({
  teams: z.array(litellmTeamRowSchema),
  total: z.number().nullish(),
  total_pages: z.number().nullish(),
});

const modelGroupInfoSchema = z.object({
  data: z.array(
    z.object({
      model_group: z.string(),
      providers: z.array(z.string()).nullish(),
      mode: z.string().nullish(),
      max_input_tokens: z.number().nullish(),
      max_output_tokens: z.number().nullish(),
      input_cost_per_token: z.number().nullish(),
      output_cost_per_token: z.number().nullish(),
    }),
  ),
});

const modelInfoSchema = z.object({
  data: z.array(
    z.object({
      model_name: z.string(),
      litellm_params: z.object({ model: z.string().nullish() }).nullish(),
      model_info: z.object({ id: z.string().nullish() }).nullish(),
    }),
  ),
});

// ADR-0010: the fields CAIRO reads from each deployment. Deliberately NOT
// api_key or any other credential field: they are never parsed, so they can
// never reach a response, a log line or the audit record.
export const litellmDeploymentSchema = z.object({
  model_name: z.string(),
  litellm_params: z
    .object({
      model: z.string().nullish(),
      api_base: z.string().nullish(),
      api_version: z.string().nullish(),
      rpm: z.number().nullish(),
      tpm: z.number().nullish(),
      complexity_router_config: z
        .object({
          classifier_type: z.string().nullish(),
          tiers: z
            .record(z.string(), z.union([z.string(), z.array(z.unknown())]))
            .nullish(),
        })
        .loose()
        .nullish(),
      complexity_router_default_model: z.string().nullish(),
    })
    .nullish(),
  model_info: z
    .object({ id: z.string().nullish(), db_model: z.boolean().nullish() })
    .nullish(),
});
export type LitellmDeployment = z.infer<typeof litellmDeploymentSchema>;

const deploymentListSchema = z.object({
  data: z.array(litellmDeploymentSchema),
});

const newModelResponseSchema = z
  .object({ model_id: z.string().nullish() })
  .loose();

const routerValidationSchema = z.object({
  valid: z.boolean(),
  error: z.string().nullish(),
});

const routingTestSchema = z.object({
  routed_model: z.string(),
  routed_model_configured: z.boolean().nullish(),
  routing_decision: z
    .object({ tier: z.string().nullish() })
    .loose()
    .nullish(),
});

const healthEndpointSchema = z.object({
  model: z.string().nullish(),
  error: z.unknown().optional(),
});
const healthResponseSchema = z.object({
  healthy_endpoints: z.array(healthEndpointSchema).nullish(),
  unhealthy_endpoints: z.array(healthEndpointSchema).nullish(),
  healthy_count: z.number().nullish(),
  unhealthy_count: z.number().nullish(),
});

const activityMetricsSchema = z.object({
  spend: z.number().nullish(),
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
  api_requests: z.number().nullish(),
  successful_requests: z.number().nullish(),
  failed_requests: z.number().nullish(),
});
export type LitellmActivityMetrics = z.infer<typeof activityMetricsSchema>;

// Breakdown entries are `{ metrics: {...}, ... }` on 1.100.1; tolerate the
// bare-metrics form as well rather than failing the whole view.
const breakdownEntrySchema = z.union([
  z.object({ metrics: activityMetricsSchema }),
  activityMetricsSchema.transform((metrics) => ({ metrics })),
]);

const dailyActivityResponseSchema = z.object({
  results: z.array(
    z.object({
      date: z.string(),
      metrics: activityMetricsSchema,
      breakdown: z
        .object({
          models: z.record(z.string(), breakdownEntrySchema).nullish(),
          model_groups: z.record(z.string(), breakdownEntrySchema).nullish(),
          api_keys: z.record(z.string(), breakdownEntrySchema).nullish(),
        })
        .nullish(),
    }),
  ),
  metadata: z
    .object({
      total_spend: z.number().nullish(),
      total_tokens: z.number().nullish(),
      total_api_requests: z.number().nullish(),
      page: z.number().nullish(),
      total_pages: z.number().nullish(),
      has_more: z.boolean().nullish(),
    })
    .nullish(),
});
export type LitellmDailyActivity = z.infer<typeof dailyActivityResponseSchema>;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export type LitellmKeySettings = {
  key_alias?: string;
  models?: string[];
  max_budget?: number | null;
  budget_duration?: string | null;
  rpm_limit?: number | null;
  tpm_limit?: number | null;
  /** LiteLLM duration string, e.g. "30d". */
  duration?: string | null;
  team_id?: string | null;
  /** Carried onto a rotated key so rotating cannot reset a budget. */
  spend?: number;
  metadata?: Record<string, unknown>;
};

/**
 * What CAIRO sends to /model/new and /model/{id}/update (ADR-0010). Built
 * only by acmeLitellmModels.ts from validated fields, never passed through
 * from a request.
 */
export type LitellmDeploymentWrite = {
  model_name?: string;
  litellm_params?: {
    model?: string;
    api_base?: string | null;
    api_version?: string | null;
    /** A provider key, or "os.environ/NAME". Never logged or returned. */
    api_key?: string;
    rpm?: number | null;
    tpm?: number | null;
    complexity_router_config?: Record<string, unknown>;
    complexity_router_default_model?: string;
  };
  model_info?: Record<string, unknown>;
};

export type LitellmTeamSettings = {
  team_id?: string;
  team_alias?: string;
  models?: string[];
  max_budget?: number | null;
  budget_duration?: string | null;
  rpm_limit?: number | null;
  tpm_limit?: number | null;
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type LitellmClientOptions = {
  baseUrl: string;
  masterKey: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  /** /health calls every provider for real, so it gets a longer budget. */
  healthTimeoutMs?: number;
  readRetryDelaysMs?: number[];
};

type RequestOptions = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** CAIRO user id, sent as litellm-changed-by on mutations. */
  changedBy?: string;
  timeoutMs?: number;
  /** Values to strip from any error text, e.g. a provider key being sent. */
  secrets?: readonly string[];
};

export function createLitellmClient(options: LitellmClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const masterKey = options.masterKey;
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn =
    options.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readTimeoutMs = options.readTimeoutMs ?? 8_000;
  const writeTimeoutMs = options.writeTimeoutMs ?? 15_000;
  const healthTimeoutMs = options.healthTimeoutMs ?? 60_000;
  const readRetryDelaysMs = options.readRetryDelaysMs ?? [200, 800];

  const safe = (text: string, secrets: readonly string[] = []) =>
    redact(text, masterKey, secrets);

  async function once(req: RequestOptions): Promise<unknown> {
    const url = new URL(baseUrl + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${masterKey}`,
    };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    if (req.changedBy) headers["litellm-changed-by"] = req.changedBy;

    let res: Response;
    try {
      res = await fetchFn(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(
          req.timeoutMs ??
            (req.method === "GET" ? readTimeoutMs : writeTimeoutMs),
        ),
      });
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      throw new LitellmUnreachableError(req.path, safe(detail, req.secrets));
    }

    const text = await res.text();
    if (!res.ok) {
      throw new LitellmHttpError(
        req.path,
        res.status,
        safe(extractErrorMessage(text), req.secrets).slice(0, 500),
      );
    }
    try {
      return text.length === 0 ? null : JSON.parse(text);
    } catch {
      throw new LitellmResponseShapeError(req.path, "body is not JSON");
    }
  }

  async function request(req: RequestOptions): Promise<unknown> {
    if (req.method !== "GET") return once(req);
    let lastError: unknown;
    for (let attempt = 0; attempt <= readRetryDelaysMs.length; attempt++) {
      try {
        return await once(req);
      } catch (e) {
        lastError = e;
        const retryable =
          e instanceof LitellmUnreachableError ||
          (e instanceof LitellmHttpError && e.status >= 500);
        if (!retryable || attempt === readRetryDelaysMs.length) throw e;
        await sleepFn(readRetryDelaysMs[attempt]!);
      }
    }
    throw lastError;
  }

  function parse<T>(schema: z.ZodType<T>, path: string, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new LitellmResponseShapeError(
        path,
        safe(
          result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        ),
      );
    }
    return result.data;
  }

  return {
    // ----- keys -----------------------------------------------------------
    async generateKey(settings: LitellmKeySettings, changedBy: string) {
      const path = "/key/generate";
      const body = await request({
        method: "POST",
        path,
        body: settings,
        changedBy,
      });
      return parse(generateKeyResponseSchema, path, body);
    },

    /** Every key in the gateway (paged through). Never includes key material. */
    async listAllKeys(): Promise<LitellmKeyRow[]> {
      const path = "/key/list";
      const all: LitellmKeyRow[] = [];
      for (let page = 1; page <= 50; page++) {
        const body = await request({
          method: "GET",
          path,
          query: { page, size: 100, return_full_object: true },
        });
        const parsed = parse(keyListResponseSchema, path, body);
        all.push(...parsed.keys);
        if (parsed.keys.length < 100) break;
        if (parsed.total_pages && page >= parsed.total_pages) break;
      }
      return all;
    },

    /** Looks a key up by its token hash. Returns null if LiteLLM has no such key. */
    async keyInfo(tokenHash: string) {
      const path = "/key/info";
      try {
        const body = await request({
          method: "GET",
          path,
          query: { key: tokenHash },
        });
        return parse(keyInfoResponseSchema, path, body).info;
      } catch (e) {
        if (e instanceof LitellmHttpError && e.status === 404) return null;
        throw e;
      }
    },

    /**
     * `key` is the token hash. `settings.metadata`, when given, REPLACES the
     * key's whole metadata object in LiteLLM -- callers must pass the merged
     * object (see mergeCairoMetadata), never just their own fields.
     */
    async updateKey(
      tokenHash: string,
      settings: LitellmKeySettings,
      changedBy: string,
    ) {
      const path = "/key/update";
      await request({
        method: "POST",
        path,
        body: { key: tokenHash, ...settings },
        changedBy,
      });
    },

    async deleteKey(tokenHash: string, changedBy: string) {
      const path = "/key/delete";
      await request({
        method: "POST",
        path,
        body: { keys: [tokenHash] },
        changedBy,
      });
    },

    // ----- teams ----------------------------------------------------------
    async newTeam(settings: LitellmTeamSettings, changedBy: string) {
      const path = "/team/new";
      const body = await request({
        method: "POST",
        path,
        body: settings,
        changedBy,
      });
      return parse(litellmTeamRowSchema, path, body);
    },

    async listAllTeams(): Promise<LitellmTeamRow[]> {
      const path = "/v2/team/list";
      const all: LitellmTeamRow[] = [];
      for (let page = 1; page <= 50; page++) {
        const body = await request({
          method: "GET",
          path,
          query: { page, page_size: 100 },
        });
        const parsed = parse(teamListV2ResponseSchema, path, body);
        all.push(...parsed.teams);
        if (parsed.teams.length < 100) break;
        if (parsed.total_pages && page >= parsed.total_pages) break;
      }
      return all;
    },

    async updateTeam(
      teamId: string,
      settings: LitellmTeamSettings,
      changedBy: string,
    ) {
      const path = "/team/update";
      await request({
        method: "POST",
        path,
        body: { ...settings, team_id: teamId },
        changedBy,
      });
    },

    async deleteTeam(teamId: string, changedBy: string) {
      const path = "/team/delete";
      await request({
        method: "POST",
        path,
        body: { team_ids: [teamId] },
        changedBy,
      });
    },

    // ----- models ---------------------------------------------------------
    async modelGroups() {
      const path = "/model_group/info";
      return parse(
        modelGroupInfoSchema,
        path,
        await request({ method: "GET", path }),
      ).data;
    },

    async models() {
      const path = "/model/info";
      return parse(
        modelInfoSchema,
        path,
        await request({ method: "GET", path }),
      ).data;
    },

    /**
     * Makes a REAL call to every configured provider. Slow and not free:
     * callers must cache the result (see acmeLitellmService.getCatalogue).
     */
    async health() {
      const path = "/health";
      return parse(
        healthResponseSchema,
        path,
        await request({ method: "GET", path, timeoutMs: healthTimeoutMs }),
      );
    },

    /** Every deployment, config-file and database-stored (ADR-0010). */
    async deployments(): Promise<LitellmDeployment[]> {
      const path = "/model/info";
      return parse(
        deploymentListSchema,
        path,
        await request({ method: "GET", path }),
      ).data;
    },

    /** ADR-0010. Needs store_model_in_db on the gateway. Never retried. */
    async newModel(body: LitellmDeploymentWrite, changedBy: string) {
      const path = "/model/new";
      const secret = body.litellm_params?.api_key;
      const res = await request({
        method: "POST",
        path,
        body,
        changedBy,
        secrets: secret ? [secret] : [],
      });
      return parse(newModelResponseSchema, path, res ?? {});
    },

    /** Partial update: only the fields given change. */
    async updateModel(
      modelId: string,
      body: LitellmDeploymentWrite,
      changedBy: string,
    ) {
      const path = `/model/${encodeURIComponent(modelId)}/update`;
      const secret = body.litellm_params?.api_key;
      await request({
        method: "PATCH",
        path,
        body,
        changedBy,
        secrets: secret ? [secret] : [],
      });
    },

    async deleteModel(modelId: string, changedBy: string) {
      const path = "/model/delete";
      await request({ method: "POST", path, body: { id: modelId }, changedBy });
    },

    /** The gateway's own verdict on a complexity-router config. Saves nothing. */
    async validateComplexityRouterConfig(config: Record<string, unknown>) {
      const path = "/auto_router/validate_complexity_router_config";
      return parse(
        routerValidationSchema,
        path,
        await request({
          method: "POST",
          path,
          body: { complexity_router_config: config },
        }),
      );
    },

    /**
     * Where one prompt would route under a config. Nothing is sent to the
     * routed model; a heuristic config makes no outbound call at all.
     */
    async testRouting(
      config: Record<string, unknown>,
      defaultModel: string,
      prompt: string,
    ) {
      const path = "/auto_router/test_routing";
      return parse(
        routingTestSchema,
        path,
        await request({
          method: "POST",
          path,
          body: {
            prompt,
            complexity_router_config: config,
            default_model: defaultModel,
          },
        }),
      );
    },

    // ----- spend ----------------------------------------------------------
    /** Daily activity for ONE key (token hash). Dates are YYYY-MM-DD. */
    async dailyActivityForKey(
      tokenHash: string,
      startDate: string,
      endDate: string,
    ) {
      const path = "/user/daily/activity";
      return parse(
        dailyActivityResponseSchema,
        path,
        await request({
          method: "GET",
          path,
          query: {
            api_key: tokenHash,
            start_date: startDate,
            end_date: endDate,
            page_size: 1000,
          },
        }),
      );
    },

    async dailyActivityForTeams(
      teamIds: string[],
      startDate: string,
      endDate: string,
    ) {
      const path = "/team/daily/activity";
      return parse(
        dailyActivityResponseSchema,
        path,
        await request({
          method: "GET",
          path,
          query: {
            team_ids: teamIds.join(","),
            start_date: startDate,
            end_date: endDate,
            page_size: 1000,
          },
        }),
      );
    },

    /** Cheap liveness probe: unauthenticated, makes no provider call. */
    async readiness(): Promise<boolean> {
      try {
        await request({
          method: "GET",
          path: "/health/readiness",
          timeoutMs: 3_000,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type LitellmClient = ReturnType<typeof createLitellmClient>;

function extractErrorMessage(text: string): string {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = j.error as Record<string, unknown> | string | undefined;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && typeof err.message === "string")
      return err.message;
    const detail = j.detail as Record<string, unknown> | string | undefined;
    if (typeof detail === "string") return detail;
    if (
      detail &&
      typeof detail === "object" &&
      typeof detail.error === "string"
    )
      return detail.error;
    return text;
  } catch {
    return text;
  }
}

let singleton: LitellmClient | null = null;

export function isLitellmManagementEnabled(): boolean {
  return env.CAIRO_LITELLM_MANAGEMENT_ENABLED === "true";
}

/** The process-wide client, built from env. Throws if not configured. */
export function getLitellmClient(): LitellmClient {
  if (!env.LITELLM_BASE_URL || !env.LITELLM_MASTER_KEY) {
    throw new LitellmNotConfiguredError();
  }
  if (singleton === null) {
    singleton = createLitellmClient({
      baseUrl: env.LITELLM_BASE_URL,
      masterKey: env.LITELLM_MASTER_KEY,
    });
  }
  return singleton;
}
