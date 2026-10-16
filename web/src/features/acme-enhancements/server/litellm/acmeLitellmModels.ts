/**
 * ACME addition (ADR-0010, CHG-2026-056): console-managed gateway models and
 * the smart (complexity) router.
 *
 * Invariants:
 *  - Only database-stored deployments (`model_info.db_model`) are changed.
 *    Config-file models are read-only here.
 *  - Every write goes through `auditedMutation`. The record carries a
 *    description of the credential (`provided` / `unchanged` /
 *    `reference NAME`), never the credential.
 *  - litellm_params are built here from validated fields only; nothing from
 *    the request is passed through.
 *  - Guardrail judge and safeguard models, and any model a router points at,
 *    can't be changed or removed from here. Guardrail models can't be router
 *    targets either (CHG-2026-164).
 *  - A router is always heuristic: no prompt text leaves the gateway to
 *    decide a route (ADR-0010 §5). Its config carries only the keys in
 *    ROUTER_CONFIG_KEYS (CHG-2026-164).
 */
import {
  type LitellmDeployment,
  type LitellmDeploymentWrite,
} from "./acmeLitellmClient";
import {
  checkKeywordRules,
  checkTierBoundaries,
  RECOMMENDED_KEYWORD_RULES,
  RECOMMENDED_TIER_BOUNDARIES,
  ROUTER_TIERS,
  type KeywordTierRule,
  type RouterTier,
  type TierBoundaries,
} from "../../utils/acmeRouterTuning";
import {
  auditedMutation,
  type LitellmEventActor,
} from "./acmeLitellmEventWriter";
import {
  EndpointRejectedError,
  parseProviderModel,
  validateApiBase,
  validateCredentialReference,
  type Resolver,
} from "./acmeLitellmEndpointGuard";
import {
  LitellmInvalidStateError,
  LitellmNotFoundError,
  type LitellmScope,
  type LitellmServiceDeps,
} from "./acmeLitellmService";

/**
 * The guardrails service depends on these; changing them breaks checks.
 * nvidia-nemotron and gemini-judge are retired from the gateway config
 * (CHG-2026-149) but stay reserved: the judge key's model list may still
 * name them, so a new model registered under either name would be
 * reachable with that key.
 */
const PROTECTED_MODEL_NAMES = [
  "nvidia-nemotron",
  "groq-judge",
  "groq-safeguard",
  "gemini-judge",
] as const;

const ROUTER_MODEL = "auto_router/complexity_router";
export type { RouterTier };

/**
 * CHG-2026-164: the only keys a router config may carry. Everything else the
 * gateway accepts stays out, in particular `classifier_llm_config`, `plugins`
 * and `semantic_keyword_matching` with its `embedding_model`, each of which
 * would send prompt text to another model (ADR-0010 §5).
 */
export const ROUTER_CONFIG_KEYS = [
  "classifier_type",
  "tiers",
  "tier_boundaries",
  "keyword_tier_rules",
] as const;

export type ModelsDeps = LitellmServiceDeps & {
  allowlist: readonly string[];
  resolve?: Resolver;
};

type CredentialInput =
  | { kind: "keep" }
  | { kind: "none" }
  | { kind: "reference"; name: string }
  | { kind: "secret"; value: string };

export type ModelInput = {
  modelName: string;
  providerModel: string;
  apiBase: string | null;
  apiVersion: string | null;
  rpm: number | null;
  tpm: number | null;
  credential: CredentialInput;
};

/**
 * Tuning fields: left out on create (or in a routing test), they take the
 * recommended tuning; left out on update, they keep the router's own. A null
 * boundary set or an empty rule list means the gateway's defaults.
 */
export type RouterInput = {
  modelName: string;
  tiers: Record<RouterTier, string>;
  defaultModel: string;
  tierBoundaries?: TierBoundaries | null;
  keywordRules?: KeywordTierRule[];
};

export type ModelView = {
  id: string;
  modelName: string;
  source: "config" | "console";
  kind: "model" | "router";
  providerModel: string | null;
  apiBaseHost: string | null;
  /** Console models only: the full endpoint, to pre-fill the edit form. */
  apiBase: string | null;
  apiVersion: string | null;
  rpm: number | null;
  tpm: number | null;
  tiers: Partial<Record<RouterTier, string>> | null;
  defaultModel: string | null;
  /** Routers only: null when the gateway's default boundaries apply. */
  tierBoundaries: TierBoundaries | null;
  /** Routers only (models: null). */
  keywordRules: KeywordTierRule[] | null;
  protected: boolean;
  usedByRouters: string[];
};

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

