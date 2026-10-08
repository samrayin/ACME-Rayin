import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Session } from "next-auth";
import { Role } from "@langfuse/shared/src/db";
import type * as SharedServer from "@langfuse/shared/src/server";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { acmeChatRouter } from "@/src/features/acme-enhancements/server/acmeChatRouter";
import {
  allowedProceduresFor,
  CONTENT_FREE_ROLES,
} from "@/src/features/rbac/server/securityRoleAllowList";

// CHG-2026-141 (ADR-0026 §12.3): ACME AI behind CAIRO_ACME_AI_ENABLED,
// server-only, default off. Off, acmeChat.sendMessage is exactly as
// CHG-2026-134 left it: it refuses every caller first (that change's own
// tests, acmeAiSwitchedOff.servertest.ts, still pin it). On, it runs every
// check it had before CHG-2026-134: the access check, the gateway settings,
// then the prompt and the gateway. acmeChat.status tells the console whether
// the switch is on: sign-in only, one boolean, no read.

const PROJECT = "proj-acme-ai-flag";
const ORG = "org-acme-ai-flag";

const h = vi.hoisted(() => ({
  pickVariant: vi.fn(),
  tracingHandler: vi.fn(),
}));

// The prompt step reads the project's prompts through the global client;
// here it only records that the request got that far.
vi.mock("@/src/features/acme-enhancements/server/acmePromptVariant", () => ({
  pickChatPromptVariant: h.pickVariant,
}));

// The trace of the chat is written after the reply; here it stays in memory.
vi.mock("@langfuse/shared/src/server", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedServer>();
  return { ...actual, getInternalTracingHandler: h.tracingHandler };
});

const router = createTRPCRouter({ acmeChat: acmeChatRouter });

function sessionFor(role: Role): Session {
  return {
    expires: "1",
    user: {
      id: `user-${role}`,
      name: role,
      email: null,
      canCreateOrganizations: false,
      admin: false,
      featureFlags: {},
      organizations: [
        {
          id: ORG,
          name: "org",
          role,
          plan: "oss",
          projects: [
            {
              id: PROJECT,
              name: "p",
              role,
              deletedAt: null,
              retentionDays: null,
            },
          ],
        },
      ],
    },
    environment: {
      enableExperimentalFeatures: false,
      selfHostedInstancePlan: "oss",
    },
  } as unknown as Session;
}

const touched = vi.fn();
const explodingPrisma = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      touched(String(prop));
      throw new Error(`database touched: ${String(prop)}`);
    },
  },
);

function callerFor(session: Session | null) {
  const ctx = createInnerTRPCContext({ session, headers: {} });
  return router.createCaller({
    ...ctx,
    prisma: explodingPrisma as typeof ctx.prisma,
  }).acmeChat;
}

const MESSAGE = {
  projectId: PROJECT,
  history: [],
  message: "Summarise the last ten traces",
};

// Test values only: the gateway is never reached, fetch is replaced.
const GATEWAY = {
  RAYIN_CHAT_LLM_BASE_URL: "test-gateway-base",
  RAYIN_CHAT_LLM_API_KEY: "test-gateway-key",
  RAYIN_CHAT_LLM_MODEL: "test-model",
};

const envRecord = env as unknown as Record<string, string | undefined>;
const KEYS = ["CAIRO_ACME_AI_ENABLED", ...Object.keys(GATEWAY)];
const original = Object.fromEntries(KEYS.map((k) => [k, envRecord[k]]));

function setGateway(configured: boolean) {
  for (const [key, value] of Object.entries(GATEWAY)) {
    envRecord[key] = configured ? value : undefined;
  }
}

function inMemoryTrace() {
  const trace = {
    generation: vi.fn(() => ({ end: vi.fn() })),
    update: vi.fn(),
  };
  return {
    handler: { langfuse: { trace: vi.fn(() => trace) } },
    processTracedEvents: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  touched.mockClear();
  h.pickVariant.mockReset();
  h.tracingHandler.mockReset();
  h.tracingHandler.mockImplementation(inMemoryTrace);
  setGateway(false);
});

