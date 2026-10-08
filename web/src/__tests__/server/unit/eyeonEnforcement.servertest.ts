import { describe, it, expect } from "vitest";
import {
  type GuardrailModeChange,
  type GuardrailSettingsVersion,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  dailyModes,
  enforcementMode,
  gatewayAgreement,
  lastTrial,
  modeHistory,
  podAgreement,
  policiesInForce,
} from "@/src/features/acme-enhancements/server/eyeonEnforcement";
import {
  changeTitle,
  enforcementHeadline,
  formatMinutes,
  gatewaysHeadline,
  gatewaysStatus,
  modeMeaning,
  modeName,
  podsHeadline,
  podsStatus,
} from "@/src/features/acme-enhancements/utils/eyeonEnforcementLabels";
import { changedByText } from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";

// CHG-2026-138 (ADR-0027): the EYEON Enforcement and policy page's pure
// functions: its figures and its wording. Follow-up (owner decisions,
// 2026-10-07): who changed the mode and why are passed on as the Guardrails
// page shows them, never the user id; the pods are counted, never named.

const NOW = new Date("2026-10-07T12:00:00.000Z");
const MIN = 60_000;

function settings(
  extra: Partial<GuardrailSettingsVersion> = {},
): GuardrailSettingsVersion {
  return {
    version: 7,
    mode: "record",
    revertAt: null,
    automatic: false,
    piiEntities: ["EMAIL_ADDRESS"],
    jailbreakEnabled: true,
    topicalEnabled: true,
    reason: "SECRET-REASON",
    createdBy: "SECRET-USER",
    createdByEmail: "SECRET-EMAIL",
    createdAt: new Date(NOW.getTime() - 60 * MIN),
    ...extra,
  };
}

function change(
  version: number,
  minutesAgo: number,
  mode: "record" | "enforce",
  previousMode: "record" | "enforce" | null,
  extra: Partial<GuardrailModeChange> = {},
): GuardrailModeChange {
  return {
    version,
    mode,
    previousMode,
    revertAt: null,
    automatic: false,
    reason: `Reason typed for version ${version}`,
    createdBy: "SECRET-USER",
    createdByEmail: "EDITOR-EMAIL",
    createdAt: new Date(NOW.getTime() - minutesAgo * MIN),
    ...extra,
  };
}

describe("enforcementMode", () => {
  it("serves the version in force under the ceiling", () => {
    const m = enforcementMode(
      settings({ mode: "enforce" }),
      [change(7, 60, "enforce", "record")],
      NOW,
      "enforce",
    );
    expect(m).toMatchObject({
      mode: "enforce",
      ceiling: "enforce",
      version: 7,
      storedMode: "enforce",
      cappedByCeiling: false,
      switchBackDue: false,
      lastChange: {
        to: "enforce",
        automatic: false,
        createdByEmail: null,
        reason: "Reason typed for version 7",
      },
    });
    expect(JSON.stringify(m)).not.toMatch(/SECRET-|EDITOR-EMAIL|"createdBy"/);
  });

  it("names the person by email only for a guardrail administrator", () => {
    const m = enforcementMode(
      settings({ mode: "enforce" }),
      [change(7, 60, "enforce", "record")],
      NOW,
      "enforce",
      true,
    );
    expect(m.lastChange).toEqual({
      at: new Date(NOW.getTime() - 60 * MIN).toISOString(),
      to: "enforce",
      automatic: false,
      createdByEmail: "EDITOR-EMAIL",
      reason: "Reason typed for version 7",
    });
    expect(JSON.stringify(m)).not.toContain("SECRET-USER");
  });

  it("serves a stored enforce as record under a record ceiling, and says so", () => {
    const m = enforcementMode(settings({ mode: "enforce" }), [], NOW, "record");
    expect(m).toMatchObject({
      mode: "record",
      storedMode: "enforce",
      cappedByCeiling: true,
      trialEndsAt: null,
    });
  });

  it("reads an ended trial as record, with its switch-back due", () => {
    const m = enforcementMode(
      settings({
        mode: "enforce",
        revertAt: new Date(NOW.getTime() - MIN),
      }),
      [],
      NOW,
      "enforce",
    );
    expect(m).toMatchObject({
      mode: "record",
      switchBackDue: true,
      cappedByCeiling: false,
      trialEndsAt: null,
    });
  });

  it("is not reported without settings", () => {
    expect(enforcementMode(null, [], NOW, "enforce")).toEqual({
      mode: null,
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: null,
      version: null,
      storedMode: null,
      cappedByCeiling: false,
      switchBackDue: false,
    });
  });
});

