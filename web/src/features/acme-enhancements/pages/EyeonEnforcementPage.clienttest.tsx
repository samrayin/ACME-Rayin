import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonEnforcementPage from "@/src/features/acme-enhancements/pages/EyeonEnforcementPage";
import {
  EyeonModeScale,
  modeScaleLabel,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonModeScale";

// CHG-2026-138 (ADR-0027): the EYEON Enforcement and policy page on fixed
// figures. Display only: no switch, a link to Guardrails; the mode always
// with its ceiling; changes told by when, to what, who and why (owner
// decision, 2026-10-07: who as on the Guardrails page, the reason as plain
// text, never HTML); pods in versions and counts, never named; what is not
// recorded says so; the switched-off page links to Guardrails. And the kit's
// mode-against-ceiling scale.

const h = vi.hoisted(() => ({ result: {} as unknown }));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonEnforcement: {
      summary: { useQuery: () => h.result },
    },
  },
}));
vi.mock("@/src/hooks/useProjectIdFromURL", () => ({
  default: () => "p1",
}));
vi.mock("@/src/components/layouts/page", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const split = (enforced: number, notEnforced: number) => ({
  enforced,
  notEnforced,
});
const refusals = (
  enforced: number,
  notEnforced: number,
  prompts: number,
  answers: number,
) => ({ ...split(enforced, notEnforced), prompts, answers });

const GENERATED = "2026-10-07T12:00:00.000Z";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true as const,
    windowDays: 7,
    generatedAt: GENERATED,
    mode: {
      mode: "record",
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: {
        at: "2026-10-06T09:00:00.000Z",
        to: "record",
        automatic: true,
        createdByEmail: null,
        reason: "Automatic switch-back to record: the trial ended.",
      },
      version: 14,
      storedMode: "record",
      cappedByCeiling: false,
      switchBackDue: false,
    },
    decisions: {
      checks: 200,
      promptChecks: 150,
      answerChecks: 50,
      allowed: 180,
      promptsRefused: split(0, 6),
      answersWithheld: split(0, 2),
      redactions: split(1, 9),
      noVerdict: 2,
      enforcedChecks: 20,
      enforcedPct: 10,
    },
    daily: [
      {
        day: "2026-10-06",
        checks: 120,
        enforceMode: 20,
        recordMode: 90,
        notReported: 10,
      },
      {
        day: "2026-10-07",
        checks: 80,
        enforceMode: 0,
        recordMode: 80,
        notReported: 0,
      },
    ],
    history: {
      shown: [
        {
          version: 14,
          at: "2026-10-06T09:00:00.000Z",
          from: "enforce",
          to: "record",
          switchBackAt: null,
          automatic: true,
          createdByEmail: null,
          reason: "Automatic switch-back to record: the trial ended.",
          inPeriod: true,
        },
        {
          version: 13,
          at: "2026-10-06T08:30:00.000Z",
          from: "record",
          to: "enforce",
          switchBackAt: "2026-10-06T09:00:00.000Z",
          automatic: false,
          createdByEmail: null,
          reason: "Half-hour enforce trial for the claims bot",
          inPeriod: true,
        },
        {
          version: 9,
          at: "2026-09-01T08:00:00.000Z",
          from: null,
          to: "enforce",
          switchBackAt: null,
          automatic: false,
          createdByEmail: "EDITOR-EMAIL",
          reason: "First enforce version",
          inPeriod: false,
        },
      ],
      inPeriod: 2,
      total: 3,
      limit: 10,
    },
    trial: {
      last: {
        startedAt: "2026-10-06T08:30:00.000Z",
        switchBackAt: "2026-10-06T09:00:00.000Z",
        minutes: 30,
        outcome: "automatic",
        endedAt: "2026-10-06T09:00:00.000Z",
        endedTo: "record",
      },
      defaultMinutes: 30,
      options: [5, 15, 30, 60, 120],
    },
    pods: {
      reporting: 2,
      onCurrent: 1,
      older: 1,
      unknown: 0,
      stale: 1,
      currentVersion: 14,
      staleAfterSeconds: 120,
      agree: false,
    },
    gateways: {
      replicas: 2,
      byMode: { enforce: 0, record: 2, notReported: 0 },
      versions: [14],
      sameMode: true,
      matchesServed: true,
      beforeLastChange: 0,
      lastSeenAt: "2026-10-07T11:58:00.000Z",
    },
    judge: {
      windowHours: 24,
      checks: 100,
      noVerdict: 2,
      rate: 0.02,
      alertRate: 0.01,
      alert: true,
    },
    policies: {
      version: 14,
      savedAt: "2026-10-06T09:00:00.000Z",
      jailbreak: { enabled: true, refusals: refusals(0, 6, 6, 0) },
      topical: { enabled: false, refusals: refusals(0, 2, 0, 2) },
      personalData: {
        entities: ["EMAIL_ADDRESS", "BH_CPR"],
        available: 7,
        redactions: split(1, 9),
      },
      oversized: { refusals: refusals(0, 0, 0, 0) },
      other: { refusals: refusals(0, 0, 0, 0), types: [] },
    },
    howItChanges: { confirmationWord: "ENFORCE", podStaleAfterSeconds: 120 },
    viewerCanSwitch: false,
    ...overrides,
  };
}

