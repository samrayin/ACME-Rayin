import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonGuardrailDecisionsPage from "@/src/features/acme-enhancements/pages/EyeonGuardrailDecisionsPage";

// CHG-2026-133 (ADR-0027): the EYEON Guardrail decisions page on fixed
// figures. "Would block" stays apart from "Blocked"; what is not recorded
// says so; an agent links to its application only where the server resolved
// one; the switched-off page points to the decision log.

const h = vi.hoisted(() => ({ result: {} as unknown }));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonGuardrailDecisions: {
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

function summary(linksApplications: boolean) {
  return {
    enabled: true as const,
    windowDays: 7,
    generatedAt: "2026-10-07T12:00:00.000Z",
    mode: { mode: "record", ceiling: "enforce" },
    totals: {
      checks: 200,
      promptChecks: 150,
      answerChecks: 50,
      allowed: 180,
      promptsRefused: split(0, 6),
      answersWithheld: split(0, 2),
      redactions: split(0, 10),
      noVerdict: 2,
      enforcedChecks: 0,
      enforcedPct: 0,
    },
    byDirection: {
      prompts: {
        checks: 150,
        allowed: 134,
        blocked: split(0, 6),
        redacted: split(0, 8),
        noVerdict: 2,
      },
      answers: {
        checks: 50,
        allowed: 46,
        blocked: split(0, 2),
        redacted: split(0, 2),
        noVerdict: 0,
      },
    },
    daily: [
      {
        day: "2026-10-06",
        checks: 120,
        allowed: 108,
        blocked: 0,
        wouldBlock: 5,
        redacted: 0,
        wouldRedact: 6,
        noVerdict: 1,
      },
      {
        day: "2026-10-07",
        checks: 80,
        allowed: 72,
        blocked: 0,
        wouldBlock: 3,
        redacted: 0,
        wouldRedact: 4,
        noVerdict: 1,
      },
    ],
    refusalsByType: [
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 6,
        split: split(0, 6),
        prompts: 6,
        answers: 0,
      },
    ],
    busiest: {
      shown: [
        {
          alias: "cairo-claims-bot-1a2b",
          application: linksApplications
            ? { lineageId: "lineage-1", name: "Claims bot" }
            : null,
          refusals: split(0, 5),
          checks: 100,
          per100: 5,
        },
        {
          alias: "promptfoo-suite",
          application: null,
          refusals: split(0, 3),
          checks: 4,
          per100: null,
        },
      ],
      total: 3,
      limit: 5,
      linksApplications,
    },
    judge: {
      windowHours: 24,
      checks: 100,
      noVerdict: 2,
      rate: 0.02,
      alertRate: 0.01,
      alert: true,
    },
  };
}

function enabled(linksApplications: boolean) {
  h.result = {
    isPending: false,
    isError: false,
    data: summary(linksApplications),
  };
}

describe("EYEON Guardrail decisions page (CHG-2026-133)", () => {
  beforeEach(() => enabled(true));

  it("says it is switched off and links to the decision log", () => {
    h.result = { isPending: false, isError: false, data: { enabled: false } };
    render(<EyeonGuardrailDecisionsPage />);
    expect(screen.getByText(/is switched off on this deployment/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the guardrail decision log" }),
    ).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/security-logs?tab=guardrails",
    );
  });

  it("says Would block in record mode, never Blocked, with the mode and its ceiling", () => {
    render(<EyeonGuardrailDecisionsPage />);
    expect(
      screen.getByText(
        "9% of 200 guardrail checks would have been refused or redacted.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Record mode").length).toBeGreaterThan(0);
    expect(screen.getByText("Prompts that would be refused")).toBeTruthy();
    expect(screen.getAllByText("Would block").length).toBeGreaterThan(0);
    expect(screen.getByText("6 · 6 would block")).toBeInTheDocument();
    expect(screen.getByText("At or above the 1.00% alert")).toBeTruthy();
    expect(screen.getByText("Gateway traffic only")).toBeTruthy();
  });

  it("lists what is not recorded, never as a number", () => {
    render(<EyeonGuardrailDecisionsPage />);
    const list = screen
      .getByText("Added latency of the guardrail")
      .closest("ul")!;
    expect(within(list).getAllByText("Not recorded")).toHaveLength(4);
    expect(screen.getAllByText("Not recorded")).toHaveLength(4);
    expect(
      within(list).getByText("Personal-data types behind redactions"),
    ).toBeTruthy();
    expect(list.textContent).not.toMatch(/\d/);
  });

  it("links a busy key to its application where known, and every agent to its decisions", () => {
    render(<EyeonGuardrailDecisionsPage />);
    expect(screen.getByRole("link", { name: "Claims bot" })).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/applications/lineage-1",
    );
    const decisionLinks = screen
      .getAllByRole("link", { name: "Decisions" })
      .map((a) => a.getAttribute("href"));
    expect(decisionLinks).toEqual([
      "/project/p1/acme-enhancements/security-logs?tab=guardrails&agents=cairo-claims-bot-1a2b",
      "/project/p1/acme-enhancements/security-logs?tab=guardrails&agents=promptfoo-suite",
    ]);
    expect(screen.getByText("4 checks, too few to rate")).toBeTruthy();
    expect(screen.getByText("1 more caller had a refusal.")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Open the decision log" })[0],
    ).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/security-logs?tab=guardrails",
    );
  });

  it("shows key aliases without application links for a role that cannot open Applications", () => {
    enabled(false);
    render(<EyeonGuardrailDecisionsPage />);
    expect(screen.queryByRole("link", { name: "Claims bot" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open Applications" }),
    ).toBeNull();
    expect(screen.getByText("cairo-claims-bot-1a2b")).toBeTruthy();
    expect(
      screen.getByText(
        /Application screens are linked for roles that can open Applications/,
      ),
    ).toBeTruthy();
  });
});
