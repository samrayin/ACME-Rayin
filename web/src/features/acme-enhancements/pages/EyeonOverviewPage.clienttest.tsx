import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonOverviewPage from "@/src/features/acme-enhancements/pages/EyeonOverviewPage";

// CHG-2026-136 (ADR-0028): arranging EYEON Home. "Arrange" opens arrange
// mode; each tile and card gets real buttons to move it earlier or later and
// to hide it; hidden ones are listed to show again; "Reset to default" and
// "Done" end it. Focus follows the widget moved. The arrangement is kept in
// this browser per person and per project, and only orders what the server
// sent: a role without spend never gets a spend card to show.
//
// CHG-2026-138 follow-up (owner decision, 2026-10-07): the enforcement card
// says who made the last change of mode and the reason given, in the
// Guardrails page's words: an automatic switch-back says so, a person is
// named by email only where the server returned one (to guardrail
// administrators), otherwise "a guardrail administrator". The reason is
// plain text, never HTML.

const h = vi.hoisted(() => ({
  result: {} as unknown,
  userId: "u1" as string | undefined,
}));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonOverview: {
      summary: { useQuery: () => h.result },
    },
  },
}));
vi.mock("@/src/hooks/useProjectIdFromURL", () => ({
  default: () => "p1",
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: h.userId ? { user: { id: h.userId } } : null,
  }),
}));
vi.mock("@/src/components/layouts/page", () => ({
  default: ({
    children,
    headerProps,
  }: {
    children: ReactNode;
    headerProps: { title: string };
  }) => (
    <main>
      <h1>{headerProps.title}</h1>
      {children}
    </main>
  ),
}));

const KEY = "cairo.eyeonHomeLayout.v1:u1:p1";

const split = (enforced: number, notEnforced: number) => ({
  enforced,
  notEnforced,
});

function summary(withSpend: boolean) {
  return {
    enabled: true as const,
    windowDays: 7,
    generatedAt: "2026-10-07T12:00:00.000Z",
    canSeeSpend: withSpend,
    mode: {
      mode: "record",
      ceiling: "enforce",
      trialEndsAt: null,
      lastChange: null,
    },
    decisions: {
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
    daily: [
      {
        day: "2026-10-06",
        checks: 120,
        promptsRefused: 4,
        answersWithheld: 1,
        redactions: 6,
        noVerdict: 1,
      },
      {
        day: "2026-10-07",
        checks: 80,
        promptsRefused: 2,
        answersWithheld: 1,
        redactions: 4,
        noVerdict: 1,
      },
    ],
    judge: {
      windowHours: 24,
      checks: 100,
      noVerdict: 0,
      rate: 0,
      alertRate: 0.01,
      alert: false,
    },
    applications: {
      total: 3,
      byOverall: { red: 1, amber: 1, green: 1, none: 0 },
      topRisks: { risks: [], total: 0 },
      missingBudget: 0,
    },
    ...(withSpend
      ? {
          spend: {
            totalUsd: 12.5,
            shown: [],
            withBudget: 0,
            withoutBudget: 3,
          },
        }
      : {}),
  };
}

function loaded(withSpend = true) {
  h.result = {
    isPending: false,
    isError: false,
    data: summary(withSpend),
  };
}

/**
 * The arrange groups on screen, in order: tiles first, then cards. (A chart's
 * "Show as table" is a details element, also a group, but without a name.)
 */
function arrangeGroups(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="group"][aria-label]'),
  );
}

function groupNames(): string[] {
  return arrangeGroups().map((g) => g.getAttribute("aria-label") ?? "");
}

const TILES = [
  "Guardrail checks",
  "Prompts refused",
  "Answers withheld",
  "Personal data redacted",
  "No verdict",
  "Applications needing action",
];
const CARDS = [
  "Guardrail decisions",
  "Enforcement",
  "Applications",
  "Spend against budget",
  "Not on this page",
];

function arrange() {
  fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
}