function hostOf(apiBase: string | null | undefined): string | null {
  if (!apiBase) return null;
  try {
    return new URL(apiBase).hostname;
  } catch {
    return null;
  }
}

function credentialRecord(c: CredentialInput): string {
  switch (c.kind) {
    case "keep":
      return "unchanged";
    case "none":
      return "none (provider default)";
    case "reference":
      return `reference ${c.name}`;
    case "secret":
      return "provided";
  }
}

function tiersOf(d: LitellmDeployment): Partial<Record<RouterTier, string>> {
  const raw = d.litellm_params?.complexity_router_config?.tiers ?? {};
  const out: Partial<Record<RouterTier, string>> = {};
  for (const t of ROUTER_TIERS) {
    const v = raw[t];
    if (typeof v === "string") out[t] = v;
  }
  return out;
}

/**
 * The tuning a stored router carries, as the console understands it. Shapes
 * it doesn't recognise read as "none" rather than failing the whole list.
 */
function tuningOf(d: LitellmDeployment): RouterTuning {
  const cfg = d.litellm_params?.complexity_router_config;
  const b = cfg?.tier_boundaries as Record<string, unknown> | null | undefined;
  const num = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
  const boundaries =
    b && typeof b === "object"
      ? checkTierBoundaries({
          simpleMedium: num(b.simple_medium),
          mediumComplex: num(b.medium_complex),
          complexReasoning: num(b.complex_reasoning),
        })
      : null;
  const storedRules = cfg?.keyword_tier_rules;
  const raw: unknown[] = Array.isArray(storedRules) ? storedRules : [];
  const rules = raw.flatMap((r) => {
    const rule = r as { keywords?: unknown; tier?: unknown } | null;
    if (!rule || !Array.isArray(rule.keywords)) return [];
    const keywords = rule.keywords.filter(
      (k): k is string => typeof k === "string",
    );
    const checked = checkKeywordRules([
      { tier: rule.tier as RouterTier, keywords },
    ]);
    return checked.ok ? checked.value : [];
  });
  return {
    tierBoundaries: boundaries?.ok ? boundaries.value : null,
    keywordRules: rules,
  };
}

function isRouter(d: LitellmDeployment): boolean {
  return d.litellm_params?.model === ROUTER_MODEL;
}

/** Model groups each router depends on (tiers and default). */
function routerTargets(d: LitellmDeployment): string[] {
  const t = Object.values(tiersOf(d));
  const def = d.litellm_params?.complexity_router_default_model;
  return [...new Set([...t, ...(def ? [def] : [])])];
}

export function toModelViews(deployments: LitellmDeployment[]): ModelView[] {
  const usedBy = new Map<string, string[]>();
  for (const d of deployments) {
    if (!isRouter(d)) continue;
    for (const target of routerTargets(d)) {
      usedBy.set(target, [...(usedBy.get(target) ?? []), d.model_name]);
    }
  }
  return deployments.map((d) => {
    const router = isRouter(d);
    const tuning = router ? tuningOf(d) : null;
    return {
      id: d.model_info?.id ?? "",
      modelName: d.model_name,
      source: d.model_info?.db_model ? "console" : "config",
      kind: router ? "router" : "model",
      providerModel: router ? null : (d.litellm_params?.model ?? null),
      apiBaseHost: hostOf(d.litellm_params?.api_base),
      // Console endpoints passed the guard, which refuses query strings and
      // credentials. Config-file endpoints are not shown in full.
      apiBase: d.model_info?.db_model
        ? (d.litellm_params?.api_base ?? null)
        : null,
      apiVersion: d.model_info?.db_model
        ? (d.litellm_params?.api_version ?? null)
        : null,
      rpm: d.litellm_params?.rpm ?? null,
      tpm: d.litellm_params?.tpm ?? null,
      tiers: router ? tiersOf(d) : null,
      defaultModel: router
        ? (d.litellm_params?.complexity_router_default_model ?? null)
        : null,
      tierBoundaries: tuning?.tierBoundaries ?? null,
      keywordRules: tuning?.keywordRules ?? null,
      protected: (PROTECTED_MODEL_NAMES as readonly string[]).includes(
        d.model_name,
      ),
      usedByRouters: usedBy.get(d.model_name) ?? [],
    };
  });
}

export async function listModels(deps: ModelsDeps): Promise<ModelView[]> {
  return toModelViews(await deps.client.deployments());
}