describe("dailyModes", () => {
  it("has one point per UTC day, zeros where nothing happened, and the rest as not reported", () => {
    const start = new Date("2026-10-01T00:00:00.000Z");
    const points = dailyModes(start, 3, [
      { day: "2026-10-02", checks: 10, enforceMode: 4, recordMode: 5 },
      { day: "2026-10-02", checks: 2, enforceMode: 0, recordMode: 0 },
      { day: "2026-09-30", checks: 50, enforceMode: 50, recordMode: 0 },
    ]);
    expect(points).toEqual([
      {
        day: "2026-10-01",
        checks: 0,
        enforceMode: 0,
        recordMode: 0,
        notReported: 0,
      },
      {
        day: "2026-10-02",
        checks: 12,
        enforceMode: 4,
        recordMode: 5,
        notReported: 3,
      },
      {
        day: "2026-10-03",
        checks: 0,
        enforceMode: 0,
        recordMode: 0,
        notReported: 0,
      },
    ]);
  });
});

describe("modeHistory", () => {
  const changes = [
    change(2, 3 * 24 * 60, "enforce", "record", {
      revertAt: new Date(NOW.getTime() - (3 * 24 * 60 - 30) * MIN),
    }),
    change(3, 3 * 24 * 60 - 30, "record", "enforce", {
      createdBy: "automatic",
    }),
    change(5, 30, "enforce", "record"),
  ];

  it("lists newest first, when and to what, and counts the period", () => {
    const h = modeHistory(changes, new Date(NOW.getTime() - 24 * 60 * MIN), 2);
    expect(h.total).toBe(3);
    expect(h.inPeriod).toBe(1);
    expect(h.shown.map((r) => r.version)).toEqual([5, 3]);
    // Written by the automatic switch-back, by its creator marker.
    expect(h.shown[1]).toMatchObject({ automatic: true, from: "enforce" });
  });

  it("says who and why as the Guardrails page does: no email by default, never the user id", () => {
    const h = modeHistory(changes, NOW, 10);
    expect(
      h.shown.map((r) => [r.automatic, r.createdByEmail, r.reason]),
    ).toEqual([
      [false, null, "Reason typed for version 5"],
      [true, null, "Reason typed for version 3"],
      [false, null, "Reason typed for version 2"],
    ]);
    expect(JSON.stringify(h)).not.toMatch(/SECRET-|EDITOR-EMAIL|"createdBy"/);
  });

  it("gives a guardrail administrator the person's email, and none for an automatic change", () => {
    const h = modeHistory(changes, NOW, 10, true);
    expect(h.shown.map((r) => r.createdByEmail)).toEqual([
      "EDITOR-EMAIL",
      null,
      "EDITOR-EMAIL",
    ]);
    expect(Object.keys(h.shown[0]!).sort()).toEqual(
      [
        "at",
        "automatic",
        "createdByEmail",
        "from",
        "inPeriod",
        "reason",
        "switchBackAt",
        "to",
        "version",
      ].sort(),
    );
    expect(JSON.stringify(h)).not.toContain("SECRET-USER");
  });

  it("gives a trial its switch-back time", () => {
    const h = modeHistory(changes, NOW, 10);
    expect(h.shown[2]?.switchBackAt).toBe(changes[0]!.revertAt!.toISOString());
    expect(h.inPeriod).toBe(0);
  });
});