beforeEach(() => {
  window.localStorage.clear();
  h.userId = "u1";
  loaded();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EYEON Home: arrange mode (CHG-2026-136)", () => {
  it("is titled Home when shown as the project home, Overview otherwise", () => {
    const { unmount } = render(<EyeonOverviewPage asHome />);
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    unmount();
    render(<EyeonOverviewPage />);
    expect(
      screen.getByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
  });

  it("shows no arrange controls until Arrange is pressed, then real, named buttons for every widget", () => {
    render(<EyeonOverviewPage asHome />);
    expect(arrangeGroups()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();

    arrange();
    expect(groupNames()).toEqual([...TILES, ...CARDS]);
    for (const name of [...TILES, ...CARDS]) {
      const group = screen.getByRole("group", { name });
      for (const label of [
        `Move ${name} earlier`,
        `Move ${name} later`,
        `Hide ${name}`,
      ]) {
        const button = within(group).getByRole("button", { name: label });
        expect(button.tagName).toBe("BUTTON");
        expect(button).toHaveAttribute("type", "button");
        expect(button).not.toHaveAttribute("tabindex", "-1");
      }
    }
    // Nothing to move past either end.
    expect(
      screen.getByRole("button", { name: "Move Guardrail checks earlier" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Move Applications needing action later",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Not on this page later" }),
    ).toBeDisabled();
    // The drag grip is for a mouse or a finger only.
    for (const grip of screen.getAllByTitle("Drag to move")) {
      expect(grip).toHaveAttribute("aria-hidden", "true");
      expect(grip).not.toHaveAttribute("tabindex");
    }
    // Focus goes to the arrange bar, and the default needs no reset.
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Reset to default" }),
    ).toBeDisabled();
  });

  it("makes widget content inert while arranging, so a tile cannot open its page by mistake", () => {
    const { container } = render(<EyeonOverviewPage asHome />);
    expect(container.querySelectorAll("[inert]")).toHaveLength(0);
    arrange();
    const group = screen.getByRole("group", { name: "Guardrail checks" });
    const link = within(group).getByRole("link", { hidden: true });
    expect(link.closest("[inert]")).not.toBeNull();
  });

  it("moves tiles among tiles and cards among cards, keeping focus on the moved widget", () => {
    render(<EyeonOverviewPage asHome />);
    arrange();

    const later = screen.getByRole("button", {
      name: "Move Guardrail checks later",
    });
    later.focus();
    fireEvent.click(later);
    expect(groupNames().slice(0, 3)).toEqual([
      "Prompts refused",
      "Guardrail checks",
      "Answers withheld",
    ]);
    expect(
      screen.getByRole("button", { name: "Move Guardrail checks later" }),
    ).toHaveFocus();
    expect(
      screen.getByText("Guardrail checks moved to place 2 of 6."),
    ).toBeInTheDocument();

    // A card moves among the cards only: the tiles keep their places.
    fireEvent.click(
      screen.getByRole("button", { name: "Move Enforcement earlier" }),
    );
    expect(groupNames().slice(6)).toEqual([
      "Enforcement",
      "Guardrail decisions",
      "Applications",
      "Spend against budget",
      "Not on this page",
    ]);
    expect(groupNames().slice(0, 6)).toEqual([
      "Prompts refused",
      "Guardrail checks",
      "Answers withheld",
      "Personal data redacted",
      "No verdict",
      "Applications needing action",
    ]);
    // At the start, "earlier" is disabled and focus moves to "later".
    expect(
      screen.getByRole("button", { name: "Move Enforcement earlier" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Enforcement later" }),
    ).toHaveFocus();
  });

  it("hides a widget, lists it, and shows it again in its place", () => {
    render(<EyeonOverviewPage asHome />);
    arrange();
    expect(screen.getByText("Nothing is hidden.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide No verdict" }));
    expect(groupNames()).not.toContain("No verdict");
    const show = screen.getByRole("button", { name: "Show No verdict" });
    expect(show).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Reset to default" }),
    ).toBeEnabled();

    fireEvent.click(show);
    expect(groupNames().slice(0, 6)).toEqual(TILES);
    expect(
      screen.getByRole("button", { name: "Hide No verdict" }),
    ).toHaveFocus();
  });

  it("Done ends arrange mode; hidden widgets stay hidden and are counted", () => {
    render(<EyeonOverviewPage asHome />);
    arrange();
    fireEvent.click(screen.getByRole("button", { name: "Hide Enforcement" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(arrangeGroups()).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Open Guardrails" })).toBeNull();
    expect(screen.getByText("1 hidden by you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrange" })).toHaveFocus();
  });

  it("Reset to default restores the default arrangement and clears what was stored", () => {
    render(<EyeonOverviewPage asHome />);
    arrange();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide Guardrail decisions" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move Spend against budget earlier" }),
    );
    expect(window.localStorage.getItem(KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(groupNames()).toEqual([...TILES, ...CARDS]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(
      screen.getByText("Default arrangement restored."),
    ).toBeInTheDocument();
    // Reset is now disabled, so focus moves on to Done.
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("keeps the arrangement per person and per project, in this browser", () => {
    const { unmount } = render(<EyeonOverviewPage asHome />);
    arrange();
    fireEvent.click(
      screen.getByRole("button", { name: "Move No verdict earlier" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hide Not on this page" }),
    );
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as {
      tiles: { order: string[] };
      cards: { hidden: string[] };
    };
    expect(stored.tiles.order.slice(3, 5)).toEqual(["noVerdict", "redactions"]);
    expect(stored.cards.hidden).toEqual(["notRecorded"]);
    unmount();

    // The same person comes back: the arrangement is there.
    const again = render(<EyeonOverviewPage asHome />);
    expect(screen.getByText("1 hidden by you")).toBeInTheDocument();
    arrange();
    expect(groupNames().slice(3, 5)).toEqual([
      "No verdict",
      "Personal data redacted",
    ]);
    again.unmount();

    // Someone else in the same browser gets the default.
    h.userId = "u2";
    render(<EyeonOverviewPage asHome />);
    expect(screen.queryByText(/hidden by you/)).toBeNull();
    arrange();
    expect(groupNames()).toEqual([...TILES, ...CARDS]);
  });

  it("ignores a corrupt stored arrangement and still works when the browser refuses to store", () => {
    window.localStorage.setItem(KEY, "{not json");
    render(<EyeonOverviewPage asHome />);
    arrange();
    expect(groupNames()).toEqual([...TILES, ...CARDS]);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide Enforcement" }));
    expect(groupNames()).not.toContain("Enforcement");
    expect(
      screen.getByText(/This browser did not keep the arrangement/),
    ).toBeInTheDocument();
  });

  it("never offers a spend card to a role the server sent no spend", () => {
    // A stored arrangement that lists spend as hidden, from another role.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        tiles: { order: [], hidden: [] },
        cards: { order: ["spend"], hidden: ["spend"] },
      }),
    );
    loaded(false);
    render(<EyeonOverviewPage asHome />);
    expect(screen.queryByText(/hidden by you/)).toBeNull();
    arrange();
    expect(screen.queryByRole("button", { name: /Spend/ })).toBeNull();
    expect(groupNames()).not.toContain("Spend against budget");
    expect(screen.getByText("Nothing is hidden.")).toBeInTheDocument();
    // Without spend, Applications is the last of its row and fills it.
    expect(
      screen.getByRole("group", { name: "Applications" }).className,
    ).toContain("lg:col-span-3");
  });
});

type LastChange = {
  at: string;
  to: "record" | "enforce";
  automatic: boolean;
  createdByEmail: string | null;
  reason: string;
};

const PERSON: LastChange = {
  at: "2026-10-06T08:30:00.000Z",
  to: "enforce",
  automatic: false,
  createdByEmail: null,
  reason: "Half-hour enforce trial for the claims bot",
};

/** The overview with this last change of mode on its enforcement card. */
function showLastChange(lastChange: LastChange | null) {
  const base = summary(false);
  h.result = {
    isPending: false,
    isError: false,
    data: { ...base, mode: { ...base.mode, lastChange } },
  };
  render(<EyeonOverviewPage />);
}

describe("EYEON overview: the last change of mode, who and why (CHG-2026-138 follow-up)", () => {
  it("names a person as the Guardrails page does, with the reason given", () => {
    showLastChange(PERSON);
    expect(
      screen.getByText(/^To Enforce, .*, by a guardrail administrator$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(
      screen.getByText("“Half-hour enforce trial for the claims bot”"),
    ).toBeInTheDocument();
  });

  it("shows the email only where the server returned it", () => {
    showLastChange({ ...PERSON, createdByEmail: "EDITOR-EMAIL" });
    expect(
      screen.getByText(/^To Enforce, .*, by EDITOR-EMAIL$/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/a guardrail administrator/)).toBeNull();
  });

  it("says an automatic switch-back made the change, instead of a person", () => {
    showLastChange({
      at: "2026-10-06T09:00:00.000Z",
      to: "record",
      automatic: true,
      createdByEmail: null,
      reason: "Automatic switch-back to record: the trial ended.",
    });
    expect(
      screen.getByText(/^To Record, .*, by the automatic switch-back$/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("“Automatic switch-back to record: the trial ended.”"),
    ).toBeInTheDocument();
  });

  it("shows the reason as plain text, never as HTML", () => {
    const html =
      '<i data-reason-html="1">bold</i> <img src="x" data-reason-html="2"> & <script>window.x=1</script>';
    showLastChange({ ...PERSON, reason: html });
    expect(document.querySelector("[data-reason-html]")).toBeNull();
    expect(document.querySelector("main script")).toBeNull();
    expect(screen.getByText(`“${html}”`)).toBeInTheDocument();
  });

  it("says no change is recorded, with no person or reason", () => {
    showLastChange(null);
    expect(screen.getByText("No change of mode recorded")).toBeInTheDocument();
    expect(screen.queryByText("Reason")).toBeNull();
  });
});