async function requireConsoleDeployment(
  deps: ModelsDeps,
  modelId: string,
): Promise<{ target: LitellmDeployment; all: LitellmDeployment[] }> {
  const all = await deps.client.deployments();
  const target = all.find((d) => d.model_info?.id === modelId);
  if (!target) throw new LitellmNotFoundError("Model");
  if (!target.model_info?.db_model) {
    throw new LitellmInvalidStateError(
      "This model is defined in the gateway configuration and can't be changed from the console.",
    );
  }
  if (
    (PROTECTED_MODEL_NAMES as readonly string[]).includes(target.model_name)
  ) {
    throw new LitellmInvalidStateError(
      "This model is used by the guardrails service and can't be changed from the console.",
    );
  }
  return { target, all };
}

function assertNewName(
  name: string,
  all: LitellmDeployment[],
  exceptId?: string,
) {
  if (!MODEL_NAME.test(name)) {
    throw new EndpointRejectedError(
      "The model name may use letters, digits, '.', '_', ':' and '-', up to 100 characters.",
    );
  }
  if ((PROTECTED_MODEL_NAMES as readonly string[]).includes(name)) {
    throw new LitellmInvalidStateError(
      "That name is reserved for the guardrails service.",
    );
  }
  // A second deployment under an existing name would join that model's
  // load-balancing group and take a share of its traffic.
  if (all.some((d) => d.model_name === name && d.model_info?.id !== exceptId)) {
    throw new LitellmInvalidStateError(
      `A model named "${name}" already exists.`,
    );
  }
}

/** Validates the input and builds litellm_params. Throws on any problem. */
async function buildModelParams(
  deps: ModelsDeps,
  input: ModelInput,
): Promise<{
  params: NonNullable<LitellmDeploymentWrite["litellm_params"]>;
  record: Record<string, unknown>;
}> {
  const { provider } = parseProviderModel(input.providerModel);
  let apiBase: string | null = null;
  if (input.apiBase && input.apiBase.trim() !== "") {
    apiBase = await validateApiBase(input.apiBase, {
      allowlist: deps.allowlist,
      resolve: deps.resolve,
    });
  }
  if (provider === "azure" && (!apiBase || !input.apiVersion)) {
    throw new EndpointRejectedError(
      "Azure models need an endpoint and an API version.",
    );
  }
  if (input.apiVersion && !/^[0-9A-Za-z.-]{1,40}$/.test(input.apiVersion)) {
    throw new EndpointRejectedError("The API version has invalid characters.");
  }
  const params: NonNullable<LitellmDeploymentWrite["litellm_params"]> = {
    model: input.providerModel,
    api_base: apiBase,
    api_version: input.apiVersion ?? null,
    rpm: input.rpm,
    tpm: input.tpm,
  };
  if (input.credential.kind === "reference") {
    params.api_key = `os.environ/${validateCredentialReference(input.credential.name)}`;
  } else if (input.credential.kind === "secret") {
    if (input.credential.value.trim().length < 8) {
      throw new EndpointRejectedError("The provider key looks too short.");
    }
    params.api_key = input.credential.value.trim();
  }
  return {
    params,
    record: {
      providerModel: input.providerModel,
      apiBaseHost: hostOf(apiBase),
      apiVersion: input.apiVersion ?? null,
      rpm: input.rpm,
      tpm: input.tpm,
      credential: credentialRecord(input.credential),
    },
  };
}

export async function createModel(
  deps: ModelsDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  input: ModelInput,
) {
  if (input.credential.kind === "keep") {
    throw new EndpointRejectedError("Choose how the provider key is supplied.");
  }
  if (input.providerModel.startsWith("auto_router/")) {
    throw new EndpointRejectedError(
      "Create routers with the smart router form.",
    );
  }
  const all = await deps.client.deployments();
  assertNewName(input.modelName, all);
  const { params, record } = await buildModelParams(deps, input);
  return auditedMutation(
    {
      action: "model.create",
      resourceType: "litellmModel",
      resourceId: input.modelName,
      actor,
      ...scope,
    },
    async () => {
      const res = await deps.client.newModel(
        { model_name: input.modelName, litellm_params: params },
        actor.userId,
      );
      const after = {
        modelName: input.modelName,
        id: res.model_id ?? null,
        ...record,
      };
      return { result: after, after };
    },
    deps.write,
  );
}

