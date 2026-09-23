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
  buildRouterConfig,
  createModel,
  createRouter,
  deleteModel,
  testRouting,
  toModelViews,
  updateModel,
  type ModelInput,
  type ModelsDeps,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmModels";
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

describe("smart router (ADR-0010 §5)", () => {
  const tiers = {
    SIMPLE: "groq-judge",
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
    expect(client.validateComplexityRouterConfig).toHaveBeenCalledWith({
      classifier_type: "heuristic",
      tiers,
    });
    expect(vi.mocked(client.newModel).mock.calls[0]![0]).toEqual({
      model_name: "smart",
      litellm_params: {
        model: "auto_router/complexity_router",
        complexity_router_config: { classifier_type: "heuristic", tiers },
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
