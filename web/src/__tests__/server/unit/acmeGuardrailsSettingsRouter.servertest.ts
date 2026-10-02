import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Session } from "next-auth";
import { env } from "@/src/env.mjs";
import {
  createInnerTRPCContext,
  createTRPCRouter,
} from "@/src/server/api/trpc";
import { acmeGuardrailsRouter } from "@/src/features/acme-enhancements/server/acmeGuardrailsRouter";

// ADR-0005-B part a, test B12: the guardrail settings can be changed only by
// a named deployment administrator, on a deployment where open sign-up is
// off. An organisation or project OWNER who is not on the list is refused,
// and every refusal happens before the database is touched.

const PROJECT = "proj-guardrail-settings";
const ORG = "org-guardrail-settings";
const ADMIN_EMAIL = "guardrail-admin@example.com";

const router = createTRPCRouter({ acmeGuardrails: acmeGuardrailsRouter });

function sessionFor(
  role: string,
  email: string | null,
  instanceAdmin = false,
): Session {
  return {
    expires: "1",
    user: {
      id: `user-${role}`,
      name: role,
      email,
      canCreateOrganizations: false,
      admin: instanceAdmin,
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

// getConfig reads the stored version and the pods' reports, nothing else.
const readOnlyPrisma = {
  acmeGuardrailSettings: { findFirst: async () => null },
  acmeGuardrailSettingsPod: { findMany: async () => [] },
};

function callerFor(
  role: string,
  email: string | null,
  db: object = explodingPrisma,
  instanceAdmin = false,
) {
  const ctx = createInnerTRPCContext({
    session: sessionFor(role, email, instanceAdmin),
    headers: {},
  });
  return router.createCaller({
    ...ctx,
    prisma: db as typeof ctx.prisma,
  }).acmeGuardrails;
}

const SAVE = {
  projectId: PROJECT,
  piiEntities: ["EMAIL_ADDRESS" as const],
  jailbreakEnabled: true,
  topicalEnabled: true,
  reason: "A reason that is long enough",
};

describe("guardrail settings authority (B12)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const original = {
    admins: envRecord.CAIRO_GUARDRAIL_ADMINS,
    disableSignup: envRecord.AUTH_DISABLE_SIGNUP,
    signupDisabled: envRecord.NEXT_PUBLIC_SIGN_UP_DISABLED,
    verification: envRecord.AUTH_EMAIL_VERIFICATION_REQUIRED,
  };

  beforeEach(() => {
    envRecord.CAIRO_GUARDRAIL_ADMINS = ADMIN_EMAIL;
    envRecord.AUTH_DISABLE_SIGNUP = "true";
    envRecord.NEXT_PUBLIC_SIGN_UP_DISABLED = "false";
    envRecord.AUTH_EMAIL_VERIFICATION_REQUIRED = undefined;
    touched.mockClear();
  });

  afterEach(() => {
    envRecord.CAIRO_GUARDRAIL_ADMINS = original.admins;
    envRecord.AUTH_DISABLE_SIGNUP = original.disableSignup;
    envRecord.NEXT_PUBLIC_SIGN_UP_DISABLED = original.signupDisabled;
    envRecord.AUTH_EMAIL_VERIFICATION_REQUIRED = original.verification;
  });

  it("refuses a project and organisation OWNER who is not on the list", async () => {
    await expect(
      callerFor("OWNER", "owner@example.com").updateConfig(SAVE),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(touched).not.toHaveBeenCalled();
  });

  it("refuses a listed administrator while open sign-up is enabled", async () => {
    envRecord.AUTH_DISABLE_SIGNUP = "false";
    await expect(
      callerFor("OWNER", ADMIN_EMAIL).updateConfig(SAVE),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/open sign-up/),
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("refuses everyone when no administrators are configured", async () => {
    envRecord.CAIRO_GUARDRAIL_ADMINS = undefined;
    await expect(
      callerFor("OWNER", ADMIN_EMAIL).updateConfig(SAVE),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(touched).not.toHaveBeenCalled();
  });

  it("lets a listed administrator through to the save", async () => {
    // An ADMIN on this project and a named deployment administrator: the
    // authority check passes, and the call reaches the database (which this
    // test's client refuses). The same person without the list entry is
    // refused (the OWNER case above): the role alone grants nothing.
    // tRPC masks the client's error as an internal one; what matters is that
    // the call was not refused and did reach the database.
    await expect(
      callerFor("ADMIN", ADMIN_EMAIL).updateConfig(SAVE),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(touched).toHaveBeenCalled();
  });

  it("keeps the Auditor's read-only limit even for a listed email", async () => {
    // The Auditor role's own server allow-list refuses every change before
    // the guardrail authority check runs; being listed does not lift it.
    await expect(
      callerFor("AUDITOR", ADMIN_EMAIL).updateConfig(SAVE),
    ).rejects.toThrow(/Auditor role cannot access/);
    expect(touched).not.toHaveBeenCalled();
  });

  // CHG-2026-091: getConfig's canEdit must match what updateConfig allows.
  it("offers editing to a listed administrator whose role may save", async () => {
    const listed = await callerFor(
      "ADMIN",
      ADMIN_EMAIL,
      readOnlyPrisma,
    ).getConfig({ projectId: PROJECT });
    expect(listed).toMatchObject({ canEdit: true, readOnlyRole: false });

    const unlisted = await callerFor(
      "OWNER",
      "owner@example.com",
      readOnlyPrisma,
    ).getConfig({ projectId: PROJECT });
    expect(unlisted).toMatchObject({ canEdit: false, readOnlyRole: false });
  });

  it("does not offer editing to a listed Security Analyst, whose save is refused", async () => {
    const config = await callerFor(
      "SECURITY",
      ADMIN_EMAIL,
      readOnlyPrisma,
    ).getConfig({ projectId: PROJECT });
    expect(config).toMatchObject({ canEdit: false, readOnlyRole: true });

    await expect(
      callerFor("SECURITY", ADMIN_EMAIL).updateConfig(SAVE),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/Security Analyst role cannot access/),
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("does not offer editing to a listed Auditor", async () => {
    // updateConfig's refusal for this caller is the Auditor test above.
    const config = await callerFor(
      "AUDITOR",
      ADMIN_EMAIL,
      readOnlyPrisma,
    ).getConfig({ projectId: PROJECT });
    expect(config).toMatchObject({ canEdit: false, readOnlyRole: true });
  });

  it("follows the server for an instance admin who holds a content-free role", async () => {
    // Instance admins skip the content-free allow-lists in the middleware,
    // so a listed one may save whatever their project role, and the card
    // must offer it.
    const config = await callerFor(
      "SECURITY",
      ADMIN_EMAIL,
      readOnlyPrisma,
      true,
    ).getConfig({ projectId: PROJECT });
    expect(config).toMatchObject({ canEdit: true, readOnlyRole: false });

    // Not refused: the call reaches the database (masked as internal, as in
    // "lets a listed administrator through to the save").
    await expect(
      callerFor("SECURITY", ADMIN_EMAIL, explodingPrisma, true).updateConfig(
        SAVE,
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(touched).toHaveBeenCalled();
  });
});