export async function updateModel(
  deps: ModelsDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  modelId: string,
  input: ModelInput,
) {
  const { target, all } = await requireConsoleDeployment(deps, modelId);
  if (isRouter(target)) {
    throw new LitellmInvalidStateError(
      "Edit routers with the smart router form.",
    );
  }
  if (input.credential.kind === "none") {
    // PATCH keeps fields that aren't sent, so "none" can't clear a stored key.
    throw new EndpointRejectedError(
      "To stop using a stored key, choose a key reference or enter a new key.",
    );
  }
  const renamed = input.modelName !== target.model_name;
  if (renamed) {
    assertNewName(input.modelName, all, modelId);
    const users = toModelViews(all).find(
      (v) => v.id === modelId,
    )?.usedByRouters;
    if (users && users.length > 0) {
      throw new LitellmInvalidStateError(
        `Routers depend on this name (${users.join(", ")}). Change them first.`,
      );
    }
  }
  const { params, record } = await buildModelParams(deps, input);
  return auditedMutation(
    {
      action: "model.update",
      resourceType: "litellmModel",
      resourceId: modelId,
      actor,
      ...scope,
      before: toModelViews([target])[0],
    },
    async () => {
      await deps.client.updateModel(
        modelId,
        { model_name: input.modelName, litellm_params: params },
        actor.userId,
      );
      const after = { modelName: input.modelName, id: modelId, ...record };
      return { result: after, after };
    },
    deps.write,
  );
}

export async function deleteModel(
  deps: ModelsDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  modelId: string,
) {
  const { target, all } = await requireConsoleDeployment(deps, modelId);
  const view = toModelViews(all).find((v) => v.id === modelId)!;
  if (view.usedByRouters.length > 0) {
    throw new LitellmInvalidStateError(
      `Routers depend on this model (${view.usedByRouters.join(", ")}). Change them first.`,
    );
  }
  return auditedMutation(
    {
      action: isRouter(target) ? "router.delete" : "model.delete",
      resourceType: "litellmModel",
      resourceId: modelId,
      actor,
      ...scope,
      before: toModelViews([target])[0],
    },
    async () => {
      await deps.client.deleteModel(modelId, actor.userId);
      return { result: { id: modelId }, after: { id: modelId, deleted: true } };
    },
    deps.write,
  );
}

export type RouterTuning = {
  tierBoundaries: TierBoundaries | null;
  keywordRules: KeywordTierRule[];
};

const NO_TUNING: RouterTuning = { tierBoundaries: null, keywordRules: [] };
const RECOMMENDED_TUNING: RouterTuning = {
  tierBoundaries: RECOMMENDED_TIER_BOUNDARIES,
  keywordRules: RECOMMENDED_KEYWORD_RULES,
};

/** Checks the tuning; fields the input leaves out come from `fallback`. */
function resolveTuning(
  input: Pick<RouterInput, "tierBoundaries" | "keywordRules">,
  fallback: RouterTuning,
): RouterTuning {
  const boundaries =
    input.tierBoundaries === undefined
      ? fallback.tierBoundaries
      : input.tierBoundaries;
  let tierBoundaries: TierBoundaries | null = null;
  if (boundaries) {
    const checked = checkTierBoundaries(boundaries);
    if (!checked.ok) throw new EndpointRejectedError(checked.error);
    tierBoundaries = checked.value;
  }
  const rules = checkKeywordRules(input.keywordRules ?? fallback.keywordRules);
  if (!rules.ok) throw new EndpointRejectedError(rules.error);
  return { tierBoundaries, keywordRules: rules.value };
}

/** Keeps only ROUTER_CONFIG_KEYS and refuses any classifier but heuristic. */
export function allowListedRouterConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.classifier_type !== "heuristic") {
    throw new EndpointRejectedError(
      "Routers use the heuristic classifier only.",
    );
  }
  return Object.fromEntries(
    Object.entries(config).filter(([key]) =>
      (ROUTER_CONFIG_KEYS as readonly string[]).includes(key),
    ),
  );
}

/**
 * ADR-0010 §5: always heuristic, never an LLM classifier, semantic keyword
 * matching or plugins. Built field by field from checked values, so nothing
 * from the request reaches the gateway as it came in.
 */
export function buildRouterConfig(
  tiers: Record<RouterTier, string>,
  tuning: RouterTuning = NO_TUNING,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    classifier_type: "heuristic",
    tiers: Object.fromEntries(ROUTER_TIERS.map((t) => [t, tiers[t]])),
  };
  if (tuning.tierBoundaries) {
    config.tier_boundaries = {
      simple_medium: tuning.tierBoundaries.simpleMedium,
      medium_complex: tuning.tierBoundaries.mediumComplex,
      complex_reasoning: tuning.tierBoundaries.complexReasoning,
    };
  }
  if (tuning.keywordRules.length > 0) {
    config.keyword_tier_rules = tuning.keywordRules.map((r) => ({
      keywords: [...r.keywords],
      tier: r.tier,
    }));
  }
  return allowListedRouterConfig(config);
}