describe("lastTrial", () => {
  const trialStart = 120;
  const trial = change(4, trialStart, "enforce", "record", {
    revertAt: new Date(NOW.getTime() - (trialStart - 15) * MIN),
  });

  it("is null without an enforce trial", () => {
    expect(lastTrial([change(4, 10, "enforce", "record")], null)).toBeNull();
  });

  it("is running while the served trial is this one", () => {
    const running = change(4, 5, "enforce", "record", {
      revertAt: new Date(NOW.getTime() + 25 * MIN),
    });
    expect(lastTrial([running], running.revertAt!.toISOString())).toMatchObject(
      { outcome: "running", minutes: 30, endedAt: null },
    );
  });

  it("is served as record when no later version is recorded yet", () => {
    expect(lastTrial([trial], null)).toMatchObject({
      outcome: "servedAsRecord",
      minutes: 15,
    });
  });

  it("names an automatic switch-back, and a person's change apart", () => {
    const auto = change(5, trialStart - 15, "record", "enforce", {
      automatic: true,
    });
    expect(lastTrial([trial, auto], null)).toMatchObject({
      outcome: "automatic",
      endedTo: "record",
      endedAt: auto.createdAt.toISOString(),
    });
    const manual = change(5, trialStart - 5, "record", "enforce");
    expect(lastTrial([trial, manual], null)).toMatchObject({
      outcome: "changed",
      endedTo: "record",
    });
  });
});

describe("podAgreement", () => {
  const at = (secondsAgo: number) =>
    new Date(NOW.getTime() - secondsAgo * 1000);

  it("agrees when every reporting pod is on the version in force; stale pods are not counted", () => {
    const p = podAgreement(
      [
        { appliedVersion: 7, lastSyncAt: at(10) },
        { appliedVersion: 6, lastSyncAt: at(600) },
        { appliedVersion: 7, lastSyncAt: at(120) },
      ],
      7,
      NOW,
    );
    expect(p).toEqual({
      reporting: 2,
      onCurrent: 2,
      older: 0,
      unknown: 0,
      stale: 1,
      currentVersion: 7,
      staleAfterSeconds: 120,
      agree: true,
    });
  });

  it("disagrees on an older version or settings unknown, in counts", () => {
    const p = podAgreement(
      [
        { appliedVersion: 7, lastSyncAt: at(5) },
        { appliedVersion: null, lastSyncAt: at(5) },
        { appliedVersion: 6, lastSyncAt: at(5) },
      ],
      7,
      NOW,
    );
    expect(p).toMatchObject({
      reporting: 3,
      onCurrent: 1,
      older: 1,
      unknown: 1,
      stale: 0,
      agree: false,
    });
  });

  it("never passes on a pod's name, even if a row carries one", () => {
    // A careless read that returned the name column: nothing names a pod.
    const rows = [
      { pod: "guard-pod-SECRET-a", appliedVersion: 7, lastSyncAt: at(5) },
      { pod: "guard-pod-SECRET-b", appliedVersion: 6, lastSyncAt: at(900) },
    ];
    const p = podAgreement(rows, 7, NOW);
    expect(JSON.stringify(p)).not.toContain("guard-pod");
    expect(Object.keys(p).sort()).toEqual(
      [
        "agree",
        "currentVersion",
        "older",
        "onCurrent",
        "reporting",
        "stale",
        "staleAfterSeconds",
        "unknown",
      ].sort(),
    );
  });

  it("has nothing to agree on without reporting pods or settings", () => {
    expect(
      podAgreement([{ appliedVersion: 7, lastSyncAt: at(900) }], 7, NOW).agree,
    ).toBeNull();
    expect(
      podAgreement([{ appliedVersion: 7, lastSyncAt: at(5) }], null, NOW).agree,
    ).toBeNull();
  });
});

