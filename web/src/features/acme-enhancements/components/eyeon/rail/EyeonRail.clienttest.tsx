import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Database, Home, ListTree, ScrollText, Settings } from "lucide-react";
import { RouteGroup, RouteSection } from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { NavMain } from "@/src/components/nav/nav-main";
import { Sidebar, SidebarProvider } from "@/src/components/ui/sidebar";
import { EyeonRail } from "@/src/features/acme-enhancements/components/eyeon/rail/EyeonRail";
import { useEyeonRail } from "@/src/features/acme-enhancements/components/eyeon/rail/useEyeonRail";
import { useEyeonRailStore } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailStore";
import type { EyeonRailNavigation } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";

// CHG-2026-135 (ADR-0026 §12.2): the rail on screen. A nav landmark; the
// active category marked with aria-current; choosing a category lists its
// items in the sidebar beside it; Home goes to the project home; an entry
// that renders nothing never shows, nor does a category holding only such
// entries; with CAIRO_EYEON_RAIL_ENABLED off the sidebar is the old one.

const h = vi.hoisted(() => ({
  flag: true,
  query: { projectId: "p1" } as Record<string, string>,
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/project/p1/traces",
    pathname: "/project/[projectId]/traces",
    push: vi.fn(),
    query: h.query,
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock("@/src/utils/api", () => ({
  api: {
    eyeonShell: {
      railStatus: { useQuery: () => ({ data: { enabled: h.flag } }) },
    },
  },
}));

/** An entry behind its own gate, switched off: it renders nothing. */
function SwitchedOffEntry() {
  return h.flag ? null : <span>never</span>;
}

/** An entry that decides for itself and shows. */
function SupportEntry() {
  return <button type="button">Support desk</button>;
}

function item(
  title: string,
  pathname: string,
  extra: Partial<NavigationItem> = {},
): NavigationItem {
  return {
    title,
    pathname,
    url: pathname.replace("[projectId]", "p1"),
    isActive: false,
    section: RouteSection.Main,
    ...extra,
  };
}

const ITEMS: NavigationItem[] = [
  item("Home", "/project/[projectId]", { icon: Home }),
  item("Guardrails", "/project/[projectId]/acme-enhancements/guardrails", {
    group: RouteGroup.GovernanceControls,
  }),
  item("Tracing", "/project/[projectId]/traces", {
    group: RouteGroup.Observability,
    icon: ListTree,
    isActive: true,
  }),
  item("Datasets", "/project/[projectId]/datasets", {
    group: RouteGroup.Evaluation,
    icon: Database,
  }),
  item("Hidden prompts", "/project/[projectId]/hidden", {
    group: RouteGroup.PromptManagement,
    menuNode: <SwitchedOffEntry />,
  }),
  item("Logs", "/project/[projectId]/acme-enhancements/security-logs", {
    group: RouteGroup.ReportsLogs,
    icon: ScrollText,
  }),
  item("Settings", "/project/[projectId]/settings", {
    group: RouteGroup.Settings,
    icon: Settings,
  }),
  item("Support", "", {
    group: RouteGroup.Support,
    menuNode: <SupportEntry />,
  }),
];

const NAVIGATION: EyeonRailNavigation = {
  ungrouped: ITEMS.filter((i) => !i.group),
  grouped: {
    [RouteGroup.GovernanceControls]: [ITEMS[1]],
    [RouteGroup.Observability]: [ITEMS[2]],
    [RouteGroup.Evaluation]: [ITEMS[3]],
    [RouteGroup.PromptManagement]: [ITEMS[4]],
    [RouteGroup.ReportsLogs]: [ITEMS[5]],
    [RouteGroup.Settings]: [ITEMS[6]],
    [RouteGroup.Support]: [ITEMS[7]],
  },
  flattened: ITEMS,
};

/** The layout's wiring: the rail, then the sidebar's list. */
function Shell() {
  const rail = useEyeonRail(NAVIGATION);
  return (
    <SidebarProvider>
      {rail.model && <EyeonRail model={rail.model} />}
      <aside aria-label="Sidebar">
        <NavMain items={rail.sidebarNavigation} />
      </aside>
    </SidebarProvider>
  );
}

const rail = () => screen.getByRole("navigation", { name: "Categories" });
const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
const category = (name: string) =>
  within(rail()).getByRole(name === "Home" ? "link" : "button", { name });

describe("EyeonRail (CHG-2026-135)", () => {
  beforeEach(() => {
    h.flag = true;
    h.query = { projectId: "p1" };
    useEyeonRailStore.setState({ selection: null, presence: {} });
    window.localStorage.clear();
  });

  it("shows the categories this person can see, in the prototype's order", async () => {
    render(<Shell />);

    // Support's entry decides for itself; the rail counts it once it shows.
    await within(rail()).findByRole("button", { name: "Support" });
    expect(
      within(rail())
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Home",
      "Governance Controls",
      "Observability",
      "Evaluation",
      "Logs",
      "Settings",
      "Support",
    ]);
  });

  it("marks the current page's category and lists only its items", () => {
    render(<Shell />);

    expect(category("Observability")).toHaveAttribute("aria-current", "page");
    expect(category("Evaluation")).not.toHaveAttribute("aria-current");
    expect(
      within(sidebar()).getByRole("link", { name: "Tracing" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar()).queryByRole("link", { name: "Datasets" }),
    ).toBeNull();
  });

  it("choosing a category shows its own list beside the rail", () => {
    render(<Shell />);

    fireEvent.click(category("Evaluation"));

    expect(category("Evaluation")).toHaveAttribute("aria-current", "true");
    expect(category("Observability")).not.toHaveAttribute("aria-current");
    expect(
      within(sidebar()).getByRole("link", { name: "Datasets" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar()).queryByRole("link", { name: "Tracing" }),
    ).toBeNull();
  });

  it("Home goes to the project home", () => {
    render(<Shell />);
    expect(category("Home")).toHaveAttribute("href", "/project/p1");
  });

  it("never shows an entry that renders nothing, nor a category of only such entries", async () => {
    render(<Shell />);
    await within(rail()).findByRole("button", { name: "Support" });

    expect(
      within(rail()).queryByRole("button", { name: "Prompt Management" }),
    ).toBeNull();
    expect(
      within(rail()).queryByRole("button", { name: "Reports" }),
    ).toBeNull();
    expect(screen.queryByText("never")).toBeNull();
  });

  it("is keyboard-operable, with a visible focus ring", () => {
    render(<Shell />);

    for (const name of ["Governance Controls", "Evaluation", "Settings"]) {
      const button = category(name);
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveClass("focus-visible:ring-2");
      act(() => button.focus());
      expect(button).toHaveFocus();
    }
  });
});

describe("the rail beside the docked sidebar (CHG-2026-135)", () => {
  // The docked sidebar is fixed to the window's left edge; the rail moves it
  // right with a sibling selector on sidebar.tsx's structure. If an upstream
  // sync changes that structure, this fails before the two overlap.
  it("shifts the sidebar's fixed panel, which sidebar.tsx still renders", () => {
    h.flag = true;
    h.query = { projectId: "p1" };
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <span>panel</span>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      container.querySelector('[data-side="left"] > .fixed'),
    ).not.toBeNull();

    render(<Shell />);
    expect(rail().className).toContain("[&~[data-side=left]>.fixed]:left-22");
  });
});

describe("with the rail off (CHG-2026-135)", () => {
  beforeEach(() => {
    useEyeonRailStore.setState({ selection: null, presence: {} });
    window.localStorage.clear();
  });

  it("the flag off gives the old sidebar: no rail, every group listed", () => {
    h.flag = false;
    h.query = { projectId: "p1" };
    render(<Shell />);

    expect(screen.queryByRole("navigation", { name: "Categories" })).toBeNull();
    for (const name of ["Home", "Tracing", "Datasets", "Logs", "Settings"]) {
      expect(within(sidebar()).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(
      within(sidebar()).getByRole("button", { name: /Reports \/ Logs/ }),
    ).toBeInTheDocument();
  });

  it("hands the sidebar the layout's navigation unchanged", () => {
    h.flag = false;
    h.query = { projectId: "p1" };
    let seen: EyeonRailNavigation | undefined;
    function Probe() {
      seen = useEyeonRail(NAVIGATION).sidebarNavigation;
      return <span />;
    }
    render(<Probe />);
    expect(seen).toBe(NAVIGATION);
  });

  it("outside a project there is no rail", () => {
    h.flag = true;
    h.query = {};
    render(<Shell />);
    expect(screen.queryByRole("navigation", { name: "Categories" })).toBeNull();
  });
});