function assertRouterTargets(
  input: Pick<RouterInput, "tiers" | "defaultModel">,
  all: LitellmDeployment[],
) {
  const models = new Set(
    all.filter((d) => !isRouter(d)).map((d) => d.model_name),
  );
  const targets = [
    ...ROUTER_TIERS.map((t) => input.tiers[t]),
    input.defaultModel,
  ];
  for (const target of targets) {
    // Gate C finding 4: callers could reach a guardrail model through a router.
    if ((PROTECTED_MODEL_NAMES as readonly string[]).includes(target)) {
      throw new EndpointRejectedError(
        `"${target}" is used by the guardrails service and can't be a router target.`,
      );
    }
    if (!models.has(target)) {
      throw new EndpointRejectedError(
        `"${target}" is not a model on the gateway (routers can only point at models, not other routers).`,
      );
    }
  }
}

async function validatedRouterConfig(
  deps: ModelsDeps,
  input: RouterInput,
  tuning: RouterTuning,
) {
  const config = buildRouterConfig(input.tiers, tuning);
  const verdict = await deps.client.validateComplexityRouterConfig(config);
  if (!verdict.valid) {
    throw new EndpointRejectedError(
      `The gateway rejected the router: ${verdict.error ?? "invalid configuration"}`,
    );
  }
  return config;
}

function routerRecord(input: RouterInput, tuning: RouterTuning) {
  return {
    tiers: input.tiers,
    defaultModel: input.defaultModel,
    classifier: "heuristic",
    tierBoundaries: tuning.tierBoundaries,
    keywordRules: tuning.keywordRules,
  };
}

export async function createRouter(
  deps: ModelsDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  input: RouterInput,
) {
  const all = await deps.client.deployments();
  assertNewName(input.modelName, all);
  assertRouterTargets(input, all);
  const tuning = resolveTuning(input, RECOMMENDED_TUNING);
  const config = await validatedRouterConfig(deps, input, tuning);
  const record = routerRecord(input, tuning);
  return auditedMutation(
    {
      action: "router.create",
      resourceType: "litellmModel",
      resourceId: input.modelName,
      actor,
      ...scope,
    },
    async () => {
      const res = await deps.client.newModel(
        {
          model_name: input.modelName,
          litellm_params: {
            model: ROUTER_MODEL,
            complexity_router_config: config,
            complexity_router_default_model: input.defaultModel,
          },
        },
        actor.userId,
      );
      const after = {
        modelName: input.modelName,
        id: res.model_id ?? null,
        ...record,
      };
      return { result: after, after };
    },
    deps.write,
  );
}

export async function updateRouter(
  deps: ModelsDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  modelId: string,
  input: RouterInput,
) {
  const { target, all } = await requireConsoleDeployment(deps, modelId);
  if (!isRouter(target)) {
    throw new LitellmInvalidStateError("This is a model, not a router.");
  }
  if (input.modelName !== target.model_name) {
    assertNewName(input.modelName, all, modelId);
  }
  assertRouterTargets(input, all);
  const tuning = resolveTuning(input, tuningOf(target));
  const config = await validatedRouterConfig(deps, input, tuning);
  const record = routerRecord(input, tuning);
  return auditedMutation(
    {
      action: "router.update",
      resourceType: "litellmModel",
      resourceId: modelId,
      actor,
      ...scope,
      before: toModelViews([target])[0],
    },
    async () => {
      await deps.client.updateModel(
        modelId,
        {
          model_name: input.modelName,
          litellm_params: {
            model: ROUTER_MODEL,
            complexity_router_config: config,
            complexity_router_default_model: input.defaultModel,
          },
        },
        actor.userId,
      );
      const after = { modelName: input.modelName, id: modelId, ...record };
      return { result: after, after };
    },
    deps.write,
  );
}

/** Read-only: which tier and model a sample prompt lands on. Stores nothing. */
export async function testRouting(
  deps: ModelsDeps,
  input: Omit<RouterInput, "modelName"> & { prompt: string },
) {
  const all = await deps.client.deployments();
  assertRouterTargets(input, all);
  const tuning = resolveTuning(input, RECOMMENDED_TUNING);
  const res = await deps.client.testRouting(
    buildRouterConfig(input.tiers, tuning),
    input.defaultModel,
    input.prompt,
  );
  return {
    routedModel: res.routed_model,
    tier: res.routing_decision?.tier ?? null,
  };
}