describe("gatewayAgreement", () => {
  const seen = (minutesAgo: number) =>
    new Date(NOW.getTime() - minutesAgo * MIN);

  it("is empty without replicas", () => {
    expect(gatewayAgreement([], "record", null)).toEqual({
      replicas: 0,
      byMode: { enforce: 0, record: 0, notReported: 0 },
      versions: [],
      sameMode: null,
      matchesServed: null,
      beforeLastChange: 0,
      lastSeenAt: null,
    });
  });

  it("matches when every replica reports the mode served", () => {
    const g = gatewayAgreement(
      [
        {
          pod: "gw-a",
          mode: "record",
          settingsVersion: 7,
          lastSeenAt: seen(1),
        },
        {
          pod: "gw-b",
          mode: "record",
          settingsVersion: 7,
          lastSeenAt: seen(3),
        },
      ],
      "record",
      null,
    );
    expect(g).toMatchObject({
      replicas: 2,
      sameMode: true,
      matchesServed: true,
      versions: [7],
      lastSeenAt: seen(1).toISOString(),
    });
    expect(JSON.stringify(g)).not.toContain("gw-");
  });

  it("compares only replicas seen since the last change; a missing mode differs", () => {
    const changedAt = seen(10).toISOString();
    const g = gatewayAgreement(
      [
        {
          pod: "gw-a",
          mode: "enforce",
          settingsVersion: 7,
          lastSeenAt: seen(1),
        },
        { pod: "gw-b", mode: null, settingsVersion: null, lastSeenAt: seen(2) },
        {
          pod: "gw-c",
          mode: "record",
          settingsVersion: 6,
          lastSeenAt: seen(60),
        },
      ],
      "enforce",
      changedAt,
    );
    expect(g).toMatchObject({
      byMode: { enforce: 1, record: 1, notReported: 1 },
      versions: [6, 7],
      sameMode: false,
      matchesServed: false,
      beforeLastChange: 1,
    });
    const onlyBefore = gatewayAgreement(
      [
        {
          pod: "gw-c",
          mode: "record",
          settingsVersion: 6,
          lastSeenAt: seen(60),
        },
      ],
      "enforce",
      changedAt,
    );
    expect(onlyBefore.matchesServed).toBeNull();
  });
});

describe("policiesInForce", () => {
  const split = (enforced: number, notEnforced: number) => ({
    enforced,
    notEnforced,
  });
  const refusal = (
    type: "jailbreak" | "offTopic" | "oversized" | "harmfulContent" | "other",
    label: string,
    enforced: number,
    notEnforced: number,
  ) => ({
    type,
    label,
    count: enforced + notEnforced,
    split: split(enforced, notEnforced),
    prompts: enforced + notEnforced,
    answers: 0,
  });

  it("is null without settings", () => {
    expect(policiesInForce(null, [], split(0, 0), 7)).toBeNull();
  });

  it("maps refusals to the policies, and the rest to other labels", () => {
    const p = policiesInForce(
      settings({ topicalEnabled: false, piiEntities: [] }),
      [
        refusal("jailbreak", "Jailbreak or misuse", 2, 1),
        refusal("oversized", "Too large to check", 0, 1),
        refusal("harmfulContent", "Harmful content", 1, 0),
        refusal("other", "Other", 0, 2),
      ],
      split(3, 4),
      7,
    );
    expect(p).toEqual({
      version: 7,
      savedAt: settings().createdAt.toISOString(),
      jailbreak: {
        enabled: true,
        refusals: { enforced: 2, notEnforced: 1, prompts: 3, answers: 0 },
      },
      topical: {
        enabled: false,
        refusals: { enforced: 0, notEnforced: 0, prompts: 0, answers: 0 },
      },
      personalData: {
        entities: [],
        available: 7,
        redactions: { enforced: 3, notEnforced: 4 },
      },
      oversized: {
        refusals: { enforced: 0, notEnforced: 1, prompts: 1, answers: 0 },
      },
      other: {
        refusals: { enforced: 1, notEnforced: 2, prompts: 3, answers: 0 },
        types: ["Harmful content", "Other"],
      },
    });
    expect(JSON.stringify(p)).not.toContain("SECRET-");
  });
});

