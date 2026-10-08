import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Home, ListTree, Settings } from "lucide-react";
import { RouteGroup, RouteSection } from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { NavMain } from "@/src/components/nav/nav-main";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/src/components/ui/sidebar";
import { EyeonRail } from "@/src/features/acme-enhancements/components/eyeon/rail/EyeonRail";
import { useEyeonRail } from "@/src/features/acme-enhancements/components/eyeon/rail/useEyeonRail";
import { useEyeonRailStore } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailStore";
import type { EyeonRailNavigation } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";
import { EyeonSidebarProvider } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonSidebarProvider";
import { useEyeonSidebarWidth } from "@/src/features/acme-enhancements/components/eyeon/shell/eyeonSidebarWidthContext";
import { SIDEBAR_WIDTH_DEFAULT_REM } from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";

// CHG-2026-142 (ADR-0026 §12.4): the resizable sidebar on screen. The edge
// is a window splitter (a focusable vertical separator with its values);
// a drag or the keyboard resizes it, a click still collapses it, Enter
// resets it; the width is kept in this browser only; the phone sheet and
// the collapsed sidebar keep their own widths; with the EYEON rail on, the
// list beside the rail resizes and the rail keeps its own width.
// The follow-up (owner, 2026-10-08): the width is kept per signed-in person,
// the browser's old width moves to the first person once, and on a narrow
// window the widest is a quarter of the window, re-measured on resize.

const h = vi.hoisted(() => ({
  railFlag: false,
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
      railStatus: { useQuery: () => ({ data: { enabled: h.railFlag } }) },
    },
  },
}));

const USER = "u1";
const KEY = "cairo.sidebarWidth.v1:u1";
const LEGACY_KEY = "cairo.sidebarWidth.v1";

/** The layout's wiring, reduced: the provider, the sidebar and its rail. */
/** `userId` null: no person known yet. */
function Shell({ userId = USER }: { userId?: string | null }) {
  return (
    <EyeonSidebarProvider userId={userId ?? undefined}>
      <Sidebar collapsible="icon">
        <span>panel</span>
        <SidebarRail />
      </Sidebar>
      <SidebarTrigger />
    </EyeonSidebarProvider>
  );
}

const handle = () => screen.getByRole("separator", { name: "Resize sidebar" });
const noHandle = () =>
  expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBe(
    null,
  );
/** sidebar.tsx's provider wrapper, which holds `--sidebar-width`. */
const wrapper = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[class*="group/sidebar-wrapper"]')!;
const cssWidth = (container: HTMLElement) =>
  wrapper(container).style.getPropertyValue("--sidebar-width");
const sidebarState = (container: HTMLElement) =>
  container.querySelector('[data-side="left"]')?.getAttribute("data-state");

function press(element: Element, clientX: number) {
  fireEvent(
    element,
    new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX,
      button: 0,
    }),
  );
}
function moveTo(clientX: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX }));
  });
}
function release() {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup"));
  });
}

function stubScreen(matches: (query: string) => boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: matches(query),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) satisfies MediaQueryList,
  );
}

