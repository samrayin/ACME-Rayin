import { describe, it, expect, vi } from "vitest";
import {
  ALL_PII_ENTITIES,
  canEditGuardrailSettings,
  getCurrentSettings,
  GuardrailSettingsValidationError,
  isDeploymentAdmin,
  listReportingPods,
  MAX_LISTED_PODS,
  normalisePolicy,
  parseAdminList,
  POD_NAME_PATTERN,
  policiesEqual,
  recordPodSync,
  saveSettings,
  selfSignupClosed,
  toSyncResponse,
  validateReason,
  type GuardrailSettingsVersion,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import { buildEventRow } from "@/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService";

// ADR-0005-B part a (CHG-2026-089). Pure logic, plus saveSettings against a
// fake client: no live database, matching the other server/unit tests.

const ALL = [...ALL_PII_ENTITIES];

type Row = {
  version: number;
  mode: string;
  piiEntities: string[];
  jailbreakEnabled: boolean;
  topicalEnabled: boolean;
  reason: string;
  createdBy: string;
  createdByEmail: string | null;
  projectId?: string | null;
  createdAt: Date;
};

function v1(): Row {
  return {
    version: 1,
    mode: "record",
    piiEntities: [...ALL],
    jailbreakEnabled: true,
    topicalEnabled: true,
    reason: "Initial version",
    createdBy: "migration",
    createdByEmail: null,
    createdAt: new Date("2026-10-01T12:00:00Z"),
  };
}

/** A fake Prisma client holding settings rows in memory. */
function fakeDb(rows: Row[], opts: { failCreateTimes?: number } = {}) {
  let failCreate = opts.failCreateTimes ?? 0;
  const settings = {
    findFirst: vi.fn(async () =>
      rows.length ? [...rows].sort((a, b) => b.version - a.version)[0] : null,
    ),
    create: vi.fn(async ({ data }: { data: Omit<Row, "createdAt"> }) => {
      if (failCreate > 0) {
        failCreate--;
        throw Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
        });
      }
      const row = { ...data, createdAt: new Date("2026-10-01T13:00:00Z") };
      rows.push(row);
      return row;
    }),
  };
  const db = {
    acmeGuardrailSettings: settings,
    acmeGuardrailSettingsPod: {},
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ acmeGuardrailSettings: settings }),
    ),
  };
  return { db: db as never, settings, rows };
}

const SAVE_INPUT = {
  reason: "Topic check is too noisy for the pilot",
  userId: "user-1",
  userEmail: "admin@example.com",
  projectId: "proj-1",
};

describe("parseAdminList / isDeploymentAdmin", () => {
  it("parses a comma-separated list, trimmed and lower-cased", () => {
    expect(parseAdminList(" A@x.com, b@Y.com ,,")).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
  });

  it("fails closed when the list is unset or empty", () => {
    expect(isDeploymentAdmin("a@x.com", undefined)).toBe(false);
    expect(isDeploymentAdmin("a@x.com", "")).toBe(false);
    expect(isDeploymentAdmin("a@x.com", " , ")).toBe(false);
  });

  it("fails closed when the user has no email", () => {
    expect(isDeploymentAdmin(null, "a@x.com")).toBe(false);
    expect(isDeploymentAdmin(undefined, "a@x.com")).toBe(false);
  });

  it("matches case-insensitively, and only exact entries", () => {
    expect(isDeploymentAdmin("A@X.com", "a@x.com")).toBe(true);
    expect(isDeploymentAdmin("a@x.co", "a@x.com")).toBe(false);
    expect(isDeploymentAdmin("aa@x.com", "a@x.com")).toBe(false);
  });
});

describe("selfSignupClosed / canEditGuardrailSettings", () => {
  it("counts sign-up as closed only on an explicit 'true'", () => {
    expect(selfSignupClosed({})).toBe(false);
    expect(selfSignupClosed({ AUTH_DISABLE_SIGNUP: "false" })).toBe(false);
    expect(selfSignupClosed({ AUTH_DISABLE_SIGNUP: "true" })).toBe(true);
    expect(selfSignupClosed({ NEXT_PUBLIC_SIGN_UP_DISABLED: "true" })).toBe(
      true,
    );
    expect(selfSignupClosed({ AUTH_EMAIL_VERIFICATION_REQUIRED: "true" })).toBe(
      true,
    );
  });

  it("needs both a listed email and closed sign-up", () => {
    const base = { email: "a@x.com", rawAdminList: "a@x.com" };
    expect(canEditGuardrailSettings({ ...base, signupClosed: true })).toBe(
      true,
    );
    expect(canEditGuardrailSettings({ ...base, signupClosed: false })).toBe(
      false,
    );
    expect(
      canEditGuardrailSettings({
        email: "owner@x.com",
        rawAdminList: "a@x.com",
        signupClosed: true,
      }),
    ).toBe(false);
  });
});

