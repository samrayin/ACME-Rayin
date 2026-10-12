import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/src/env.mjs";
import { SECTOR_PACK_IDS } from "@/src/features/acme-enhancements/utils/guardrailSectorPacks";
import type * as GuardrailSettingsModule from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

// CHG-2026-151 (ADR-0031 phase 1): what POST /api/public/guardrails-settings
// serves to the rayin-guardrails pods now includes `sectors`, the enabled
// sector packs, never empty. The handler runs end to end; only the API-key
// check, the rate limiter and the settings store's reads and writes are
// stood in for. The body is built by the real toSyncResponse.

const {
  mockVerifyAuth,
  mockRateLimitRequest,
  mockGetCurrentSettings,
  mockApplyExpiredRevert,
  mockRecordPodSync,
} = vi.hoisted(() => ({
  mockVerifyAuth: vi.fn(),
  mockRateLimitRequest: vi.fn(),
  mockGetCurrentSettings: vi.fn(),
  mockApplyExpiredRevert: vi.fn(),
  mockRecordPodSync: vi.fn(),
}));

vi.mock("@/src/features/public-api/server/apiAuth", () => {
  function ApiAuthService() {
    return { verifyAuthHeaderAndReturnScope: mockVerifyAuth };
  }
  return { ApiAuthService };
});

vi.mock("@/src/features/public-api/server/RateLimitService", () => ({
  RateLimitService: {
    getInstance: () => ({ rateLimitRequest: mockRateLimitRequest }),
  },
}));

vi.mock(
  "@/src/features/acme-enhancements/server/acmeGuardrailSettings",
  async (importOriginal) => {
    const actual = await importOriginal<typeof GuardrailSettingsModule>();
    return {
      ...actual,
      getCurrentSettings: mockGetCurrentSettings,
      applyExpiredRevert: mockApplyExpiredRevert,
      recordPodSync: mockRecordPodSync,
    };
  },
);

import handler from "@/src/pages/api/public/guardrails-settings";

const SYNC_PROJECT = "project-guardrails-sync";

const scopeFor = (projectId: string) => ({
  projectId,
  orgId: "org-1",
  plan: "oss",
  rateLimitOverrides: [],
  apiKeyId: "api-key-1",
  publicKey: "pk-test",
  accessLevel: "project",
  isIngestionSuspended: false,
  isInAppAgentKey: false,
});

function version(sectors: string[]) {
  return {
    version: 7,
    mode: "record" as const,
    revertAt: null,
    automatic: false,
    piiEntities: ["EMAIL_ADDRESS"],
    jailbreakEnabled: true,
    topicalEnabled: true,
    sectors,
    reason: "A reason that is long enough",
    createdBy: "user-1",
    createdByEmail: null,
    createdAt: new Date("2026-10-11T10:00:00.000Z"),
  };
}

function pull() {
  const mocks = createMocks<NextApiRequest, NextApiResponse>({
    method: "POST",
    headers: {
      authorization: "Basic test",
      "content-type": "application/json",
    },
    body: { pod: "rayin-guardrails-abc12", applied_version: 6 },
  });
  return mocks;
}

describe("POST /api/public/guardrails-settings serves the sector packs (CHG-2026-151)", () => {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const saved = envRecord.CAIRO_GUARDRAILS_SYNC_PROJECT_ID;

  beforeEach(() => {
    envRecord.CAIRO_GUARDRAILS_SYNC_PROJECT_ID = SYNC_PROJECT;
    mockVerifyAuth.mockReset();
    mockRateLimitRequest.mockReset();
    mockGetCurrentSettings.mockReset();
    mockApplyExpiredRevert.mockReset();
    mockRecordPodSync.mockReset();
    mockVerifyAuth.mockResolvedValue({
      validKey: true,
      scope: scopeFor(SYNC_PROJECT),
    });
    mockRateLimitRequest.mockResolvedValue(undefined);
    mockApplyExpiredRevert.mockResolvedValue({ changed: false, current: null });
    mockRecordPodSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    envRecord.CAIRO_GUARDRAILS_SYNC_PROJECT_ID = saved;
  });

  it("includes the packs in force, as stored", async () => {
    mockGetCurrentSettings.mockResolvedValue(version(["banking", "hr"]));
    const { req, res } = pull();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body).toMatchObject({
      version: 7,
      mode: "record",
      pii_entities: ["EMAIL_ADDRESS"],
      jailbreak_enabled: true,
      topical_enabled: true,
      sectors: ["banking", "hr"],
      revert_at: null,
    });
    expect(mockRecordPodSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pod: "rayin-guardrails-abc12" }),
    );
  });

  it("serves all six for a version saved with all six", async () => {
    mockGetCurrentSettings.mockResolvedValue(version([...SECTOR_PACK_IDS]));
    const { req, res } = pull();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).sectors).toEqual([
      "banking",
      "government",
      "healthcare",
      "hr",
      "retail_telecom",
      "education",
    ]);
  });

  it("serves no settings, and so no packs, to another project's key", async () => {
    mockVerifyAuth.mockResolvedValue({
      validKey: true,
      scope: scopeFor("some-other-project"),
    });
    mockGetCurrentSettings.mockResolvedValue(version(["banking"]));
    const { req, res } = pull();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(res._getData()).not.toContain("sectors");
    expect(mockGetCurrentSettings).not.toHaveBeenCalled();
  });
});
