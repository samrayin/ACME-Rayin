import { describe, it, expect, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import { Role } from "@langfuse/shared/src/db";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { acmeChatRouter } from "@/src/features/acme-enhancements/server/acmeChatRouter";

// CHG-2026-134: ACME AI is removed from EYEON (owner, 2026-10-07: "Remove
// ACME AI completely from EYEON. we will plan for it sometime later"). Its
// API stays registered, so the code is kept for that plan, but refuses every
// caller before it reads a setting, a prompt or project data, or calls the
// gateway. Content-free roles were already refused by their allow-lists.

const PROJECT = "proj-acme-ai-off";
const ORG = "org-acme-ai-off";

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

function callerFor(role: Role) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role),
    headers: {},
  });
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

describe("ACME AI is switched off on the server (CHG-2026-134)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    touched.mockClear();
  });

  // Owner, Admin and Prompt Analyst (MEMBER) hold projectAiAssistant:use, so
  // ACME AI used to answer them; Viewer never could.
  it.each([Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER])(
    "refuses %s before reading anything or calling the gateway",
    async (role) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(callerFor(role).sendMessage(MESSAGE)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "ACME AI is switched off in EYEON.",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(touched).not.toHaveBeenCalled();
    },
  );

  it.each([Role.SECURITY, Role.ANALYST, Role.AUDITOR])(
    "still refuses the content-free role %s",
    async (role) => {
      await expect(callerFor(role).sendMessage(MESSAGE)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(touched).not.toHaveBeenCalled();
    },
  );
});
