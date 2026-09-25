import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import type * as Db from "@langfuse/shared/src/db";

// CHG-2026-071: a guardrail event from gateway traffic carries LiteLLM's
// litellm_call_id as its "trace id". The detail must resolve it to the
// request-log mirror row in the same project, and only for roles that may
// read gateway request logs.

const eventFindFirst = vi.fn();
const requestLogFindFirst = vi.fn();

vi.mock("@langfuse/shared/src/db", async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  return {
    ...actual,
    prisma: {
      acmeGuardrailEvent: { findFirst: eventFindFirst },
      acmeLitellmRequestLog: { findFirst: requestLogFindFirst },
    },
  };
});

const { createInnerTRPCContext, createTRPCRouter } =
  await import("@/src/server/api/trpc");
const { acmeGuardrailsRouter } =
  await import("@/src/features/acme-enhancements/server/acmeGuardrailsRouter");

const PROJECT = "proj-gd";
const CALL_ID = "0b6a7f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const router = createTRPCRouter({ acmeGuardrails: acmeGuardrailsRouter });

function callerFor(role: string) {
  const session = {
    expires: "1",
    user: {
      id: "u",
      admin: false,
      featureFlags: {},
      organizations: [
        {
          id: "org",
          name: "org",
          role,
          plan: "oss",
          projects: [{ id: PROJECT, name: "p", role, deletedAt: null }],
        },
      ],
    },
    environment: {},
  } as unknown as Session;
  const ctx = createInnerTRPCContext({ session, headers: {} });
  return router.createCaller(ctx).acmeGuardrails;
}

const EVENT = {
  id: "row-1",
  projectId: PROJECT,
  eventId: "ev-1",
  eventTime: new Date("2026-09-24T14:03:38Z"),
  createdAt: new Date("2026-09-24T14:03:39Z"),
  agentId: "cairo-hr-assist-direct-67201516",
  userId: null,
  clientHost: null,
  traceId: CALL_ID,
  direction: "INPUT",
  action: "BLOCK",
  policyTriggered: "Jailbreak Detection",
  source: "PUSH",
  redactedText: null,
  piiFindings: null,
  rawContentEncrypted: "ciphertext",
};

const ROW = {
  requestId: "chatcmpl-1",
  litellmCallId: CALL_ID,
  startTime: new Date("2026-09-24T14:03:37Z"),
  endTime: new Date("2026-09-24T14:03:40Z"),
  status: "success",
  callType: "acompletion",
  model: "hr-assistant",
  modelGroup: "hr-assistant",
  provider: "groq",
  keyAlias: "cairo-hr-assist-direct-67201516",
  endUser: null,
  promptTokens: 20,
  completionTokens: 5,
  totalTokens: 25,
  spend: 0.00001,
  cacheHit: false,
  errorClass: null,
};

describe("guardrail event detail: gateway request (CHG-2026-071)", () => {
  beforeEach(() => {
    eventFindFirst.mockReset().mockResolvedValue(EVENT);
    requestLogFindFirst.mockReset().mockResolvedValue(ROW);
  });

  it("resolves the call id to the request-log row in the same project", async () => {
    const out = await callerFor("ADMIN").eventDetail({
      projectId: PROJECT,
      id: "row-1",
    });
    expect(out.gatewayRequest).toMatchObject({
      model: "hr-assistant",
      litellmCallId: CALL_ID,
      startTime: "2026-09-24T14:03:37.000Z",
    });
    const where = requestLogFindFirst.mock.calls[0]![0].where;
    expect(where.projectId).toBe(PROJECT);
    expect(where.OR).toEqual([
      { litellmCallId: CALL_ID },
      { requestId: CALL_ID },
    ]);
  });

  it("never sends the encrypted blocked content, only a flag", async () => {
    const out = await callerFor("ADMIN").eventDetail({
      projectId: PROJECT,
      id: "row-1",
    });
    expect(JSON.stringify(out)).not.toContain("ciphertext");
    expect(out.hasEncryptedContent).toBe(true);
  });

  it("does not look up the gateway row for a role without llmGatewayLogs:read", async () => {
    // Prompt Analyst (MEMBER) reads guardrail events but not gateway logs.
    const out = await callerFor("MEMBER")
      .eventDetail({ projectId: PROJECT, id: "row-1" })
      .catch(() => null);
    if (out) expect(out.gatewayRequest).toBeNull();
    expect(requestLogFindFirst).not.toHaveBeenCalled();
  });

  it("Security Analyst sees the event and its gateway request (owner, 2026-09-25)", async () => {
    // Reviewing guardrail decisions is the Security Analyst's job: it holds
    // projectGuardrails:read and llmGatewayLogs:read, and eventDetail is on
    // its server allow-list (securityRoleAllowList.ts).
    const out = await callerFor("SECURITY").eventDetail({
      projectId: PROJECT,
      id: "row-1",
    });
    expect(out.policyTriggered).toBe("Jailbreak Detection");
    expect(out.gatewayRequest).toMatchObject({
      model: "hr-assistant",
      keyAlias: "cairo-hr-assist-direct-67201516",
    });
    expect(JSON.stringify(out)).not.toContain("ciphertext");
  });

  it("returns null when no request row matches yet (mirror lag)", async () => {
    requestLogFindFirst.mockResolvedValue(null);
    const out = await callerFor("AUDITOR").eventDetail({
      projectId: PROJECT,
      id: "row-1",
    });
    expect(out.gatewayRequest).toBeNull();
    expect(out.traceId).toBe(CALL_ID);
  });
});