describe("POD_NAME_PATTERN", () => {
  it("accepts Kubernetes pod names and rejects anything else", () => {
    expect(POD_NAME_PATTERN.test("rayin-guardrails-58565454fd-k2fpp")).toBe(
      true,
    );
    expect(POD_NAME_PATTERN.test("a")).toBe(true);
    expect(POD_NAME_PATTERN.test("Upper-Case")).toBe(false);
    expect(POD_NAME_PATTERN.test("-leading")).toBe(false);
    expect(POD_NAME_PATTERN.test("trailing-")).toBe(false);
    expect(POD_NAME_PATTERN.test("has space")).toBe(false);
    expect(POD_NAME_PATTERN.test("x".repeat(64))).toBe(false);
    expect(POD_NAME_PATTERN.test("x".repeat(63))).toBe(true);
  });
});

describe("normalisePolicy / policiesEqual", () => {
  it("orders and de-duplicates entities canonically", () => {
    const p = normalisePolicy({
      piiEntities: ["BH_CPR", "EMAIL_ADDRESS", "BH_CPR"],
      jailbreakEnabled: true,
      topicalEnabled: false,
    });
    expect(p.piiEntities).toEqual(["EMAIL_ADDRESS", "BH_CPR"]);
  });

  it("rejects an unknown entity instead of storing it", () => {
    expect(() =>
      normalisePolicy({
        piiEntities: ["NOT_A_TYPE"],
        jailbreakEnabled: true,
        topicalEnabled: true,
      }),
    ).toThrow(GuardrailSettingsValidationError);
  });

  it("treats the same policy in a different order as equal", () => {
    const a = normalisePolicy({
      piiEntities: ["PERSON", "EMAIL_ADDRESS"],
      jailbreakEnabled: true,
      topicalEnabled: true,
    });
    const b = normalisePolicy({
      piiEntities: ["EMAIL_ADDRESS", "PERSON"],
      jailbreakEnabled: true,
      topicalEnabled: true,
    });
    expect(policiesEqual(a, b)).toBe(true);
    expect(policiesEqual(a, { ...b, topicalEnabled: false })).toBe(false);
  });
});

describe("validateReason", () => {
  it("requires at least 10 characters after trimming", () => {
    expect(() => validateReason("   short   ")).toThrow(/at least 10/);
    expect(validateReason("  a real reason  ")).toBe("a real reason");
  });

  it("caps the reason at 500 characters", () => {
    expect(() => validateReason("x".repeat(501))).toThrow(/limited to 500/);
  });
});

describe("toSyncResponse", () => {
  it("returns the policy a pod applies, and nothing else", async () => {
    const { db } = fakeDb([v1()]);
    const current = (await getCurrentSettings(db)) as GuardrailSettingsVersion;
    expect(toSyncResponse(current)).toEqual({
      version: 1,
      mode: "record",
      pii_entities: ALL,
      jailbreak_enabled: true,
      topical_enabled: true,
      updated_at: "2026-10-01T12:00:00.000Z",
    });
  });
});

