import { describe, it, expect, vi } from "vitest";
import {
  createLitellmClient,
  LitellmHttpError,
  type LitellmClient,
  type LitellmDeployment,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmClient";
import { type LitellmEventInput } from "@/src/features/acme-enhancements/server/litellm/acmeLitellmEventWriter";
import {
  EndpointRejectedError,
  hostAllowed,
  isBlockedAddress,
  parseAllowlist,
  parseProviderModel,
  validateApiBase,
  validateCredentialReference,
  DEFAULT_ENDPOINT_ALLOWLIST,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmEndpointGuard";
import {
  allowListedRouterConfig,
  buildRouterConfig,
  createModel,
  createRouter,
  deleteModel,
  ROUTER_CONFIG_KEYS,
  testRouting,
  toModelViews,
  updateModel,
  updateRouter,
  type ModelInput,
  type ModelsDeps,
  type RouterInput,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmModels";
import {
  RECOMMENDED_KEYWORD_RULES,
  RECOMMENDED_TIER_BOUNDARIES,
} from "@/src/features/acme-enhancements/utils/acmeRouterTuning";
import {
  LitellmInvalidStateError,
  type LitellmDb,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmService";

// ADR-0010 / CHG-2026-056. No network, no database: LiteLLM is a fake, DNS is
// a fake resolver, the audit writer is a recorder.

const SCOPE = { orgId: "org-1", projectId: "proj-1" };
const ACTOR = { userId: "user-1", orgRole: "OWNER", projectRole: "OWNER" };
const SECRET = "gsk_live_provider_key_0123456789abcdef";
const publicDns = async () => ["104.18.2.1"];

function dep(
  name: string,
  id: string,
  db: boolean,
  params: Record<string, unknown> = {},
): LitellmDeployment {
  return {
    model_name: name,
    litellm_params: { model: `groq/${name}`, ...params },
    model_info: { id, db_model: db },
  } as LitellmDeployment;
}

const CONFIG_MODELS = [
  dep("claude-sonnet", "cfg-1", false, { model: "anthropic/claude-sonnet-5" }),
  dep("nvidia-nemotron", "cfg-2", false),
  dep("groq-judge", "cfg-3", false),
  dep("groq-fast", "cfg-4", false),
];

function harness(extra: LitellmDeployment[] = []) {
  const deployments = [...CONFIG_MODELS, ...extra];
  const events: LitellmEventInput[] = [];
  const client = {
    deployments: vi.fn(async () => deployments),
    newModel: vi.fn(async () => ({ model_id: "new-id" })),
    updateModel: vi.fn(async () => undefined),
    deleteModel: vi.fn(async () => undefined),
    validateComplexityRouterConfig: vi.fn(async () => ({ valid: true })),
    testRouting: vi.fn(async () => ({
      routed_model: "claude-sonnet",
      routing_decision: { tier: "COMPLEX" },
    })),
  } as unknown as LitellmClient;
  const deps: ModelsDeps = {
    client,
    db: {} as LitellmDb,
    write: async (e) => {
      events.push(e);
    },
    allowlist: [...DEFAULT_ENDPOINT_ALLOWLIST],
    resolve: publicDns,
  };
  return { deps, client, events };
}

const MODEL: ModelInput = {
  modelName: "groq-llama",
  providerModel: "groq/llama-3.3-70b",
  apiBase: null,
  apiVersion: null,
  rpm: 60,
  tpm: null,
  credential: { kind: "secret", value: SECRET },
};

describe("endpoint guard (ADR-0010 §6)", () => {
  it("accepts an allowlisted public https endpoint", async () => {
    await expect(
      validateApiBase("https://api.groq.com/openai/v1", {
        allowlist: DEFAULT_ENDPOINT_ALLOWLIST,
        resolve: publicDns,
      }),
    ).resolves.toBe("https://api.groq.com/openai/v1");
  });

  it.each([
    ["http://api.groq.com", /https/],
    ["https://user:pw@api.groq.com", /credentials/],
    ["https://api.groq.com:8443", /default https port/],
    ["https://api.groq.com/v1?key=abc", /query string/],
    ["https://169.254.169.254/latest", /not an IP/],
    ["https://2852039166/", /not an IP/], // decimal form of 169.254.169.254
    ["https://0xa9fea9fe/", /not an IP/], // hex form
    ["https://[::1]/", /not an IP/],
    ["https://localhost/", /public host/],
    ["https://litellm.rayin-platform.svc.cluster.local/", /public host/],
    ["https://rayin-guardrails/", /public host/],
    ["https://evil.example.com/", /allowlist/],
    ["not a url", /valid URL/],
  ])("rejects %s", async (url, reason) => {
    await expect(
      validateApiBase(url, {
        allowlist: DEFAULT_ENDPOINT_ALLOWLIST,
        resolve: publicDns,
      }),
    ).rejects.toThrow(reason);
  });

  it.each([
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("refuses an allowed host that resolves to %s", async (address) => {
    await expect(
      validateApiBase("https://api.openai.com", {
        allowlist: DEFAULT_ENDPOINT_ALLOWLIST,
        resolve: async () => ["104.18.2.1", address],
      }),
    ).rejects.toThrow(/private or reserved/);
  });

  it("treats public addresses as public", () => {
    expect(isBlockedAddress("104.18.2.1")).toBe(false);
    expect(isBlockedAddress("2606:4700::6810:201")).toBe(false);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });

  it("matches wildcard entries on subdomains only", () => {
    expect(hostAllowed("acme.openai.azure.com", ["*.openai.azure.com"])).toBe(
      true,
    );
    expect(hostAllowed("openai.azure.com", ["*.openai.azure.com"])).toBe(false);
    expect(hostAllowed("evilopenai.azure.com", ["*.openai.azure.com"])).toBe(
      false,
    );
    expect(parseAllowlist(" A.com , *.b.com ")).toEqual(["a.com", "*.b.com"]);
    expect(parseAllowlist(undefined)).toEqual([...DEFAULT_ENDPOINT_ALLOWLIST]);
  });

  it("allows only the fixed providers", () => {
    expect(parseProviderModel("openai/gpt-4o").provider).toBe("openai");
    expect(() => parseProviderModel("ollama/llama3")).toThrow(/not allowed/);
    expect(() => parseProviderModel("hosted_vllm/x")).toThrow(/not allowed/);
    expect(() => parseProviderModel("gpt-4o")).toThrow(/provider/);
    expect(() => parseProviderModel("openai/../x")).toThrow(/invalid/);
  });

  it("accepts only provider-key references", () => {
    expect(validateCredentialReference("GROQ_API_KEY")).toBe("GROQ_API_KEY");
    expect(() => validateCredentialReference("LITELLM_MASTER_KEY")).toThrow();
    expect(() => validateCredentialReference("DATABASE_URL")).toThrow();
    expect(() => validateCredentialReference("LITELLM_SALT_API_KEY")).toThrow();
    expect(() => validateCredentialReference("groq_api_key")).toThrow();
  });
});

describe("createModel", () => {
  it("creates an audited model and never records the provider key", async () => {
    const { deps, client, events } = harness();
    await createModel(deps, SCOPE, ACTOR, MODEL);

    expect(client.newModel).toHaveBeenCalledWith(
      {
        model_name: "groq-llama",
        litellm_params: {
          model: "groq/llama-3.3-70b",
          api_base: null,
          api_version: null,
          rpm: 60,
          tpm: null,
          api_key: SECRET,
        },
      },
      "user-1",
    );
    expect(events.map((e) => [e.phase, e.action])).toEqual([
      ["INTENT", "model.create"],
      ["OUTCOME", "model.create"],
    ]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(events[1]!.after).toMatchObject({ credential: "provided" });
  });

  it("returns nothing that contains the key", async () => {
    const { deps } = harness();
    const result = await createModel(deps, SCOPE, ACTOR, MODEL);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("sends a reference as os.environ and records its name", async () => {
    const { deps, client, events } = harness();
    await createModel(deps, SCOPE, ACTOR, {
      ...MODEL,
      credential: { kind: "reference", name: "GROQ_API_KEY" },
    });
    expect(
      vi.mocked(client.newModel).mock.calls[0]![0].litellm_params!.api_key,
    ).toBe("os.environ/GROQ_API_KEY");
    expect(events[1]!.after).toMatchObject({
      credential: "reference GROQ_API_KEY",
    });
  });

  it.each([
    ["an existing name", { modelName: "claude-sonnet" }, /already exists/],
    ["a guardrails name", { modelName: "gemini-judge" }, /reserved/],
    [
      "a disallowed provider",
      { providerModel: "ollama/llama3" },
      /not allowed/,
    ],
    [
      "a router model",
      { providerModel: "auto_router/complexity_router" },
      /smart router/,
    ],
    ["a blocked endpoint", { apiBase: "https://169.254.169.254" }, /not an IP/],
    [
      "no credential choice",
      { credential: { kind: "keep" as const } },
      /provider key/,
    ],
    ["azure without endpoint", { providerModel: "azure/my-deploy" }, /Azure/],
  ])(
    "rejects %s before any audit row or gateway call",
    async (_label, patch, reason) => {
      const { deps, client, events } = harness();
      await expect(
        createModel(deps, SCOPE, ACTOR, { ...MODEL, ...patch }),
      ).rejects.toThrow(reason);
      expect(client.newModel).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );

  it("records a gateway failure without the key", async () => {
    const { deps, client, events } = harness();
    vi.mocked(client.newModel).mockRejectedValueOnce(
      new LitellmHttpError("/model/new", 400, "bad request"),
    );
    await expect(createModel(deps, SCOPE, ACTOR, MODEL)).rejects.toThrow();
    expect(events.map((e) => e.outcome ?? e.phase)).toEqual([
      "INTENT",
      "FAILURE",
    ]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});

describe("updateModel and deleteModel", () => {
  const consoleModel = dep("groq-llama", "db-1", true, {
    model: "groq/llama-3.3-70b",
  });
  const router = dep("smart", "db-r", true, {
    model: "auto_router/complexity_router",
    complexity_router_config: {
      classifier_type: "heuristic",
      tiers: {
        SIMPLE: "groq-llama",
        MEDIUM: "groq-llama",
        COMPLEX: "claude-sonnet",
        REASONING: "claude-sonnet",
      },
    },
    complexity_router_default_model: "claude-sonnet",
  });

  it("refuses config-file and guardrails models", async () => {
    const { deps, client } = harness([consoleModel]);
    await expect(
      updateModel(deps, SCOPE, ACTOR, "cfg-1", MODEL),
    ).rejects.toThrow(/gateway configuration/);
    await expect(deleteModel(deps, SCOPE, ACTOR, "cfg-2")).rejects.toThrow(
      LitellmInvalidStateError,
    );
    expect(client.updateModel).not.toHaveBeenCalled();
    expect(client.deleteModel).not.toHaveBeenCalled();
  });

  it("keeps the stored key when the credential is unchanged", async () => {
    const { deps, client, events } = harness([consoleModel]);
    await updateModel(deps, SCOPE, ACTOR, "db-1", {
      ...MODEL,
      credential: { kind: "keep" },
    });
    const body = vi.mocked(client.updateModel).mock.calls[0]![1];
    expect(body.litellm_params).not.toHaveProperty("api_key");
    expect(events[1]!.after).toMatchObject({ credential: "unchanged" });
  });

  it("refuses to delete a model a router points at", async () => {
    const { deps, client } = harness([consoleModel, router]);
    await expect(deleteModel(deps, SCOPE, ACTOR, "db-1")).rejects.toThrow(
      /Routers depend on this model \(smart\)/,
    );
    expect(client.deleteModel).not.toHaveBeenCalled();
  });

  it("deletes a router as router.delete", async () => {
    const { deps, events } = harness([consoleModel, router]);
    await deleteModel(deps, SCOPE, ACTOR, "db-r");
    expect(events[0]!.action).toBe("router.delete");
  });

  it("labels sources, routers and protection in the list", () => {
    const views = toModelViews([...CONFIG_MODELS, consoleModel, router]);
    const byName = Object.fromEntries(views.map((v) => [v.modelName, v]));
    expect(byName["claude-sonnet"]).toMatchObject({
      source: "config",
      usedByRouters: ["smart"],
    });
    expect(byName["nvidia-nemotron"]!.protected).toBe(true);
    expect(byName["groq-llama"]).toMatchObject({
      source: "console",
      kind: "model",
    });
    // Full endpoints only for console models.
    const cfg = toModelViews([
      dep("c", "c1", false, { api_base: "https://acme.openai.azure.com" }),
      dep("d", "d1", true, { api_base: "https://acme.openai.azure.com" }),
    ]);
    expect(cfg[0]).toMatchObject({
      apiBase: null,
      apiBaseHost: "acme.openai.azure.com",
    });
    expect(cfg[1]!.apiBase).toBe("https://acme.openai.azure.com");
    expect(byName["smart"]).toMatchObject({
      kind: "router",
      defaultModel: "claude-sonnet",
      providerModel: null,
    });
  });
});

// What the gateway receives for the recommended tuning (config B of the
// 2026-10-16 check), in its own key names.
const RECOMMENDED_CONFIG_TUNING = {
  tier_boundaries: {
    simple_medium: 0.05,
    medium_complex: 0.15,
    complex_reasoning: 0.3,
  },
  keyword_tier_rules: RECOMMENDED_KEYWORD_RULES.map((r) => ({
    keywords: r.keywords,
    tier: r.tier,
  })),
};

describe("smart router (ADR-0010 §5)", () => {
  const tiers = {
    SIMPLE: "groq-fast",
    MEDIUM: "claude-sonnet",
    COMPLEX: "claude-sonnet",
    REASONING: "claude-sonnet",
  };

  it("is always heuristic", () => {
    expect(buildRouterConfig(tiers)).toEqual({
      classifier_type: "heuristic",
      tiers,
    });
  });

  it("creates a validated, audited router", async () => {
    const { deps, client, events } = harness();
    await createRouter(deps, SCOPE, ACTOR, {
      modelName: "smart",
      tiers,
      defaultModel: "claude-sonnet",
    });
    // CHG-2026-164: a new router starts from the recommended tuning.
    const config = {
      classifier_type: "heuristic",
      tiers,
      ...RECOMMENDED_CONFIG_TUNING,
    };
    expect(client.validateComplexityRouterConfig).toHaveBeenCalledWith(config);
    expect(vi.mocked(client.newModel).mock.calls[0]![0]).toEqual({
      model_name: "smart",
      litellm_params: {
        model: "auto_router/complexity_router",
        complexity_router_config: config,
        complexity_router_default_model: "claude-sonnet",
      },
    });
    expect(events.map((e) => e.action)).toEqual([
      "router.create",
      "router.create",
    ]);
  });

  it("refuses a tier pointing at a model that doesn't exist", async () => {
    const { deps, client } = harness();
    await expect(
      createRouter(deps, SCOPE, ACTOR, {
        modelName: "smart",
        tiers: { ...tiers, SIMPLE: "nope" },
        defaultModel: "claude-sonnet",
      }),
    ).rejects.toThrow(/"nope" is not a model/);
    expect(client.newModel).not.toHaveBeenCalled();
  });

  it("surfaces the gateway's own rejection", async () => {
    const { deps, client, events } = harness();
    vi.mocked(client.validateComplexityRouterConfig).mockResolvedValueOnce({
      valid: false,
      error: "tier REASONING unknown",
    });
    await expect(
      createRouter(deps, SCOPE, ACTOR, {
        modelName: "smart",
        tiers,
        defaultModel: "claude-sonnet",
      }),
    ).rejects.toThrow(EndpointRejectedError);
    expect(events).toEqual([]);
  });

  it("tests routing without writing anything", async () => {
    const { deps, client, events } = harness();
    await expect(
      testRouting(deps, { tiers, defaultModel: "claude-sonnet", prompt: "hi" }),
    ).resolves.toEqual({ routedModel: "claude-sonnet", tier: "COMPLEX" });
    expect(client.newModel).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("smart router tuning and targets (CHG-2026-164)", () => {
  const tiers = {
    SIMPLE: "groq-fast",
    MEDIUM: "groq-fast",
    COMPLEX: "claude-sonnet",
    REASONING: "claude-sonnet",
  };
  const base: RouterInput = {
    modelName: "smart",
    tiers,
    defaultModel: "groq-fast",
  };
  const sentConfig = (client: LitellmClient) =>
    vi.mocked(client.validateComplexityRouterConfig).mock.calls[0]![0];

  it("recommends the tuning the 2026-10-16 check tested (config B)", () => {
    expect(RECOMMENDED_TIER_BOUNDARIES).toEqual({
      simpleMedium: 0.05,
      mediumComplex: 0.15,
      complexReasoning: 0.3,
    });
    const byTier = Object.fromEntries(
      RECOMMENDED_KEYWORD_RULES.map((r) => [r.tier, r.keywords]),
    );
    expect(byTier.REASONING).toHaveLength(8);
    expect(byTier.REASONING).toEqual(
      expect.arrayContaining(["خطوة بخطوة", "step by step", "prove"]),
    );
    expect(byTier.COMPLEX).toHaveLength(20);
    expect(byTier.COMPLEX).toEqual(
      expect.arrayContaining(["مجلس الإدارة", "امتثال", "board", "compliance"]),
    );
  });

  it("recommends no keyword with Arabic diacritics, which would almost never match", () => {
    const diacritics = /[\u064B-\u065F\u0670]/;
    const marked = RECOMMENDED_KEYWORD_RULES.flatMap((r) => r.keywords).filter(
      (k) => diacritics.test(k),
    );
    expect(marked).toEqual([]);
  });

  it("sends the admin's boundaries and literal keyword rules", async () => {
    const { deps, client, events } = harness();
    await createRouter(deps, SCOPE, ACTOR, {
      ...base,
      tierBoundaries: {
        simpleMedium: 0.1,
        mediumComplex: 0.2,
        complexReasoning: 0.4,
      },
      keywordRules: [
        { tier: "REASONING", keywords: [" prove ", "", "Prove", "حلل"] },
        { tier: "SIMPLE", keywords: ["hello there"] },
      ],
    });
    const config = {
      classifier_type: "heuristic",
      tiers,
      tier_boundaries: {
        simple_medium: 0.1,
        medium_complex: 0.2,
        complex_reasoning: 0.4,
      },
      // Trimmed, blanks and case-insensitive repeats dropped.
      keyword_tier_rules: [
        { keywords: ["prove", "حلل"], tier: "REASONING" },
        { keywords: ["hello there"], tier: "SIMPLE" },
      ],
    };
    expect(sentConfig(client)).toEqual(config);
    expect(
      vi.mocked(client.newModel).mock.calls[0]![0].litellm_params!
        .complexity_router_config,
    ).toEqual(config);
    expect(events.at(-1)!.after).toMatchObject({
      classifier: "heuristic",
      tierBoundaries: {
        simpleMedium: 0.1,
        mediumComplex: 0.2,
        complexReasoning: 0.4,
      },
    });
  });

  it("sends only tiers when the admin picks the gateway's defaults", async () => {
    const { deps, client } = harness();
    await createRouter(deps, SCOPE, ACTOR, {
      ...base,
      tierBoundaries: null,
      keywordRules: [],
    });
    expect(sentConfig(client)).toEqual({ classifier_type: "heuristic", tiers });
  });

  it.each([
    [{ simpleMedium: 0.2, mediumComplex: 0.1, complexReasoning: 0.4 }],
    [{ simpleMedium: 0.1, mediumComplex: 0.1, complexReasoning: 0.4 }],
    [{ simpleMedium: -0.1, mediumComplex: 0.1, complexReasoning: 0.4 }],
    [{ simpleMedium: 0.1, mediumComplex: 0.2, complexReasoning: 1.5 }],
    [{ simpleMedium: Number.NaN, mediumComplex: 0.2, complexReasoning: 0.4 }],
  ])("refuses tier boundaries %j", async (tierBoundaries) => {
    const { deps, client, events } = harness();
    await expect(
      createRouter(deps, SCOPE, ACTOR, { ...base, tierBoundaries }),
    ).rejects.toThrow(EndpointRejectedError);
    expect(client.validateComplexityRouterConfig).not.toHaveBeenCalled();
    expect(client.newModel).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each([
    ["a one-character keyword", [{ tier: "COMPLEX", keywords: ["x"] }]],
    [
      "a keyword with a line break",
      [{ tier: "COMPLEX", keywords: ["risk\nboard"] }],
    ],
    [
      "two rules for one tier",
      [
        { tier: "COMPLEX", keywords: ["risk"] },
        { tier: "COMPLEX", keywords: ["board"] },
      ],
    ],
    ["an unknown tier", [{ tier: "EXPERT", keywords: ["risk"] }]],
  ])("refuses %s", async (_label, keywordRules) => {
    const { deps, client } = harness();
    await expect(
      createRouter(deps, SCOPE, ACTOR, {
        ...base,
        keywordRules: keywordRules as RouterInput["keywordRules"],
      }),
    ).rejects.toThrow(EndpointRejectedError);
    expect(client.newModel).not.toHaveBeenCalled();
  });

  it("never sends a config key outside the allow-list", async () => {
    const { deps, client } = harness();
    // What a caller could try if anything passed the request through.
    const hostile = {
      ...base,
      classifier_type: "llm",
      classifier_llm_config: { model: "claude-sonnet" },
      semantic_keyword_matching: true,
      embedding_model: "text-embedding",
      plugins: [{ name: "x" }],
      tierBoundaries: {
        simpleMedium: 0.1,
        mediumComplex: 0.2,
        complexReasoning: 0.4,
        semantic: true,
      },
      keywordRules: [
        { tier: "COMPLEX", keywords: ["risk"], semantic: true, match: 0.1 },
      ],
    } as unknown as RouterInput;
    await createRouter(deps, SCOPE, ACTOR, hostile);
    await testRouting(deps, { ...hostile, prompt: "hi" });
    const sent = [
      sentConfig(client),
      vi.mocked(client.newModel).mock.calls[0]![0].litellm_params!
        .complexity_router_config!,
      vi.mocked(client.testRouting).mock.calls[0]![0],
    ];
    for (const config of sent) {
      expect(
        Object.keys(config).every((k) =>
          (ROUTER_CONFIG_KEYS as readonly string[]).includes(k),
        ),
      ).toBe(true);
      expect(config.classifier_type).toBe("heuristic");
      for (const k of [
        "classifier_llm_config",
        "semantic_keyword_matching",
        "embedding_model",
        "plugins",
      ]) {
        expect(config).not.toHaveProperty(k);
      }
      expect(Object.keys(config.tier_boundaries as object).sort()).toEqual([
        "complex_reasoning",
        "medium_complex",
        "simple_medium",
      ]);
      expect(config.keyword_tier_rules).toEqual([
        { keywords: ["risk"], tier: "COMPLEX" },
      ]);
    }
  });

  it("the allow-list drops other keys and refuses another classifier", () => {
    expect(
      allowListedRouterConfig({
        classifier_type: "heuristic",
        tiers,
        semantic_keyword_matching: true,
        plugins: [],
      }),
    ).toEqual({ classifier_type: "heuristic", tiers });
    expect(() =>
      allowListedRouterConfig({ classifier_type: "llm", tiers }),
    ).toThrow(EndpointRejectedError);
    // An unknown tier key never reaches the gateway, which accepts one.
    expect(
      buildRouterConfig({ ...tiers, EXPERT: "x" } as typeof tiers).tiers,
    ).toEqual(tiers);
  });

  it.each(["groq-judge", "groq-safeguard", "nvidia-nemotron", "gemini-judge"])(
    "refuses the guardrails model %s as a tier or default target",
    async (name) => {
      const { deps, client, events } = harness();
      await expect(
        createRouter(deps, SCOPE, ACTOR, {
          ...base,
          tiers: { ...tiers, SIMPLE: name },
        }),
      ).rejects.toThrow(/used by the guardrails service/);
      await expect(
        createRouter(deps, SCOPE, ACTOR, { ...base, defaultModel: name }),
      ).rejects.toThrow(/used by the guardrails service/);
      await expect(
        testRouting(deps, { ...base, defaultModel: name, prompt: "hi" }),
      ).rejects.toThrow(EndpointRejectedError);
      expect(client.validateComplexityRouterConfig).not.toHaveBeenCalled();
      expect(client.testRouting).not.toHaveBeenCalled();
      expect(client.newModel).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );

  describe("an existing router", () => {
    const stored = dep("smart", "db-r", true, {
      model: "auto_router/complexity_router",
      complexity_router_config: {
        classifier_type: "heuristic",
        tiers,
        tier_boundaries: {
          simple_medium: 0.1,
          medium_complex: 0.2,
          complex_reasoning: 0.4,
        },
        keyword_tier_rules: [{ keywords: ["board"], tier: "COMPLEX" }],
      },
      complexity_router_default_model: "groq-fast",
    });

    it("shows its tuning in the list", () => {
      const view = toModelViews([stored])[0]!;
      expect(view.tierBoundaries).toEqual({
        simpleMedium: 0.1,
        mediumComplex: 0.2,
        complexReasoning: 0.4,
      });
      expect(view.keywordRules).toEqual([
        { tier: "COMPLEX", keywords: ["board"] },
      ]);
      // Models carry no tuning; shapes the console doesn't know read as none.
      expect(toModelViews([dep("m", "m1", true)])[0]!.keywordRules).toBeNull();
      const odd = dep("odd", "db-o", true, {
        model: "auto_router/complexity_router",
        complexity_router_config: {
          tiers,
          tier_boundaries: { simple_medium: 0.5, medium_complex: 0.2 },
          keyword_tier_rules: [{ keywords: "board", tier: "COMPLEX" }],
        },
      });
      expect(toModelViews([odd])[0]).toMatchObject({
        tierBoundaries: null,
        keywordRules: [],
      });
    });

    it("keeps its tuning on an edit that leaves it out", async () => {
      const { deps, client } = harness([stored]);
      await updateRouter(deps, SCOPE, ACTOR, "db-r", base);
      expect(sentConfig(client)).toEqual(
        stored.litellm_params!.complexity_router_config,
      );
    });

    it("replaces its tuning on an edit that sends it", async () => {
      const { deps, client, events } = harness([stored]);
      await updateRouter(deps, SCOPE, ACTOR, "db-r", {
        ...base,
        tierBoundaries: null,
        keywordRules: [],
      });
      expect(sentConfig(client)).toEqual({
        classifier_type: "heuristic",
        tiers,
      });
      expect(events.at(-1)!.before).toMatchObject({
        keywordRules: [{ tier: "COMPLEX", keywords: ["board"] }],
      });
    });

    it("can't be pointed at a guardrails model on an edit", async () => {
      const { deps, client } = harness([stored]);
      await expect(
        updateRouter(deps, SCOPE, ACTOR, "db-r", {
          ...base,
          tiers: { ...tiers, REASONING: "groq-judge" },
        }),
      ).rejects.toThrow(/used by the guardrails service/);
      expect(client.updateModel).not.toHaveBeenCalled();
    });
  });

  it("tests routing with the tuning being edited", async () => {
    const { deps, client } = harness();
    await testRouting(deps, {
      ...base,
      tierBoundaries: null,
      keywordRules: [{ tier: "REASONING", keywords: ["أثبت"] }],
      prompt: "أثبت أن",
    });
    expect(vi.mocked(client.testRouting).mock.calls[0]).toEqual([
      {
        classifier_type: "heuristic",
        tiers,
        keyword_tier_rules: [{ keywords: ["أثبت"], tier: "REASONING" }],
      },
      "groq-fast",
      "أثبت أن",
    ]);
  });
});

describe("client: the provider key never leaves in an error", () => {
  it("redacts a key the gateway echoes back", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: `invalid api_key ${SECRET} for groq` },
          }),
          { status: 400 },
        ),
    ) as unknown as typeof fetch;
    const client = createLitellmClient({
      baseUrl: "http://litellm:4000",
      masterKey: "sk-master-000000",
      fetchFn,
    });
    const err = await client
      .newModel(
        {
          model_name: "x",
          litellm_params: { model: "groq/x", api_key: SECRET },
        },
        "user-1",
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LitellmHttpError);
    expect((err as Error).message).not.toContain(SECRET);
    expect((err as Error).message).toContain("[REDACTED]");
  });

  it("reads deployments without parsing credential fields", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                model_name: "x",
                litellm_params: { model: "groq/x", api_key: SECRET },
                model_info: { id: "1", db_model: true },
              },
            ],
          }),
        ),
    ) as unknown as typeof fetch;
    const client = createLitellmClient({
      baseUrl: "http://litellm:4000",
      masterKey: "sk-master-000000",
      fetchFn,
    });
    const rows = await client.deployments();
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(JSON.stringify(toModelViews(rows))).not.toContain(SECRET);
  });
});