afterEach(() => {
  for (const key of KEYS) envRecord[key] = original[key];
  vi.restoreAllMocks();
});

describe("CAIRO_ACME_AI_ENABLED off: ACME AI as CHG-2026-134 left it (CHG-2026-141)", () => {
  it("is off unless set: no environment here sets it", () => {
    expect(original.CAIRO_ACME_AI_ENABLED).toBe("false");
  });

  it.each([undefined, "false"])(
    "with the flag %s, sendMessage refuses an Owner before any read or the gateway",
    async (flag) => {
      envRecord.CAIRO_ACME_AI_ENABLED = flag;
      setGateway(true);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        callerFor(sessionFor(Role.OWNER)).sendMessage(MESSAGE),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "ACME AI is switched off in EYEON.",
      });
      expect(h.pickVariant).not.toHaveBeenCalled();
      expect(h.tracingHandler).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(touched).not.toHaveBeenCalled();
    },
  );
});

describe("CAIRO_ACME_AI_ENABLED on: sendMessage runs its own checks again (CHG-2026-141)", () => {
  beforeEach(() => {
    envRecord.CAIRO_ACME_AI_ENABLED = "true";
  });

  it("a Viewer, without projectAiAssistant:use, is refused by the access check", async () => {
    setGateway(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      callerFor(sessionFor(Role.VIEWER)).sendMessage(MESSAGE),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "User does not have access to this resource or action",
    });
    expect(h.pickVariant).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(touched).not.toHaveBeenCalled();
  });

  it.each(CONTENT_FREE_ROLES)(
    "the content-free role %s is still refused by its allow-list",
    async (role) => {
      setGateway(true);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        callerFor(sessionFor(role)).sendMessage(MESSAGE),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringMatching(/role cannot access this resource/),
      });
      expect(h.pickVariant).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it.each([Role.OWNER, Role.ADMIN, Role.MEMBER])(
    "%s reaches the gateway settings check: unconfigured, it says so",
    async (role) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        callerFor(sessionFor(role)).sendMessage(MESSAGE),
      ).resolves.toEqual({
        reply: expect.stringContaining(
          "ACME AI is not configured on this deployment",
        ),
      });
      expect(h.pickVariant).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it("configured, an Owner's message goes through the prompt step to the gateway", async () => {
    setGateway(true);
    h.pickVariant.mockResolvedValue({
      variant: "fallback",
      label: "chat-production",
      promptName: null,
      promptVersion: null,
      text: null,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "Ten traces, none failed." },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      callerFor(sessionFor(Role.OWNER)).sendMessage(MESSAGE),
    ).resolves.toEqual({ reply: "Ten traces, none failed." });

    expect(h.pickVariant).toHaveBeenCalledWith(PROJECT);
    expect(h.tracingHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        targetProjectId: PROJECT,
        userId: `user-${Role.OWNER}`,
      }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("test-gateway-base/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-gateway-key",
    });
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: MESSAGE.message,
    });
    expect(touched).not.toHaveBeenCalled();
  });
});

describe("acmeChat.status: sign-in only, the switch alone (CHG-2026-141)", () => {
  it("refuses a caller who is not signed in", async () => {
    await expect(callerFor(null).status()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    Role.OWNER,
    Role.ADMIN,
    Role.MEMBER,
    Role.VIEWER,
    ...CONTENT_FREE_ROLES,
  ])(
    "answers %s with the deployment's switch and nothing else, reading nothing",
    async (role) => {
      envRecord.CAIRO_ACME_AI_ENABLED = undefined;
      await expect(callerFor(sessionFor(role)).status()).resolves.toStrictEqual(
        { enabled: false },
      );

      envRecord.CAIRO_ACME_AI_ENABLED = "true";
      await expect(callerFor(sessionFor(role)).status()).resolves.toStrictEqual(
        { enabled: true },
      );

      expect(touched).not.toHaveBeenCalled();
    },
  );

  it.each(CONTENT_FREE_ROLES)(
    "%s's allow-list gains no ACME AI procedure",
    (role) => {
      expect(
        allowedProceduresFor(role).filter((p) => p.startsWith("acmeChat.")),
      ).toEqual([]);
    },
  );
});