describe("the page's wording", () => {
  it("names the mode, never as a bare colour", () => {
    expect(modeName("enforce")).toBe("Enforce mode");
    expect(modeName("record")).toBe("Record mode");
    expect(modeName(null)).toBe("Not reported");
    expect(enforcementHeadline("record")).toBe(
      "EYEON is recording, not enforcing.",
    );
    expect(enforcementHeadline("enforce")).toBe(
      "EYEON is enforcing on gateway traffic.",
    );
    expect(enforcementHeadline(null)).toMatch(/No guardrail settings/);
    expect(modeMeaning("record")).toMatch(/reaches the model unchanged/);
    expect(modeMeaning(null)).toMatch(/not applied/);
  });

  it("tells a change by when and to what", () => {
    expect(changeTitle("record", "enforce")).toBe("Record to Enforce");
    expect(changeTitle("enforce", "record")).toBe("Enforce to Record");
    expect(changeTitle(null, "enforce")).toBe(
      "Enforce, the first version stored",
    );
    expect(changeTitle("enforce", "enforce")).toBe(
      "Enforce, switch-back time changed",
    );
  });

  it("formats lengths", () => {
    expect(formatMinutes(5)).toBe("5 minutes");
    expect(formatMinutes(60)).toBe("1 hour");
    expect(formatMinutes(120)).toBe("2 hours");
    expect(formatMinutes(90)).toBe("90 minutes");
  });

  it("says who made a change as the Guardrails page does", () => {
    expect(changedByText({ automatic: true, createdByEmail: null })).toBe(
      "the automatic switch-back",
    );
    expect(
      changedByText({ automatic: false, createdByEmail: "EDITOR-EMAIL" }),
    ).toBe("EDITOR-EMAIL");
    expect(changedByText({ automatic: false, createdByEmail: null })).toBe(
      "a guardrail administrator",
    );
  });

  it("tells pod agreement in versions", () => {
    const base = { reporting: 2, onCurrent: 2, stale: 0, currentVersion: 7 };
    expect(podsHeadline({ ...base, agree: true })).toBe(
      "2 of 2 reporting pods applied settings v7, the version in force.",
    );
    expect(podsStatus({ ...base, agree: true })).toEqual({
      text: "Reporting pods agree",
      tone: "good",
    });
    expect(podsStatus({ ...base, onCurrent: 1, agree: false }).tone).toBe(
      "bad",
    );
    expect(
      podsHeadline({ ...base, reporting: 0, onCurrent: 0, agree: null }),
    ).toBe("No guardrail pod reported recently.");
    expect(podsStatus({ ...base, agree: null }).tone).toBe("neutral");
  });

  it("tells the gateway replicas' modes against the mode served", () => {
    const g = {
      replicas: 3,
      byMode: { enforce: 0, record: 3, notReported: 0 },
      sameMode: true,
      matchesServed: true,
      beforeLastChange: 0,
    };
    expect(gatewaysHeadline(g, "record")).toBe(
      "3 gateway replicas reported with their latest decision: 3 Record mode. Those seen since the last change match Record mode, the mode EYEON serves.",
    );
    expect(gatewaysStatus(g).tone).toBe("good");
    expect(gatewaysStatus({ ...g, matchesServed: false }).tone).toBe("bad");
    expect(
      gatewaysHeadline({ ...g, replicas: 0, matchesServed: null }, "record"),
    ).toMatch(/No gateway replica reported/);
    expect(gatewaysHeadline({ ...g, matchesServed: null }, "record")).toMatch(
      /None decided since the last change of mode/,
    );
  });
});
