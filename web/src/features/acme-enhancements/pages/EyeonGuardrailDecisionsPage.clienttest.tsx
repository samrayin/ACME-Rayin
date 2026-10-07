import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonGuardrailDecisionsPage from "@/src/features/acme-enhancements/pages/EyeonGuardrailDecisionsPage";

// CHG-2026-133 (ADR-0027): the EYEON Guardrail decisions page on fixed
// figures. "Would block" stays apart from "Blocked"; what is not recorded
// says so; an agent links to its application only where the server resolved
// one; the switched-off page points to the decision log.
// CHG-2026-137: the period and filters come from the URL and go back to it;
// the decision flow filters the page; decisions over time switch measure;
// policy type by direction gives rates per 100 checks; the personal-data
// types show names and counts only, tagged Preview.

const h = vi.hoisted(() => ({
  result: {} as unknown,
  input: undefined as unknown,
  query: {} as Record<string, string>,
  replace: (() => Promise.resolve(true)) as (...args: unknown[]) => unknown,
}));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonGuardrailDecisions: {
      summary: {
        useQuery: (input: unknown) => {
          h.input = input;
          return h.result;
        },
      },
    },
  },
}));
vi.mock("next/router", () => ({
  useRouter: () => ({ query: h.query, replace: h.replace }),
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
const none = split(0, 0);

function summary(linksApplications: boolean) {
  return {
    enabled: true as const,
    windowDays: 7,
    generatedAt: "2026-10-07T12:00:00.000Z",
    mode: { mode: "record", ceiling: "enforce" },
    scope: { checks: 200, promptChecks: 150, answerChecks: 50 },
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
        enforcedChecks: 0,
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
        enforcedChecks: 0,
        allowed: 72,
        blocked: 0,
        wouldBlock: 3,
        redacted: 0,
        wouldRedact: 4,
        noVerdict: 1,
      },
    ],
    policyByDirection: [
      {
        type: "personalData",
        label: "Personal data",
        count: 10,
        prompts: { blocked: none, redacted: split(0, 8) },
        answers: { blocked: none, redacted: split(0, 2) },
      },
      {
        type: "jailbreak",
        label: "Jailbreak or misuse",
        count: 6,
        prompts: { blocked: split(0, 6), redacted: none },
        answers: { blocked: none, redacted: none },
      },
    ],
    busiest: {
      shown: [
        {
          alias: "cairo-claims-bot-1a2b",
          application: linksApplications
            ? { lineageId: "lineage-1", name: "Claims bot" }
            : null,
          matched: split(0, 5),
          checks: 100,
          per100: 5,
        },
        {
          alias: "promptfoo-suite",
          application: null,
          matched: split(0, 3),
          checks: 4,
          per100: null,
        },
      ],
      total: 3,
      verdict: "block",
      limit: 5,
      linksApplications,
    },
    entityTypes: [
      { type: "EMAIL_ADDRESS", count: 7 },
      { type: "BH_CPR", count: 2 },
      { type: "OTHER", count: 1 },
    ],
    callers: {
      listed: [
        {
          alias: "cairo-claims-bot-1a2b",
          checks: 100,
          application: linksApplications
            ? { lineageId: "lineage-1", name: "Claims bot" }
            : null,
        },
        { alias: "promptfoo-suite", checks: 4, application: null },
      ],
      limit: 50,
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

describe("EYEON Guardrail decisions page (CHG-2026-133, CHG-2026-137)", () => {
  beforeEach(() => {
    enabled(true);
    h.query = { projectId: "p1" };
    h.replace = vi.fn(() => Promise.resolve(true));
  });

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
    expect(screen.getByText("5 · 5 would block")).toBeInTheDocument();
    expect(screen.getByText("At or above the 1.00% alert")).toBeTruthy();
    expect(screen.getByText("Gateway traffic only")).toBeTruthy();
  });

  it("lists what is not recorded, never as a number", () => {
    render(<EyeonGuardrailDecisionsPage />);
    const list = screen
      .getByText("Added latency of the guardrail")
      .closest("ul")!;
    expect(within(list).getAllByText("Not recorded")).toHaveLength(3);
    expect(screen.getAllByText("Not recorded")).toHaveLength(3);
    expect(list.textContent).not.toMatch(/\d/);
    // The personal-data types are now counted, so they left this list.
    expect(list.textContent).not.toMatch(/Personal-data/);
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

  it("reads the period and the filters from the URL, and asks the server for that view", () => {
    h.query = {
      projectId: "p1",
      days: "30",
      verdict: "block",
      applied: "recorded",
      caller: "promptfoo-suite",
      policy: "not-a-type",
    };
    render(<EyeonGuardrailDecisionsPage />);
    expect(h.input).toEqual({
      projectId: "p1",
      windowDays: 30,
      // An unknown value in a link is ignored, not sent.
      filters: {
        verdict: "block",
        applied: "recorded",
        caller: "promptfoo-suite",
      },
    });
    expect(screen.getByRole("region", { name: "Filters" }).textContent).toMatch(
      /Filtered: Would block · Caller promptfoo-suite · Recorded only\./,
    );
    // With a caller chosen, the log opens on that caller's decisions.
    expect(
      screen.getAllByRole("link", { name: "Open the decision log" })[0],
    ).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/security-logs?tab=guardrails&agents=promptfoo-suite",
    );
  });

  it("writes the view back to the URL: from the decision flow, and when clearing the filters", () => {
    h.query = { projectId: "p1", days: "30", caller: "promptfoo-suite" };
    render(<EyeonGuardrailDecisionsPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Prompts: 150, 75% of checks. Press to filter the page.",
      }),
    );
    expect(h.replace).toHaveBeenLastCalledWith(
      {
        query: {
          projectId: "p1",
          days: "30",
          direction: "prompts",
          caller: "promptfoo-suite",
        },
      },
      undefined,
      { shallow: true },
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(h.replace).toHaveBeenLastCalledWith(
      { query: { projectId: "p1", days: "30" } },
      undefined,
      { shallow: true },
    );
  });

  it("filters the page to one caller from the busiest list", () => {
    render(<EyeonGuardrailDecisionsPage />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Filter the page" })[1]!,
    );
    expect(h.replace).toHaveBeenLastCalledWith(
      { query: { projectId: "p1", caller: "promptfoo-suite" } },
      undefined,
      { shallow: true },
    );
  });

  it("draws the decision flow with its figures, in the log's words, and a table view", () => {
    render(<EyeonGuardrailDecisionsPage />);
    expect(
      screen.getByRole("group", {
        name:
          "Decision flow, last 7 days: 200 checks; 150 prompts and 50 answers; 180 allowed; " +
          "8 block verdicts (0 blocked, 8 would block); 10 redact verdicts (0 redacted, 10 would redact); 2 without a verdict.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Decision flow, last 7 days" }),
    ).toBeInTheDocument();
    // Nothing was applied: no "Blocked" step is drawn.
    expect(screen.queryByRole("button", { name: /^Blocked:/ })).toBeNull();
  });

  it("switches decisions over time to rates per 100 checks of the day", () => {
    render(<EyeonGuardrailDecisionsPage />);
    const legend = () => screen.getByRole("list", { name: "Legend" });
    expect(legend().textContent).toContain("Would block8");
    fireEvent.click(screen.getByRole("button", { name: "Per 100 checks" }));
    expect(
      screen.getByRole("button", { name: "Per 100 checks" }),
    ).toHaveAttribute("aria-pressed", "true");
    // 8 would block in 200 checks: 4.0 per 100 over the period.
    expect(legend().textContent).toContain(
      "Would block4.0 per 100 over the period",
    );
    fireEvent.click(screen.getByRole("button", { name: "All decisions" }));
    expect(legend().textContent).toMatch(/^Allowed180/);
    expect(
      screen.getByText(
        "Gateway mode per UTC day: Record mode or not reported on 2 days.",
      ),
    ).toBeInTheDocument();
  });

  it("gives each policy type per direction with its rate per 100 checks, never the label text", () => {
    render(<EyeonGuardrailDecisionsPage />);
    const table = screen.getByRole("table", {
      name: /Refusals and redactions by policy type and direction/,
    });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]?.textContent).toBe(
      "Personal data85.3 per 1008 would redact24.0 per 1002 would redact",
    );
    expect(rows[2]?.textContent).toBe(
      "Jailbreak or misuse64.0 per 1006 would block00.0 per 100",
    );
    expect(document.body.textContent).not.toMatch(/Detection|Topical Rail/);
  });

  it("shows the personal-data types by name and count only, tagged Preview", () => {
    render(<EyeonGuardrailDecisionsPage />);
    const list = screen.getByRole("list", {
      name: "Redactions per personal-data type, last 7 days",
    });
    expect(list.textContent).toBe(
      "Email7 redactionsBahrain CPR number2 redactionsOther or unknown type1 redaction",
    );
    expect(screen.getAllByText("Preview").length).toBeGreaterThan(0);
  });

  it("says the types come from redactions only while another verdict is chosen", () => {
    h.query = { projectId: "p1", verdict: "allow" };
    render(<EyeonGuardrailDecisionsPage />);
    expect(
      screen.getByText(/Entity types come from redactions only/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", {
        name: "Redactions per personal-data type, last 7 days",
      }),
    ).toBeNull();
  });
});