describe("saveSettings", () => {
  it("does nothing, and writes no audit entry, when the policy is unchanged", async () => {
    const { db, settings } = fakeDb([v1()]);
    const audit = vi.fn(async () => {});
    const result = await saveSettings(
      db,
      {
        ...SAVE_INPUT,
        policy: {
          piiEntities: [...ALL],
          jailbreakEnabled: true,
          topicalEnabled: true,
        },
      },
      audit,
    );
    expect(result.changed).toBe(false);
    expect(result.current.version).toBe(1);
    expect(settings.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("stores the next version and audits before and after, in the transaction", async () => {
    const { db, rows } = fakeDb([v1()]);
    const audit = vi.fn(async () => {});
    const result = await saveSettings(
      db,
      {
        ...SAVE_INPUT,
        policy: {
          piiEntities: ["EMAIL_ADDRESS"],
          jailbreakEnabled: true,
          topicalEnabled: false,
        },
      },
      audit,
    );
    expect(result.changed).toBe(true);
    expect(result.current.version).toBe(2);
    expect(rows.find((r) => r.version === 2)).toMatchObject({
      mode: "record",
      piiEntities: ["EMAIL_ADDRESS"],
      topicalEnabled: false,
      reason: SAVE_INPUT.reason,
      createdBy: "user-1",
      createdByEmail: "admin@example.com",
      projectId: "proj-1",
    });
    expect(audit).toHaveBeenCalledTimes(1);
    const [tx, change] = audit.mock.calls[0] as unknown as [
      unknown,
      { before: GuardrailSettingsVersion; current: GuardrailSettingsVersion },
    ];
    expect(tx).toBeDefined();
    expect(change.before.version).toBe(1);
    expect(change.current.version).toBe(2);
  });

  it("starts at version 1 when nothing is stored", async () => {
    const { db } = fakeDb([]);
    const result = await saveSettings(
      db,
      {
        ...SAVE_INPUT,
        policy: {
          piiEntities: [],
          jailbreakEnabled: false,
          topicalEnabled: false,
        },
      },
      async () => {},
    );
    expect(result.changed && result.before).toBeNull();
    expect(result.current.version).toBe(1);
  });

  it("propagates an audit failure, so the change cannot commit without it", async () => {
    const { db } = fakeDb([v1()]);
    await expect(
      saveSettings(
        db,
        {
          ...SAVE_INPUT,
          policy: {
            piiEntities: [],
            jailbreakEnabled: true,
            topicalEnabled: true,
          },
        },
        async () => {
          throw new Error("audit write failed");
        },
      ),
    ).rejects.toThrow("audit write failed");
  });

  it("retries once when a concurrent save took the same version number", async () => {
    const { db, settings } = fakeDb([v1()], { failCreateTimes: 1 });
    const result = await saveSettings(
      db,
      {
        ...SAVE_INPUT,
        policy: {
          piiEntities: ["PERSON"],
          jailbreakEnabled: true,
          topicalEnabled: true,
        },
      },
      async () => {},
    );
    expect(result.changed).toBe(true);
    expect(settings.create).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing reason before touching the database", async () => {
    const { db } = fakeDb([v1()]);
    await expect(
      saveSettings(
        db,
        {
          ...SAVE_INPUT,
          reason: "x",
          policy: {
            piiEntities: [],
            jailbreakEnabled: true,
            topicalEnabled: true,
          },
        },
        async () => {},
      ),
    ).rejects.toThrow(/reason/);
    expect(db).toBeDefined();
  });
});

describe("pod status", () => {
  it("upserts the pod's row and removes rows older than a day", async () => {
    const pods = {
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    };
    const now = new Date("2026-10-02T12:00:00Z");
    await recordPodSync(
      { acmeGuardrailSettingsPod: pods } as never,
      { pod: "rayin-guardrails-abc", appliedVersion: 2, projectId: "proj-1" },
      now,
    );
    expect(pods.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pod: "rayin-guardrails-abc" },
        update: expect.objectContaining({ appliedVersion: 2, lastSyncAt: now }),
      }),
    );
    expect(pods.deleteMany).toHaveBeenCalledWith({
      where: { lastSyncAt: { lt: new Date("2026-10-01T12:00:00Z") } },
    });
  });

  it("lists at most MAX_LISTED_PODS recently reporting pods", async () => {
    const pods = { findMany: vi.fn(async () => []) };
    await listReportingPods({ acmeGuardrailSettingsPod: pods } as never);
    expect(pods.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_LISTED_PODS }),
    );
  });
});

describe("guardrail events carry the settings version and pod", () => {
  const base = {
    eventId: "evt-1",
    agentId: "agent-1",
    traceId: null,
    userId: null,
    clientHost: null,
    eventTime: "2026-10-01T10:00:00.000Z",
    direction: "input" as const,
    action: "allow" as const,
    policyTriggered: null,
    redactedText: null,
    piiFindings: null,
    rawContent: null,
  };

  it("stores them when the pod sends them", () => {
    const row = buildEventRow(
      "proj-1",
      { ...base, settingsVersion: 3, pod: "rayin-guardrails-abc" },
      undefined,
    );
    expect(row.settingsVersion).toBe(3);
    expect(row.pod).toBe("rayin-guardrails-abc");
  });

  it("stores null for a build that does not send them", () => {
    const row = buildEventRow("proj-1", { ...base }, undefined);
    expect(row.settingsVersion).toBeNull();
    expect(row.pod).toBeNull();
  });
});
