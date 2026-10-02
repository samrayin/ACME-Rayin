import { describe, it, expect, vi } from "vitest";
import {
  ALL_PII_ENTITIES,
  applyExpiredRevert,
  AUTOMATIC_CREATOR,
  canEditGuardrailSettings,
  effectiveMode,
  ENFORCE_CONFIRMATION,
  EVENT_FUTURE_SKEW_MS,
  guardrailEvidence,
  GuardrailModeNotAllowedError,
  judgeAvailability,
  JUDGE_UNAVAILABLE_ALERT_RATE,
  listReportingGateways,
  servedMode,
  listModeChanges,
  modeChangesOf,
  parseModeCeiling,
  saveMode,
  trialExpired,
  validateModeChange,
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
  revertAt?: Date | null;
  automatic?: boolean;
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
    findMany: vi.fn(async ({ take }: { take?: number } = {}) =>
      [...rows].sort((a, b) => b.version - a.version).slice(0, take),
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
      revert_at: null,
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

// ---------------------------------------------------------------- part b

// ADR-0005-B part b (CHG-2026-089): the enforcement switch.

const NOW = new Date("2026-10-02T10:00:00Z");
const MINUTE = 60_000;

function enforceRow(version: number, revertAt: Date | null): Row {
  return {
    ...v1(),
    version,
    mode: "enforce",
    revertAt,
    reason: "Supervised enforce trial",
    createdBy: "user-1",
    createdByEmail: "admin@example.com",
    createdAt: new Date(NOW.getTime() - 5 * MINUTE),
  };
}

describe("parseModeCeiling", () => {
  it("is enforce only on an explicit 'enforce', and record otherwise", () => {
    expect(parseModeCeiling("enforce")).toBe("enforce");
    expect(parseModeCeiling(" Enforce ")).toBe("enforce");
    for (const raw of [undefined, null, "", "record", "enforced", "true"]) {
      expect(parseModeCeiling(raw)).toBe("record");
    }
  });
});

describe("trialExpired / effectiveMode", () => {
  it("reads an enforce trial as record once its switch-back time has passed", () => {
    const due = { mode: "enforce" as const, revertAt: NOW };
    expect(trialExpired(due, NOW)).toBe(true);
    expect(effectiveMode(due, NOW)).toBe("record");
    const before = new Date(NOW.getTime() - 1);
    expect(trialExpired(due, before)).toBe(false);
    expect(effectiveMode(due, before)).toBe("enforce");
  });

  it("keeps enforce without a switch-back time, and record as record", () => {
    expect(effectiveMode({ mode: "enforce", revertAt: null }, NOW)).toBe(
      "enforce",
    );
    expect(effectiveMode({ mode: "record", revertAt: null }, NOW)).toBe(
      "record",
    );
  });
});

describe("validateModeChange", () => {
  const ok = {
    mode: "enforce" as const,
    ceiling: "enforce" as const,
    confirmation: ENFORCE_CONFIRMATION,
    revertAfterMinutes: 30,
    now: NOW,
  };

  it("refuses enforce under a record ceiling, whatever else is right (B1)", () => {
    expect(() => validateModeChange({ ...ok, ceiling: "record" })).toThrow(
      GuardrailModeNotAllowedError,
    );
  });

  it("needs the typed confirmation for enforce", () => {
    expect(() =>
      validateModeChange({ ...ok, confirmation: "enforce" }),
    ).toThrow(GuardrailSettingsValidationError);
    expect(() => validateModeChange({ ...ok, confirmation: null })).toThrow(
      GuardrailSettingsValidationError,
    );
  });

  it("sets the switch-back time from the chosen minutes, or none", () => {
    expect(validateModeChange(ok).revertAt).toEqual(
      new Date(NOW.getTime() + 30 * MINUTE),
    );
    expect(
      validateModeChange({ ...ok, revertAfterMinutes: null }).revertAt,
    ).toBeNull();
  });

  it("refuses a switch-back time that is not on offer", () => {
    expect(() => validateModeChange({ ...ok, revertAfterMinutes: 7 })).toThrow(
      GuardrailSettingsValidationError,
    );
  });

  it("lets record through under any ceiling, with no confirmation", () => {
    expect(
      validateModeChange({
        mode: "record",
        ceiling: "record",
        confirmation: null,
        revertAfterMinutes: 30,
        now: NOW,
      }),
    ).toEqual({ revertAt: null });
  });
});

describe("toSyncResponse in part b", () => {
  it("serves an enforce trial as enforce until its time, then as record", async () => {
    const revertAt = new Date(NOW.getTime() + MINUTE);
    const { db } = fakeDb([v1(), enforceRow(2, revertAt)]);
    const current = (await getCurrentSettings(db)) as GuardrailSettingsVersion;
    expect(toSyncResponse(current, NOW, "enforce").mode).toBe("enforce");
    expect(toSyncResponse(current, revertAt, "enforce").mode).toBe("record");
    expect(toSyncResponse(current, revertAt, "enforce").version).toBe(2);
  });
});

describe("saveMode", () => {
  it("stores a new version with the mode, the switch-back time and the same policy, audited", async () => {
    const { db, rows } = fakeDb([v1()]);
    const audit = vi.fn(async () => {});
    const revertAt = new Date(NOW.getTime() + 30 * MINUTE);
    const result = await saveMode(
      db,
      { ...SAVE_INPUT, mode: "enforce", revertAt, now: NOW },
      audit,
    );
    expect(result.changed).toBe(true);
    expect(rows.find((r) => r.version === 2)).toMatchObject({
      mode: "enforce",
      revertAt,
      piiEntities: ALL,
      jailbreakEnabled: true,
      topicalEnabled: true,
      createdBy: "user-1",
    });
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the mode in force already matches", async () => {
    const { db, settings } = fakeDb([v1()]);
    const audit = vi.fn(async () => {});
    const result = await saveMode(
      db,
      { ...SAVE_INPUT, mode: "record", revertAt: null, now: NOW },
      audit,
    );
    expect(result.changed).toBe(false);
    expect(settings.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("switches back to record and clears the switch-back time", async () => {
    const { db, rows } = fakeDb([
      v1(),
      enforceRow(2, new Date(NOW.getTime() + MINUTE)),
    ]);
    await saveMode(
      db,
      { ...SAVE_INPUT, mode: "record", revertAt: new Date(), now: NOW },
      async () => {},
    );
    expect(rows.find((r) => r.version === 3)).toMatchObject({
      mode: "record",
      revertAt: null,
    });
  });

  it("refuses when no settings are stored", async () => {
    const { db } = fakeDb([]);
    await expect(
      saveMode(
        db,
        { ...SAVE_INPUT, mode: "record", revertAt: null, now: NOW },
        async () => {},
      ),
    ).rejects.toThrow(GuardrailSettingsValidationError);
  });
});

describe("saveSettings keeps the mode", () => {
  const policy = {
    piiEntities: ["EMAIL_ADDRESS" as const],
    jailbreakEnabled: true,
    topicalEnabled: true,
  };

  it("keeps enforce and the trial's switch-back time on a policy change", async () => {
    const revertAt = new Date(NOW.getTime() + 10 * MINUTE);
    const { db, rows } = fakeDb([v1(), enforceRow(2, revertAt)]);
    await saveSettings(db, { ...SAVE_INPUT, policy, now: NOW }, async () => {});
    expect(rows.find((r) => r.version === 3)).toMatchObject({
      mode: "enforce",
      revertAt,
      piiEntities: ["EMAIL_ADDRESS"],
    });
  });

  it("writes record once the trial has ended", async () => {
    const { db, rows } = fakeDb([v1(), enforceRow(2, NOW)]);
    await saveSettings(db, { ...SAVE_INPUT, policy, now: NOW }, async () => {});
    expect(rows.find((r) => r.version === 3)).toMatchObject({
      mode: "record",
      revertAt: null,
    });
  });
});

describe("applyExpiredRevert (B6)", () => {
  it("does nothing while the trial runs, or in record", async () => {
    for (const rows of [
      [v1()],
      [v1(), enforceRow(2, new Date(NOW.getTime() + MINUTE))],
      [v1(), enforceRow(2, null)],
    ]) {
      const { db, settings } = fakeDb(rows);
      const audit = vi.fn(async () => {});
      const result = await applyExpiredRevert(
        db,
        { projectId: "proj-1", now: NOW },
        audit,
      );
      expect(result.changed).toBe(false);
      expect(settings.create).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    }
  });

  it("writes one automatic record version with the same policy, audited", async () => {
    const { db, rows } = fakeDb([v1(), enforceRow(2, NOW)]);
    const audit = vi.fn(async () => {});
    const result = await applyExpiredRevert(
      db,
      { projectId: "proj-1", now: NOW },
      audit,
    );
    expect(result.changed).toBe(true);
    expect(rows.find((r) => r.version === 3)).toMatchObject({
      mode: "record",
      revertAt: null,
      automatic: true,
      createdBy: AUTOMATIC_CREATOR,
      createdByEmail: null,
      piiEntities: ALL,
    });
    expect(rows.find((r) => r.version === 3)?.reason).toMatch(
      /Automatic switch-back to record/,
    );
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("writes it once when two pulls race: the loser finds record in force", async () => {
    const { db, settings, rows } = fakeDb([v1(), enforceRow(2, NOW)]);
    // The first create fails as if another pull had taken version 3; that
    // pull's row is what the retry then reads.
    settings.create.mockImplementationOnce(async () => {
      rows.push({
        ...v1(),
        version: 3,
        mode: "record",
        revertAt: null,
        automatic: true,
        createdBy: AUTOMATIC_CREATOR,
        createdAt: NOW,
      });
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
    });
    const audit = vi.fn(async () => {});
    const result = await applyExpiredRevert(
      db,
      { projectId: "proj-1", now: NOW },
      audit,
    );
    expect(result.changed).toBe(false);
    expect(rows.filter((r) => r.version === 3)).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("mode history", () => {
  it("lists the versions that changed the mode, not policy-only changes", async () => {
    const { db } = fakeDb([
      v1(),
      { ...v1(), version: 2, piiEntities: ["EMAIL_ADDRESS"] },
      enforceRow(3, new Date(NOW.getTime() + 30 * MINUTE)),
      {
        ...enforceRow(4, new Date(NOW.getTime() + 30 * MINUTE)),
        piiEntities: ["PERSON"],
      },
      {
        ...v1(),
        version: 5,
        automatic: true,
        createdBy: AUTOMATIC_CREATOR,
        reason: "Automatic switch-back to record",
      },
    ]);
    const changes = await listModeChanges(db);
    expect(changes.map((c) => [c.version, c.mode, c.previousMode])).toEqual([
      [3, "enforce", "record"],
      [5, "record", "enforce"],
    ]);
    expect(changes[1]?.automatic).toBe(true);
  });

  it("lists a change of an enforce trial's switch-back time", () => {
    const first = new Date(NOW.getTime() + 30 * MINUTE);
    const later = new Date(NOW.getTime() + 60 * MINUTE);
    const asVersion = (r: Row) =>
      ({
        ...r,
        mode: r.mode as "record" | "enforce",
        revertAt: r.revertAt ?? null,
        automatic: r.automatic ?? false,
      }) as unknown as GuardrailSettingsVersion;
    const changes = modeChangesOf([
      asVersion(v1()),
      asVersion(enforceRow(2, first)),
      asVersion(enforceRow(3, later)),
    ]);
    expect(changes.map((c) => c.version)).toEqual([2, 3]);
  });
});

describe("guardrail events carry the gateway's report (part b)", () => {
  const base = {
    eventId: "evt-2",
    agentId: "agent-1",
    traceId: null,
    userId: null,
    clientHost: null,
    eventTime: "2026-10-02T10:00:00.000Z",
    direction: "input" as const,
    action: "allow" as const,
    policyTriggered: null,
    redactedText: null,
    piiFindings: null,
    rawContent: null,
  };

  it("stores the gateway pod, mode and settings version when sent", () => {
    const row = buildEventRow(
      "proj-1",
      {
        ...base,
        gatewayPod: "litellm-6f9c-abcde",
        gatewayMode: "record",
        gatewaySettingsVersion: 4,
      },
      undefined,
    );
    expect(row.gatewayPod).toBe("litellm-6f9c-abcde");
    expect(row.gatewayMode).toBe("record");
    expect(row.gatewaySettingsVersion).toBe(4);
  });

  it("stores null when the caller does not report", () => {
    const row = buildEventRow("proj-1", { ...base }, undefined);
    expect(row.gatewayPod).toBeNull();
    expect(row.gatewayMode).toBeNull();
    expect(row.gatewaySettingsVersion).toBeNull();
  });
});

// CHG-2026-089 part b, phase 2: the console parts (owner decision 2026-10-02:
// a separate console PR for SF-2026-023, -024 and -026, and the judge-
// unavailable events of Readiness Ledger N-64).

describe("the console's ceiling caps what it serves (SF-2026-023)", () => {
  it("serves a stored enforce as record while the ceiling is record", async () => {
    const revertAt = new Date(NOW.getTime() + 30 * MINUTE);
    const { db } = fakeDb([v1(), enforceRow(2, revertAt)]);
    const current = (await getCurrentSettings(db)) as GuardrailSettingsVersion;
    expect(servedMode(current, NOW, "record")).toBe("record");
    expect(servedMode(current, NOW, "enforce")).toBe("enforce");
    const body = toSyncResponse(current, NOW, "record");
    expect(body.mode).toBe("record");
    expect(body.revert_at).toBeNull();
  });

  it("defaults to the record ceiling when none is passed", async () => {
    const { db } = fakeDb([v1(), enforceRow(2, null)]);
    const current = (await getCurrentSettings(db)) as GuardrailSettingsVersion;
    expect(toSyncResponse(current, NOW).mode).toBe("record");
  });
});

describe("the switch-back time travels with the settings (SF-2026-024)", () => {
  it("is sent while a trial is served as enforce, and not after", async () => {
    const revertAt = new Date(NOW.getTime() + 30 * MINUTE);
    const { db } = fakeDb([v1(), enforceRow(2, revertAt)]);
    const current = (await getCurrentSettings(db)) as GuardrailSettingsVersion;
    expect(toSyncResponse(current, NOW, "enforce").revert_at).toBe(
      revertAt.toISOString(),
    );
    const after = toSyncResponse(current, revertAt, "enforce");
    expect(after.mode).toBe("record");
    expect(after.revert_at).toBeNull();
  });

  it("is null for an enforce version with no switch-back", async () => {
    const { db } = fakeDb([v1(), enforceRow(2, null)]);
    const current = (await getCurrentSettings(db)) as GuardrailSettingsVersion;
    const body = toSyncResponse(current, NOW, "enforce");
    expect(body.mode).toBe("enforce");
    expect(body.revert_at).toBeNull();
  });
});

function eventsDb(groups: unknown[]) {
  const groupBy = vi.fn(async (_args: unknown) => groups);
  return { db: { acmeGuardrailEvent: { groupBy } } as never, groupBy };
}

describe("gateway replicas are aggregated in the database (SF-2026-026)", () => {
  it("keeps each pod's latest report and orders by it", async () => {
    const t = (min: number) => new Date(NOW.getTime() - min * MINUTE);
    const { db, groupBy } = eventsDb([
      {
        gatewayPod: "gw-a",
        gatewayMode: "record",
        gatewaySettingsVersion: 3,
        _max: { eventTime: t(30) },
      },
      {
        gatewayPod: "gw-a",
        gatewayMode: "enforce",
        gatewaySettingsVersion: 4,
        _max: { eventTime: t(5) },
      },
      {
        gatewayPod: "gw-b",
        gatewayMode: "record",
        gatewaySettingsVersion: 4,
        _max: { eventTime: t(10) },
      },
      {
        gatewayPod: null,
        gatewayMode: null,
        gatewaySettingsVersion: null,
        _max: { eventTime: t(1) },
      },
    ]);
    const rows = await listReportingGateways(db, { projectId: "p", now: NOW });
    expect(rows).toEqual([
      { pod: "gw-a", mode: "enforce", settingsVersion: 4, lastSeenAt: t(5) },
      { pod: "gw-b", mode: "record", settingsVersion: 4, lastSeenAt: t(10) },
    ]);
    const args = groupBy.mock.calls[0]![0] as {
      by: string[];
      where: { eventTime: { gte: Date; lte: Date } };
    };
    expect(args.by).toEqual([
      "gatewayPod",
      "gatewayMode",
      "gatewaySettingsVersion",
    ]);
    expect(args.where.eventTime.lte).toEqual(
      new Date(NOW.getTime() + EVENT_FUTURE_SKEW_MS),
    );
  });

  it("reads an unknown mode as unknown, not as a mode", async () => {
    const { db } = eventsDb([
      {
        gatewayPod: "gw-a",
        gatewayMode: "block",
        gatewaySettingsVersion: 1,
        _max: { eventTime: NOW },
      },
    ]);
    const [row] = await listReportingGateways(db, { projectId: "p", now: NOW });
    expect(row?.mode).toBeNull();
  });
});

describe("evidence and judge availability (N-64)", () => {
  const groups = [
    { action: "ALLOW", _count: { _all: 90 } },
    { action: "BLOCK", _count: { _all: 5 } },
    { action: "REDACT", _count: { _all: 3 } },
    { action: "UNAVAILABLE", _count: { _all: 2 } },
  ];

  it("counts decisions without a verdict in the evidence", async () => {
    const { db, groupBy } = eventsDb(groups);
    const evidence = await guardrailEvidence(db, { projectId: "p", now: NOW });
    expect(evidence).toMatchObject({
      total: 100,
      blocked: 5,
      redacted: 3,
      allowed: 90,
      unavailable: 2,
    });
    const args = groupBy.mock.calls[0]![0] as {
      where: { eventTime: { lte: Date } };
    };
    expect(args.where.eventTime.lte).toEqual(
      new Date(NOW.getTime() + EVENT_FUTURE_SKEW_MS),
    );
  });

  it("raises the alert at the alert rate, with at least one case", async () => {
    const { db } = eventsDb(groups);
    const judge = await judgeAvailability(db, { projectId: "p", now: NOW });
    expect(judge).toMatchObject({
      calls: 100,
      unavailable: 2,
      rate: 0.02,
      alertRate: JUDGE_UNAVAILABLE_ALERT_RATE,
      alert: true,
      windowHours: 24,
    });
  });

  it("stays quiet below the rate, and with no calls at all", async () => {
    const below = eventsDb([
      { action: "ALLOW", _count: { _all: 999 } },
      { action: "UNAVAILABLE", _count: { _all: 1 } },
    ]);
    expect(
      (await judgeAvailability(below.db, { projectId: "p", now: NOW })).alert,
    ).toBe(false);
    const none = eventsDb([]);
    const judge = await judgeAvailability(none.db, {
      projectId: "p",
      now: NOW,
    });
    expect(judge).toMatchObject({ calls: 0, rate: null, alert: false });
  });
});

describe("a pushed event with no verdict (N-64)", () => {
  const base = {
    eventId: "evt-nv",
    agentId: "agent-1",
    traceId: null,
    userId: null,
    clientHost: null,
    eventTime: "2026-10-02T10:00:00.000Z",
    direction: "input" as const,
    action: "unavailable" as const,
    policyTriggered: "Judge unavailable: rate limited",
    redactedText: null,
    piiFindings: null,
    rawContent: null,
  };

  it("is stored as UNAVAILABLE", () => {
    const row = buildEventRow("proj-1", base, undefined);
    expect(row.action).toBe("UNAVAILABLE");
    expect(row.policyTriggered).toBe("Judge unavailable: rate limited");
  });

  it("stores no content even if some is sent", () => {
    const encrypt = vi.fn(() => "cipher");
    const row = buildEventRow(
      "proj-1",
      {
        ...base,
        redactedText: "my email is <EMAIL>",
        rawContent: "raw text",
        piiFindings: [
          { entity_type: "EMAIL_ADDRESS", start: 0, end: 1, score: 1 },
        ],
      },
      "a".repeat(64),
      encrypt,
    );
    expect(row.redactedText).toBeNull();
    expect(row.rawContentEncrypted).toBeNull();
    expect(row.piiFindings).toBeUndefined();
    expect(encrypt).not.toHaveBeenCalled();
  });
});

describe("an enforce version the ceiling does not allow is written down (P2-269-2)", () => {
  it("writes an automatic record version, audited, under a record ceiling", async () => {
    const { db, rows } = fakeDb([v1(), enforceRow(2, null)]);
    const audit = vi.fn(async () => {});
    const result = await applyExpiredRevert(
      db,
      { projectId: "proj-1", now: NOW, ceiling: "record" },
      audit,
    );
    expect(result.changed).toBe(true);
    const written = rows.find((r) => r.version === 3);
    expect(written).toMatchObject({
      mode: "record",
      automatic: true,
      revertAt: null,
    });
    expect(written?.reason).toMatch(
      /ceiling \(CAIRO_GUARDRAIL_MODE_MAX\) is record/,
    );
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("leaves a running trial alone when the ceiling allows enforce", async () => {
    const { db, settings } = fakeDb([
      v1(),
      enforceRow(2, new Date(NOW.getTime() + MINUTE)),
    ]);
    const result = await applyExpiredRevert(
      db,
      { projectId: "proj-1", now: NOW, ceiling: "enforce" },
      vi.fn(async () => {}),
    );
    expect(result.changed).toBe(false);
    expect(settings.create).not.toHaveBeenCalled();
  });

  it("writes nothing for a record version under a record ceiling", async () => {
    const { db, settings } = fakeDb([v1()]);
    const result = await applyExpiredRevert(
      db,
      { projectId: "proj-1", now: NOW, ceiling: "record" },
      vi.fn(async () => {}),
    );
    expect(result.changed).toBe(false);
    expect(settings.create).not.toHaveBeenCalled();
  });
});