function show(overrides: Record<string, unknown> = {}) {
  h.result = { isPending: false, isError: false, data: summary(overrides) };
  render(<EyeonEnforcementPage />);
}

describe("EYEON Enforcement and policy page (CHG-2026-138)", () => {
  beforeEach(() => {
    h.result = { isPending: false, isError: false, data: summary() };
  });

  it("says it is switched off and links to Guardrails", () => {
    h.result = { isPending: false, isError: false, data: { enabled: false } };
    render(<EyeonEnforcementPage />);
    expect(screen.getByText(/is switched off on this deployment/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open Guardrails" }),
    ).toHaveAttribute("href", "/project/p1/acme-enhancements/guardrails");
  });

  it("is display only: no switch, no button, and a link to Guardrails", () => {
    show();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(
      screen.getByText(/Display only\. The mode and the policies/),
    ).toBeTruthy();
    const links = screen
      .getAllByRole("link", { name: "Open Guardrails" })
      .map((a) => a.getAttribute("href"));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links)
      expect(href).toBe("/project/p1/acme-enhancements/guardrails");
  });

  it("tells a guardrail administrator where to make the change", () => {
    show({ viewerCanSwitch: true });
    expect(
      screen.getByRole("link", { name: "Change the mode on Guardrails" }),
    ).toHaveAttribute("href", "/project/p1/acme-enhancements/guardrails");
    expect(
      screen.getByText(/You are one of this deployment's guardrail/),
    ).toBeTruthy();
  });

  it("shows the mode with its ceiling, and against it on the scale", () => {
    show();
    expect(screen.getByText("EYEON is recording, not enforcing.")).toBeTruthy();
    expect(screen.getAllByText("Record mode").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", {
        name: "Mode against ceiling. Mode: Record mode. Ceiling: Enforce.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("v14, stored as Record mode")).toBeTruthy();
    expect(screen.getByText("Gateway traffic only")).toBeTruthy();
  });

  it("says a capped enforce is served as record", () => {
    show({
      mode: {
        ...summary().mode,
        ceiling: "record",
        storedMode: "enforce",
        cappedByCeiling: true,
      },
    });
    expect(
      screen.getByText(/stored as Enforce and served as Record/),
    ).toBeTruthy();
  });

  it("lists changes by when, to what, who and why, as the Guardrails page words who", () => {
    show();
    const list = screen.getByRole("list", {
      name: "Recorded changes of mode",
    });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Enforce to Record")).toBeTruthy();
    expect(within(items[0]!).getByText("Automatic switch-back")).toBeTruthy();
    // An automatic switch-back says so instead of a person.
    expect(
      within(items[0]!).getByText("Settings v14, by the automatic switch-back"),
    ).toBeTruthy();
    expect(
      within(items[0]!).getByText(
        "Reason: “Automatic switch-back to record: the trial ended.”",
      ),
    ).toBeTruthy();
    expect(within(items[1]!).getByText("Record to Enforce")).toBeTruthy();
    expect(within(items[1]!).getByText(/^Trial, switches back/)).toBeTruthy();
    // No email returned: the Guardrails page's words for the person.
    expect(
      within(items[1]!).getByText("Settings v13, by a guardrail administrator"),
    ).toBeTruthy();
    expect(
      within(items[1]!).getByText(
        "Reason: “Half-hour enforce trial for the claims bot”",
      ),
    ).toBeTruthy();
    expect(
      within(items[2]!).getByText("Enforce, the first version stored"),
    ).toBeTruthy();
    expect(within(items[2]!).getByText("Before this period")).toBeTruthy();
    // An email only where the server returned one (a guardrail administrator).
    expect(
      within(items[2]!).getByText("Settings v9, by EDITOR-EMAIL"),
    ).toBeTruthy();
    expect(
      screen.getByText(/a person's email shows only to the deployment's/),
    ).toBeTruthy();
    for (const link of screen.getAllByRole("link", {
      name: "Open the audit log",
    }))
      expect(link).toHaveAttribute(
        "href",
        "/project/p1/acme-enhancements/security-logs?tab=audit",
      );
  });

  it("shows the last change's person and reason beside the mode", () => {
    show({
      mode: {
        ...summary().mode,
        lastChange: {
          at: "2026-10-06T08:30:00.000Z",
          to: "enforce",
          automatic: false,
          createdByEmail: null,
          reason: "Half-hour enforce trial for the claims bot",
        },
      },
    });
    expect(
      screen.getByText(/^To Enforce, .*, by a guardrail administrator$/),
    ).toBeTruthy();
    expect(
      screen.getByText("“Half-hour enforce trial for the claims bot”"),
    ).toBeTruthy();
  });

  it("shows a reason as plain text, never as HTML", () => {
    const html =
      '<i data-reason-html="1">bold</i> <img src="x" data-reason-html="2"> & <script>window.x=1</script>';
    const base = summary();
    show({
      mode: {
        ...base.mode,
        lastChange: { ...base.mode.lastChange, reason: html },
      },
      history: {
        ...base.history,
        shown: base.history.shown.map((c) => ({ ...c, reason: html })),
      },
    });
    expect(document.querySelector("[data-reason-html]")).toBeNull();
    expect(document.querySelector("main script")).toBeNull();
    expect(screen.getByText(`“${html}”`)).toBeTruthy();
    expect(screen.getAllByText(`Reason: “${html}”`)).toHaveLength(3);
  });

  it("tells the last trial and how it ended", () => {
    show();
    expect(screen.getByText("No trial is running.")).toBeTruthy();
    expect(screen.getByText(/^Switched back automatically, /)).toBeTruthy();
    expect(screen.getByText(/Default switch-back: 30 minutes\./)).toBeTruthy();
  });

  it("tells pod agreement in versions and counts, stale pods apart, and gateway replicas by mode", () => {
    show();
    expect(
      screen.getByText(
        "1 of 2 reporting pods applied settings v14, the version in force.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Pods disagree").length).toBeGreaterThan(0);
    const counts = screen.getByRole("list", {
      name: "Guardrail pods by settings version",
    });
    expect(
      within(counts)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "On the version in force: 1",
      "Older version: 1",
      "Settings unknown: 0",
      "Stale, not counted: 1",
    ]);
    // Counted, never named: no pod table, no name column.
    expect(screen.queryByRole("table", { name: /Guardrail pods/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Pod" })).toBeNull();
    expect(
      screen.getByText(
        /2 gateway replicas reported with their latest decision: 2 Record mode/,
      ),
    ).toBeTruthy();
  });

  it("says when no pod reported, without naming any", () => {
    show({
      pods: {
        ...summary().pods,
        reporting: 0,
        onCurrent: 0,
        older: 0,
        unknown: 0,
        stale: 0,
        agree: null,
      },
    });
    expect(
      screen.getByText("No guardrail pod reported in the last 24 hours."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("list", {
        name: "Guardrail pods by settings version",
      }),
    ).toBeNull();
  });

  it("shows the policies in force with what each flagged, in Would block words", () => {
    show();
    expect(screen.getByText("Jailbreak Detection")).toBeTruthy();
    expect(screen.getByText("Topical Rail")).toBeTruthy();
    expect(screen.getByText("PII Redaction")).toBeTruthy();
    expect(
      screen.getByText("6 would block · 6 prompts, 0 answers"),
    ).toBeTruthy();
    expect(screen.getByText("1 redacted, 9 would redact")).toBeTruthy();
    expect(screen.getByText("EMAIL_ADDRESS")).toBeTruthy();
    expect(screen.getByText("BH_CPR")).toBeTruthy();
    expect(screen.getAllByText("Off").length).toBe(1);
    expect(screen.getAllByText("On").length).toBe(2);
  });

  it("says when no settings are stored", () => {
    show({
      mode: {
        ...summary().mode,
        mode: null,
        version: null,
        storedMode: null,
        lastChange: null,
      },
      policies: null,
    });
    expect(
      screen.getAllByText(/No guardrail settings are stored in EYEON yet/)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Not reported").length).toBeGreaterThan(0);
  });

  it("lists what is not recorded, never as a number, and the pods' names as not shown", () => {
    show();
    const list = screen
      .getByText("The mode each guardrail pod applies")
      .closest("ul")!;
    // Five not recorded here, plus the policy tile for the size limit.
    expect(within(list).getAllByText("Not recorded")).toHaveLength(5);
    expect(screen.getAllByText("Not recorded")).toHaveLength(6);
    expect(
      within(list).getByText(
        "The names of the guardrail pods and gateway replicas",
      ),
    ).toBeTruthy();
    expect(within(list).getByText("Not shown here")).toBeTruthy();
    // Who changed the mode and why are shown now, so not listed here.
    expect(list.textContent).not.toMatch(/Who changed the mode/);
    expect(list.textContent).not.toMatch(/\d/);
  });
});

describe("EyeonModeScale (CHG-2026-138)", () => {
  it("names the mode and the ceiling, and what is above it", () => {
    expect(modeScaleLabel("record", "record")).toBe(
      "Mode against ceiling. Mode: Record mode. Ceiling: Record. Enforce is above the ceiling, so it cannot be served.",
    );
    expect(modeScaleLabel(null, "enforce")).toBe(
      "Mode against ceiling. Mode: not reported. Ceiling: Enforce.",
    );
  });

  it("labels both modes in words, and marks the ceiling", () => {
    const { container } = render(
      <EyeonModeScale mode="record" ceiling="record" />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Record");
    expect(text).toContain("Enforce");
    expect(text).toContain("Ceiling");
    expect(text).toContain("Above the ceiling");
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("draws no marker when no mode is reported", () => {
    const { container } = render(
      <EyeonModeScale mode={null} ceiling="enforce" />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(0);
    expect(container.textContent).not.toContain("Above the ceiling");
  });
});