beforeEach(() => {
  // A window wide enough for the full 24rem (a quarter of 1920px is 30rem).
  vi.stubGlobal("innerWidth", 1920);
  h.railFlag = false;
  h.query = { projectId: "p1" };
  window.localStorage.clear();
  useEyeonRailStore.setState({ selection: null, presence: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the handle (CHG-2026-142)", () => {
  it("is a focusable vertical separator named Resize sidebar, with its values", () => {
    render(<Shell />);

    const edge = handle();
    expect(edge).toHaveAttribute("aria-orientation", "vertical");
    expect(edge).toHaveAttribute("aria-valuenow", "11.5");
    expect(edge).toHaveAttribute("aria-valuemin", "11.5");
    expect(edge).toHaveAttribute("aria-valuemax", "24");
    expect(edge).toHaveAttribute("aria-valuetext", "11.5 rem, the default");
    expect(edge).toHaveAttribute("tabindex", "0");
    expect(edge).toHaveAccessibleDescription(/arrow keys/);
    expect(edge).toHaveAccessibleDescription(/Enter resets it/);
    act(() => edge.focus());
    expect(edge).toHaveFocus();
  });

  it("shows the resize cursor and a line on hover and on keyboard focus", () => {
    render(<Shell />);

    const edge = handle();
    expect(edge).toHaveClass(
      "cursor-col-resize",
      "hover:after:bg-sidebar-ring",
      "focus-visible:after:bg-sidebar-ring",
    );
    // Where upstream's rail sat: centred on the inner edge, desktop only.
    expect(edge).toHaveClass(
      "group-data-[side=left]:-right-4",
      "hidden",
      "md:flex",
    );
  });

  it("leaves sidebar.tsx's own width, and stores nothing, until someone resizes", () => {
    const { container } = render(<Shell />);

    expect(cssWidth(container)).toBe(`${SIDEBAR_WIDTH_DEFAULT_REM}rem`);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("the keyboard (CHG-2026-142)", () => {
  it("steps with the arrow keys and keeps the width", () => {
    const { container } = render(<Shell />);

    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle()).toHaveAttribute("aria-valuenow", "12.5");
    expect(cssWidth(container)).toBe("12.5rem");
    expect(window.localStorage.getItem(KEY)).toBe("12.5");

    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle()).toHaveAttribute("aria-valuenow", "12");
    expect(window.localStorage.getItem(KEY)).toBe("12");
  });

  it("goes to the limits with Home and End, and no further", () => {
    const { container } = render(<Shell />);

    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle()).toHaveAttribute("aria-valuenow", "24");
    expect(cssWidth(container)).toBe("24rem");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle()).toHaveAttribute("aria-valuenow", "24");

    fireEvent.keyDown(handle(), { key: "Home" });
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
  });

  it("resets to the default with Enter, leaving nothing stored", () => {
    const { container } = render(<Shell />);

    fireEvent.keyDown(handle(), { key: "End" });
    expect(window.localStorage.getItem(KEY)).toBe("24");

    fireEvent.keyDown(handle(), { key: "Enter" });
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    expect(cssWidth(container)).toBe("11.5rem");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("leaves other keys, and shortcuts with a modifier, alone", () => {
    render(<Shell />);

    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    fireEvent.keyDown(handle(), { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(handle(), { key: "End", metaKey: true });
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("dragging and clicking (CHG-2026-142)", () => {
  it("a drag resizes, live, and keeps the width when released", () => {
    const { container } = render(<Shell />);

    press(handle(), 200);
    // Under the threshold it is still a click, not a drag.
    moveTo(202);
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");

    moveTo(264); // 64px = 4rem
    expect(handle()).toHaveAttribute("aria-valuenow", "15.5");
    expect(cssWidth(container)).toBe("15.5rem");
    // While dragging: no lagging transition, no text selection.
    expect(wrapper(container)).toHaveClass(
      "select-none",
      "[&_[data-side]>div]:transition-none",
    );
    expect(handle()).toHaveAttribute("data-resizing", "true");
    expect(window.localStorage.getItem(KEY)).toBeNull();

    release();
    expect(window.localStorage.getItem(KEY)).toBe("15.5");
    expect(wrapper(container)).not.toHaveClass("select-none");
    expect(handle()).not.toHaveAttribute("data-resizing");
  });

  it("the click that ends a drag does not collapse the sidebar", () => {
    const { container } = render(<Shell />);

    press(handle(), 200);
    moveTo(232);
    release();
    fireEvent.click(handle());

    expect(sidebarState(container)).toBe("expanded");
    expect(handle()).toHaveAttribute("aria-valuenow", "13.5");
  });

  it("stops at the limits however far it is dragged", () => {
    render(<Shell />);

    press(handle(), 200);
    moveTo(2000);
    expect(handle()).toHaveAttribute("aria-valuenow", "24");
    moveTo(-2000);
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    release();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("Escape during a drag puts the width back and keeps nothing", () => {
    window.localStorage.setItem(KEY, "14");
    render(<Shell />);

    press(handle(), 200);
    moveTo(300);
    expect(handle()).toHaveAttribute("aria-valuenow", "20.25");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(handle()).toHaveAttribute("aria-valuenow", "14");
    expect(window.localStorage.getItem(KEY)).toBe("14");

    // The drag is over: the pointer no longer moves the edge.
    moveTo(400);
    expect(handle()).toHaveAttribute("aria-valuenow", "14");
  });

  it("a click still collapses the sidebar; collapsed, the edge is upstream's rail and expands it", () => {
    const { container } = render(<Shell />);

    fireEvent.click(handle());
    expect(sidebarState(container)).toBe("collapsed");
    // Collapsed: no resize handle, upstream's rail in its place.
    noHandle();
    const rail = container.querySelector('button[data-sidebar="rail"]');
    expect(rail).not.toBeNull();

    fireEvent.click(rail!);
    expect(sidebarState(container)).toBe("expanded");
    expect(handle()).toBeInTheDocument();
  });

  it("a sidebar that opens collapsed has no resize handle", () => {
    window.localStorage.setItem("sidebar:state", "false");
    window.localStorage.setItem(KEY, "18");
    const { container } = render(<Shell />);

    expect(sidebarState(container)).toBe("collapsed");
    noHandle();
  });

  it("removes its window listeners if it goes away mid-drag", () => {
    const removed = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Shell />);

    press(handle(), 200);
    unmount();

    const types = removed.mock.calls.map(([type]) => type);
    expect(types).toEqual(
      expect.arrayContaining(["pointermove", "pointerup", "keydown"]),
    );
  });
});

describe("persistence (CHG-2026-142)", () => {
  it("opens at the kept width on the very first render (no flash)", () => {
    window.localStorage.setItem(KEY, "16");
    const seen: number[] = [];
    function Probe() {
      seen.push(useEyeonSidebarWidth()?.width ?? -1);
      return null;
    }
    const { container } = render(
      <EyeonSidebarProvider userId={USER}>
        <Probe />
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </EyeonSidebarProvider>,
    );

    expect(seen[0]).toBe(16);
    expect(cssWidth(container)).toBe("16rem");
    expect(handle()).toHaveAttribute("aria-valuenow", "16");
  });

  it("ignores a kept value that is not a width within the limits", () => {
    for (const raw of ["999", "-3", "abc", '"16"', "{}"]) {
      window.localStorage.setItem(KEY, raw);
      const { container, unmount } = render(<Shell />);
      expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
      expect(cssWidth(container)).toBe("11.5rem");
      unmount();
    }
  });

  it("still resizes for the page when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refused");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refused");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Shell />);

    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle()).toHaveAttribute("aria-valuenow", "24");
    expect(cssWidth(container)).toBe("24rem");
  });

  it("is never sent to the server", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const send = vi.spyOn(XMLHttpRequest.prototype, "send");
    render(<Shell />);

    fireEvent.keyDown(handle(), { key: "End" });
    press(handle(), 200);
    moveTo(150);
    release();
    fireEvent.keyDown(handle(), { key: "Enter" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("where it applies (CHG-2026-142)", () => {
  it("not on a phone: no handle, and the sheet keeps its own width", () => {
    stubScreen((query) => query.includes("max-width: 767px"));
    window.localStorage.setItem(KEY, "20");
    render(<Shell />);

    noHandle();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const sheet = document.querySelector<HTMLElement>('[data-mobile="true"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.style.getPropertyValue("--sidebar-width")).toBe("12rem");
    noHandle();
  });

  it("not on a phone held sideways: upstream's rail, no handle", () => {
    stubScreen((query) => query.includes("pointer: coarse"));
    const { container } = render(<Shell />);

    noHandle();
    expect(
      container.querySelector('button[data-sidebar="rail"]'),
    ).not.toBeNull();
  });

  it("not outside EYEON's provider: upstream's rail, unchanged", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    noHandle();
    expect(
      container.querySelector('button[data-sidebar="rail"]'),
    ).toHaveAttribute("tabindex", "-1");
    expect(cssWidth(container)).toBe("11.5rem");
  });
});

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
  item("Tracing", "/project/[projectId]/traces", {
    group: RouteGroup.Observability,
    icon: ListTree,
    isActive: true,
  }),
  item("Settings", "/project/[projectId]/settings", {
    group: RouteGroup.Settings,
    icon: Settings,
  }),
];

const NAVIGATION: EyeonRailNavigation = {
  ungrouped: [ITEMS[0]],
  grouped: {
    [RouteGroup.Observability]: [ITEMS[1]],
    [RouteGroup.Settings]: [ITEMS[2]],
  },
  flattened: ITEMS,
};

/** The layout's wiring with the rail: the rail, then the sidebar beside it. */
function RailShell() {
  const rail = useEyeonRail(NAVIGATION);
  return (
    <EyeonSidebarProvider userId={USER}>
      <div className="flex">
        {rail.model && <EyeonRail model={rail.model} />}
        <Sidebar collapsible="icon">
          <NavMain items={rail.sidebarNavigation} />
          <SidebarRail />
        </Sidebar>
      </div>
    </EyeonSidebarProvider>
  );
}

describe("with the EYEON rail (CHG-2026-142)", () => {
  const railNav = () => screen.getByRole("navigation", { name: "Categories" });

  it("on: the list beside the rail resizes; the rail keeps its own width and offset", () => {
    h.railFlag = true;
    const { container } = render(<RailShell />);

    const before = railNav().className;
    expect(before).toContain("w-22");
    expect(before).toContain("[&~[data-side=left]>.fixed]:left-22");
    // The panel the rail shifts is the one whose width follows the drag.
    const panel = container.querySelector<HTMLElement>(
      '[data-side="left"] > .fixed',
    );
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain("w-(--sidebar-width)");

    // The drag is measured from where it started, so the rail's offset
    // (the edge sits 5.5rem further right) does not change the result.
    press(handle(), 88 + 184);
    moveTo(88 + 184 + 64);
    release();

    expect(handle()).toHaveAttribute("aria-valuenow", "15.5");
    expect(cssWidth(container)).toBe("15.5rem");
    expect(railNav().className).toBe(before);
    expect(railNav().getAttribute("style")).toBeNull();
  });

  it("off: no rail, and the sidebar resizes the same way", () => {
    h.railFlag = false;
    const { container } = render(<RailShell />);

    expect(screen.queryByRole("navigation", { name: "Categories" })).toBe(null);
    fireEvent.keyDown(handle(), { key: "End" });
    expect(cssWidth(container)).toBe("24rem");
  });
});

/** Animation frames, held until `run` (the window is re-measured in one). */
function stubFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let last = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    last += 1;
    frames.set(last, callback);
    return last;
  });
  const cancel = vi.fn((id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    request,
    cancel,
    run: () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(0));
      }),
  };
}

function resizeWindow(width: number) {
  vi.stubGlobal("innerWidth", width);
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

const widthKeys = () =>
  Object.keys(window.localStorage).filter((key) =>
    key.startsWith("cairo.sidebarWidth"),
  );

describe("the window's maximum (CHG-2026-142 follow-up)", () => {
  it("is the handle's largest value, a quarter of the window, re-measured on resize", () => {
    const frames = stubFrames();
    vi.stubGlobal("innerWidth", 1280);
    render(<Shell />);
    expect(handle()).toHaveAttribute("aria-valuemax", "20");
    expect(handle()).toHaveAttribute("aria-valuemin", "11.5");

    resizeWindow(1000);
    // Measured on the next frame, not on every resize event.
    expect(handle()).toHaveAttribute("aria-valuemax", "20");
    frames.run();
    expect(handle()).toHaveAttribute("aria-valuemax", "15.625");

    resizeWindow(600);
    frames.run();
    expect(handle()).toHaveAttribute("aria-valuemax", "11.5");

    resizeWindow(3000);
    frames.run();
    expect(handle()).toHaveAttribute("aria-valuemax", "24");
  });

  it("shows a kept width too wide for the window within it, and the kept width again when it widens", () => {
    window.localStorage.setItem(KEY, "22");
    const frames = stubFrames();
    vi.stubGlobal("innerWidth", 1280);
    const { container } = render(<Shell />);

    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(handle()).toHaveAttribute("aria-valuetext", "20 rem");
    expect(cssWidth(container)).toBe("20rem");
    expect(window.localStorage.getItem(KEY)).toBe("22");

    resizeWindow(700);
    frames.run();
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    expect(cssWidth(container)).toBe("11.5rem");
    expect(window.localStorage.getItem(KEY)).toBe("22");

    resizeWindow(1920);
    frames.run();
    expect(handle()).toHaveAttribute("aria-valuenow", "22");
    expect(cssWidth(container)).toBe("22rem");
    expect(window.localStorage.getItem(KEY)).toBe("22");
  });

  it("stops the keys; a key that leaves the width in place keeps the wider kept width", () => {
    window.localStorage.setItem(KEY, "22");
    vi.stubGlobal("innerWidth", 1280);
    render(<Shell />);

    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(window.localStorage.getItem(KEY)).toBe("22");
    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(window.localStorage.getItem(KEY)).toBe("22");

    // A key that changes the width keeps what is shown.
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle()).toHaveAttribute("aria-valuenow", "19.5");
    expect(window.localStorage.getItem(KEY)).toBe("19.5");
    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(window.localStorage.getItem(KEY)).toBe("20");
  });

  it("stops a drag; a drag that ends where it started keeps the wider kept width", () => {
    window.localStorage.setItem(KEY, "22");
    vi.stubGlobal("innerWidth", 1280);
    render(<Shell />);

    press(handle(), 500);
    moveTo(2000);
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    release();
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(window.localStorage.getItem(KEY)).toBe("22");

    press(handle(), 500);
    moveTo(436); // -64px = -4rem
    release();
    expect(handle()).toHaveAttribute("aria-valuenow", "16");
    expect(window.localStorage.getItem(KEY)).toBe("16");

    press(handle(), 500);
    moveTo(2000);
    release();
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(window.localStorage.getItem(KEY)).toBe("20");
  });

  it("Escape during a drag shows the kept width again, within the window", () => {
    window.localStorage.setItem(KEY, "22");
    vi.stubGlobal("innerWidth", 1280);
    render(<Shell />);

    press(handle(), 500);
    moveTo(400);
    expect(handle()).toHaveAttribute("aria-valuenow", "13.75");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
    expect(window.localStorage.getItem(KEY)).toBe("22");
  });

  it("Enter resets the kept width, even where the window already shows the default", () => {
    window.localStorage.setItem(KEY, "22");
    const frames = stubFrames();
    vi.stubGlobal("innerWidth", 700);
    render(<Shell />);
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    expect(handle()).toHaveAttribute("aria-valuemax", "11.5");

    fireEvent.keyDown(handle(), { key: "Enter" });
    expect(window.localStorage.getItem(KEY)).toBeNull();

    resizeWindow(1920);
    frames.run();
    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
  });

  it("measures at most once a frame, and removes its listener and frame when the sidebar goes away", () => {
    const frames = stubFrames();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Shell />);
    const resizeListeners = added.mock.calls
      .filter(([type]) => type === "resize")
      .map(([, listener]) => listener);
    expect(resizeListeners).toHaveLength(1);

    resizeWindow(1000);
    resizeWindow(1100);
    resizeWindow(1200);
    expect(frames.request).toHaveBeenCalledTimes(1);

    unmount();
    expect(removed).toHaveBeenCalledWith("resize", resizeListeners[0]);
    expect(frames.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("one width per person (CHG-2026-142 follow-up)", () => {
  it("keeps the width under the signed-in person's own key", () => {
    render(<Shell />);

    fireEvent.keyDown(handle(), { key: "End" });
    expect(window.localStorage.getItem(KEY)).toBe("24");
    expect(widthKeys()).toEqual([KEY]);
  });

  it("moves the browser's old width to the person on the first render, once", () => {
    window.localStorage.setItem(LEGACY_KEY, "18");
    const seen: number[] = [];
    function Probe() {
      seen.push(useEyeonSidebarWidth()?.width ?? -1);
      return null;
    }
    const { container } = render(
      <EyeonSidebarProvider userId={USER}>
        <Probe />
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </EyeonSidebarProvider>,
    );

    expect(seen[0]).toBe(18);
    expect(cssWidth(container)).toBe("18rem");
    expect(window.localStorage.getItem(KEY)).toBe("18");
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("with no person yet: the default, nothing written, the old width left in place", () => {
    window.localStorage.setItem(LEGACY_KEY, "18");
    const { container } = render(<Shell userId={null} />);

    expect(handle()).toHaveAttribute("aria-valuenow", "11.5");
    // It still resizes, for this page only.
    fireEvent.keyDown(handle(), { key: "End" });
    expect(cssWidth(container)).toBe("24rem");
    expect(widthKeys()).toEqual([LEGACY_KEY]);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe("18");
  });

  it("shows the next person's own width when the person changes", () => {
    window.localStorage.setItem(KEY, "20");
    window.localStorage.setItem("cairo.sidebarWidth.v1:u2", "14");
    const { rerender } = render(<Shell />);
    expect(handle()).toHaveAttribute("aria-valuenow", "20");

    rerender(<Shell userId="u2" />);
    expect(handle()).toHaveAttribute("aria-valuenow", "14");
    fireEvent.keyDown(handle(), { key: "Enter" });
    expect(window.localStorage.getItem("cairo.sidebarWidth.v1:u2")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe("20");

    rerender(<Shell />);
    expect(handle()).toHaveAttribute("aria-valuenow", "20");
  });
});

describe("the upstream files it relies on (CHG-2026-142)", () => {
  // If an upstream sync rewrites these lines, the handle silently goes away
  // (or the stored width stops applying); these fail first.
  const source = (file: string) =>
    readFileSync(join(process.cwd(), file), "utf8");

  it("sidebar.tsx keeps its 11.5rem default and the rail's hand-off to the handle", () => {
    const sidebar = source("src/components/ui/sidebar.tsx");
    expect(sidebar).toContain(
      `const SIDEBAR_WIDTH = "${SIDEBAR_WIDTH_DEFAULT_REM}rem";`,
    );
    expect(sidebar).toContain("<EyeonSidebarResizeHandle");
    expect(sidebar).toContain("ACME (CHG-2026-142)");
  });

  it("the authenticated layout uses EYEON's provider with the signed-in person, and the sidebar still renders its rail", () => {
    const layout = source(
      "src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx",
    );
    expect(layout).toContain("<EyeonSidebarProvider userId={user.id}>");
    expect(layout).not.toContain("<SidebarProvider");
    expect(source("src/components/nav/AppSidebar/AppSidebar.tsx")).toContain(
      "<SidebarRail />",
    );
  });
});
