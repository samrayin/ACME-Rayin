import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Session } from "next-auth";
import { env as sharedEnv } from "@langfuse/shared/src/env";
import { isInAppAgentInstanceEnabled } from "@langfuse/shared/in-app-agent/server/modelProvider";
import { assertInAppAgentAvailable } from "@/src/features/in-app-agent/server/availability";

// CHG-2026-134: upstream's in-app assistant stays off in EYEON through its own
// upstream switch, LANGFUSE_IN_APP_AGENT_ENABLED: on a self-hosted deployment
// it is off unless set to "true", and EYEON's deployments do not set it. With
// the switch off the session tells the console to hide every assistant entry
// point, and every in-app agent route refuses before it reads anything. This
// pins that default, so an upstream sync that changes it fails here first.

type SharedEnv = Record<string, string | undefined>;
const shared = sharedEnv as unknown as SharedEnv;

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

const OWNER = {
  id: "user-owner",
  name: "Owner",
  email: null,
  admin: false,
  canCreateOrganizations: false,
  featureFlags: {},
  organizations: [],
} as unknown as NonNullable<Session["user"]>;

describe("upstream's in-app agent is off in EYEON (CHG-2026-134)", () => {
  const original = {
    region: shared.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION,
    enabled: shared.LANGFUSE_IN_APP_AGENT_ENABLED,
  };

  beforeEach(() => {
    // Self-hosted, as every EYEON deployment is.
    shared.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION = undefined;
    shared.LANGFUSE_IN_APP_AGENT_ENABLED = undefined;
    touched.mockClear();
  });

  afterEach(() => {
    shared.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION = original.region;
    shared.LANGFUSE_IN_APP_AGENT_ENABLED = original.enabled;
  });

  it("is off on a self-hosted deployment unless the switch is set", () => {
    expect(isInAppAgentInstanceEnabled()).toBe(false);
    shared.LANGFUSE_IN_APP_AGENT_ENABLED = "false";
    expect(isInAppAgentInstanceEnabled()).toBe(false);
  });

  it("refuses every in-app agent route before reading anything", async () => {
    await expect(
      assertInAppAgentAvailable({
        prisma: explodingPrisma as never,
        projectId: "proj-agent-off",
        user: OWNER,
      }),
    ).rejects.toMatchObject({
      httpCode: 412,
      message: "In-app agent is not enabled on this instance.",
    });
    expect(touched).not.toHaveBeenCalled();
  });

  it("control: only an explicit opt-in turns it on", () => {
    shared.LANGFUSE_IN_APP_AGENT_ENABLED = "true";
    expect(isInAppAgentInstanceEnabled()).toBe(true);
  });
});
