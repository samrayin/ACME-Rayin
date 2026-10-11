import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
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
import {
  EYEON_RAIL_HEADER_ROW_CLASS,
  EYEON_RAIL_TRANSITION_CLASS,
  EYEON_RAIL_WIDTH_CLASS,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailLayout";

// CHG-2026-135 (ADR-0026 §12.2): the rail on screen. A nav landmark; the
// active category marked with aria-current; choosing a category goes to its
// first page and lists its items in the sidebar beside it, while the page's
// own category only shows its list (owner, 2026-10-07); an entry
// that renders nothing never shows, nor does a category holding only such
// entries; with CAIRO_EYEON_RAIL_ENABLED off the sidebar is the old one.
// CHG-2026-150 (ADR-0026 §12.5): the rail expands and collapses with its
// button or Ctrl+\, kept per person; its top row has no divider, so the
// sidebar's header row spans it.

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

const USER = "u1";

/** The layout's wiring: the rail, then the sidebar's list. */
function Shell({
  userId = USER,
  children,
}: {
  userId?: string;
  children?: ReactNode;
}) {
  const rail = useEyeonRail(NAVIGATION);
  return (
    <SidebarProvider>
      {rail.model && <EyeonRail model={rail.model} userId={userId} />}
      <aside aria-label="Sidebar">
        <NavMain items={rail.sidebarNavigation} />
      </aside>
      {children}
    </SidebarProvider>
  );
}

const rail = () => screen.getByRole("navigation", { name: "Categories" });
const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
/** A category: a link to its first page, or a button for the page's own. */
const category = (name: string) => {
  const found = within(rail()).queryByRole("link", { name });
  return found ?? within(rail()).getByRole("button", { name });
};

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

  it("each other category goes to its first page; the page's own category only shows its list", () => {
    render(<Shell />);
    expect(category("Evaluation")).toHaveAttribute(
      "href",
      "/project/p1/datasets",
    );
    expect(category("Governance Controls")).toHaveAttribute(
      "href",
      "/project/p1/acme-enhancements/guardrails",
    );
    // Tracing is on screen: Observability stays a button and keeps the page.
    expect(category("Observability").tagName).toBe("BUTTON");
  });

  it("never shows an entry that renders nothing, nor a category of only such entries", async () => {
    render(<Shell />);
    await within(rail()).findByRole("button", { name: "Support" });

    expect(within(rail()).queryByText("Prompt Management")).toBeNull();
    expect(within(rail()).queryByText("Reports")).toBeNull();
    expect(screen.queryByText("never")).toBeNull();
  });

  it("is keyboard-operable, with a visible focus ring", () => {
    render(<Shell />);

    for (const name of ["Governance Controls", "Observability", "Settings"]) {
      const control = category(name);
      expect(["A", "BUTTON"]).toContain(control.tagName);
      expect(control).toHaveClass("focus-visible:ring-2");
      act(() => control.focus());
      expect(control).toHaveFocus();
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
    // CHG-2026-150: by the width the rail hands the sidebar, whichever
    // width the rail has.
    expect(rail().className).toContain(
      "[&~[data-side=left]>.fixed]:left-(--eyeon-rail-width)",
    );
    expect(rail().className).toContain(
      "[&~[data-side=left]]:[--eyeon-rail-width:5.5rem]",
    );
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

const STORED_KEY = "cairo.railExpanded.v1:u1";
const toggle = () =>
  within(rail()).getByRole("button", {
    name: /^(Expand|Collapse) navigation$/,
  });
const backslash = { key: "\\", code: "Backslash" };
/** The rail's own keys in this browser (the sidebar keeps its own state too). */
const railKeys = () =>
  Object.keys(window.localStorage).filter((key) =>
    key.startsWith("cairo.railExpanded"),
  );

describe("expanding and collapsing the rail (CHG-2026-150)", () => {
  beforeEach(() => {
    h.flag = true;
    h.query = { projectId: "p1" };
    useEyeonRailStore.setState({ selection: null, presence: {} });
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is compact by default, as today's rail, and nothing is stored", () => {
    render(<Shell />);

    expect(toggle()).toHaveAccessibleName("Expand navigation");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveAttribute("aria-controls", rail().id);
    expect(rail()).toHaveAttribute("data-expanded", "false");
    expect(rail().className).toContain("w-22");
    expect(category("Evaluation")).toHaveClass("flex-col");
    expect(railKeys()).toEqual([]);
  });

  it("its button expands it, each name on one line beside its icon, and collapses it again", () => {
    render(<Shell />);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName("Collapse navigation");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(rail().className).toContain("w-52");
    expect(rail().className).toContain(
      "[&~[data-side=left]]:[--eyeon-rail-width:13rem]",
    );
    expect(rail().className).not.toContain("w-22");
    expect(category("Evaluation")).toHaveClass("flex-row");
    expect(within(category("Evaluation")).getByText("Evaluation")).toHaveClass(
      "truncate",
    );
    // The names, the links and the current page are unchanged.
    expect(category("Observability")).toHaveAttribute("aria-current", "page");
    expect(category("Evaluation")).toHaveAttribute(
      "href",
      "/project/p1/datasets",
    );
    expect(window.localStorage.getItem(STORED_KEY)).toBe("true");

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(rail().className).toContain("w-22");
    expect(category("Evaluation")).toHaveClass("flex-col");
    // Compact, the default, is kept as nothing.
    expect(window.localStorage.getItem(STORED_KEY)).toBeNull();
  });

  it("opens as this person left it, with no compact render first", () => {
    window.localStorage.setItem(STORED_KEY, "true");
    const changes = new MutationObserver(() => {});
    changes.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    render(<Shell />);
    const railChanges = changes
      .takeRecords()
      .filter((record) => record.target === rail());
    changes.disconnect();

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(rail().className).toContain("w-52");
    expect(railChanges).toEqual([]);
  });

  it("keeps each person's own choice", () => {
    window.localStorage.setItem(STORED_KEY, "true");
    const { rerender } = render(<Shell userId="u2" />);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");

    rerender(<Shell userId={USER} />);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    rerender(<Shell userId="u2" />);
    fireEvent.click(toggle());
    expect(window.localStorage.getItem("cairo.railExpanded.v1:u2")).toBe(
      "true",
    );
    expect(window.localStorage.getItem(STORED_KEY)).toBe("true");
  });

  it("still expands when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refused");
    });
    render(<Shell />);

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("Ctrl+\\ or Cmd+\\ expands and collapses it from anywhere on the page", () => {
    render(<Shell />);

    // Handled: the browser's own handling of the key is prevented.
    expect(
      fireEvent.keyDown(document.body, { ...backslash, ctrlKey: true }),
    ).toBe(false);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem(STORED_KEY)).toBe("true");

    fireEvent.keyDown(category("Evaluation"), {
      ...backslash,
      metaKey: true,
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("the shortcut does nothing while typing, with Shift or Alt held, or without Ctrl or Cmd", () => {
    render(
      <Shell>
        <input aria-label="Search" />
        <textarea aria-label="Notes" />
      </Shell>,
    );
    const search = screen.getByRole("textbox", { name: "Search" });
    act(() => search.focus());

    expect(fireEvent.keyDown(search, { ...backslash, ctrlKey: true })).toBe(
      true,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), {
      ...backslash,
      metaKey: true,
    });
    fireEvent.keyDown(document.body, {
      ...backslash,
      ctrlKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(document.body, {
      ...backslash,
      ctrlKey: true,
      altKey: true,
    });
    fireEvent.keyDown(document.body, backslash);
    fireEvent.keyDown(document.body, {
      ...backslash,
      ctrlKey: true,
      repeat: true,
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(railKeys()).toEqual([]);
  });

  it("names the shortcut in its tooltip and to assistive technology", async () => {
    render(<Shell />);

    expect(toggle()).toHaveAttribute("aria-keyshortcuts", "Control+\\");
    act(() => toggle().focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Expand navigation (Ctrl+\\)",
    );
  });

  it("is not there with the rail off", () => {
    h.flag = false;
    render(<Shell />);
    expect(
      screen.queryByRole("button", { name: /navigation$/ }),
    ).not.toBeInTheDocument();
  });
});

describe("one header row across the rail and the sidebar (CHG-2026-150)", () => {
  beforeEach(() => {
    h.flag = true;
    h.query = { projectId: "p1" };
    useEyeonRailStore.setState({ selection: null, presence: {} });
    window.localStorage.clear();
  });

  it("the rail's top row has no divider on its right; below it, the rail's edge divides the two columns", () => {
    render(<Shell />);

    const [topRow, body] = [...rail().children];
    expect(topRow).toHaveAttribute("aria-hidden", "true");
    expect(topRow.className).toContain("border-b");
    expect(topRow.className).not.toMatch(/(^| )border-r( |$)/);
    expect(rail().className).not.toMatch(/(^| )border-r( |$)/);
    expect(body.className).toMatch(/(^| )border-r( |$)/);
    expect(within(body as HTMLElement).getAllByRole("listitem").length).toBe(7);
  });

  it("the sidebar's header row reaches back by the width the rail hands it, and keeps to the sidebar when collapsed to icons", () => {
    // The variable the header row reads is the one the rail sets.
    const handed = /\[--([\w-]+):/.exec(EYEON_RAIL_WIDTH_CLASS.compact)?.[1];
    expect(handed).toBe("eyeon-rail-width");
    expect(EYEON_RAIL_HEADER_ROW_CLASS).toContain(
      `ml-[calc(var(--${handed},0px)*-1)]`,
    );
    expect(EYEON_RAIL_HEADER_ROW_CLASS).toContain(
      "group-data-[collapsible=icon]:ml-0",
    );
    // It moves with the sidebar panel's own timing, so the logo stays put.
    expect(EYEON_RAIL_HEADER_ROW_CLASS).toContain("duration-200 ease-linear");
    expect(EYEON_RAIL_TRANSITION_CLASS).toContain("duration-200 ease-linear");
  });

  it("AppSidebar's header row carries it (an upstream sync must keep it)", () => {
    const appSidebar = readFileSync(
      join(process.cwd(), "src/components/nav/AppSidebar/AppSidebar.tsx"),
      "utf8",
    );
    expect(appSidebar).toMatch(
      /data-testid=\{APP_SHELL_CHROME_ROW_TEST_ID\}[\s\S]{0,1000}EYEON_RAIL_HEADER_ROW_CLASS,/,
    );
    expect(appSidebar).toContain("ACME (CHG-2026-150)");
  });
});
