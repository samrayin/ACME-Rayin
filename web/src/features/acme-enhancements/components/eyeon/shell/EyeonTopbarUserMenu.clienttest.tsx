import { fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar, SidebarRail } from "@/src/components/ui/sidebar";
import { EyeonTopbarUserMenu } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonTopbarUserMenu";
import { type EyeonUserMenuItem } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonUserMenuContext";
import { EyeonSidebarProvider } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonSidebarProvider";

// CHG-2026-134: the user menu moved from the sidebar footer to the top bar.
// It keeps the footer's block (avatar, name, email) and renders every item the
// layout passes, as the footer did: links, actions and submenus.
// CHG-2026-142 follow-up (owner, 2026-10-08): inside EYEON's sidebar provider
// it also offers "Reset sidebar width", on desktop and in the phone menu.

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/project/p1/traces",
    pathname: "/project/[projectId]/traces",
    push: vi.fn(),
    query: { projectId: "p1" },
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

const USER = { name: "Ada Lovelace", email: "ada-email", avatar: "" };

function items(onSignOut: () => void, onPreview: () => void) {
  const list: EyeonUserMenuItem[] = [
    { type: "link", name: "Account Settings", href: "/account/settings" },
    { type: "link", name: "v4 Migration", href: "/v4-migration" },
    {
      type: "action",
      name: "Theme",
      onClick: () => {},
      content: <span>Theme switch</span>,
    },
    { type: "action", name: "Feature Preview", onClick: onPreview },
    {
      type: "submenu",
      name: "Instances",
      subItems: [{ type: "action", name: "Second instance", onClick: vi.fn() }],
    },
    { type: "action", name: "Sign out", onClick: onSignOut },
  ];
  return list;
}

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /User menu/ }), {
    key: "Enter",
  });
  return screen.getByRole("menu");
}

describe("EyeonTopbarUserMenu (CHG-2026-134)", () => {
  it("shows the person and every item the sidebar footer had", () => {
    render(<EyeonTopbarUserMenu user={USER} items={items(vi.fn(), vi.fn())} />);

    const trigger = screen.getByRole("button", {
      name: "User menu, Ada Lovelace, ada-email",
    });
    expect(within(trigger).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(trigger).getByText("ada-email")).toBeInTheDocument();

    const menu = openMenu();
    expect(within(menu).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(menu).getByText("ada-email")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Account Settings",
      "v4 Migration",
      "Theme switch",
      "Feature Preview",
      "Instances",
      "Sign out",
    ]);
    expect(
      within(menu).getByRole("menuitem", { name: "Account Settings" }),
    ).toHaveAttribute("href", "/account/settings");
  });

  it("runs an item's action, as the footer did", () => {
    const onSignOut = vi.fn();
    const onPreview = vi.fn();
    render(
      <EyeonTopbarUserMenu user={USER} items={items(onSignOut, onPreview)} />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Feature Preview" }),
    );
    expect(onPreview).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Sign out" }),
    );
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows only the avatar in the compact (mobile) trigger, with the full menu", () => {
    render(
      <EyeonTopbarUserMenu
        user={USER}
        items={items(vi.fn(), vi.fn())}
        compact
      />,
    );

    const trigger = screen.getByRole("button", { name: /^User menu/ });
    expect(within(trigger).queryByText("Ada Lovelace")).toBeNull();
    expect(within(openMenu()).getAllByRole("menuitem")).toHaveLength(6);
  });
});

const KEY = "cairo.sidebarWidth.v1:u1";

/** The authenticated layout's wiring, reduced: the provider, the sidebar's edge and the top bar's menu. */
function Shell({
  compact = false,
  menuItems = items(vi.fn(), vi.fn()),
}: {
  compact?: boolean;
  menuItems?: EyeonUserMenuItem[];
}) {
  return (
    <EyeonSidebarProvider userId="u1">
      <Sidebar collapsible="icon">
        <SidebarRail />
      </Sidebar>
      <EyeonTopbarUserMenu user={USER} items={menuItems} compact={compact} />
    </EyeonSidebarProvider>
  );
}

const resetItem = () =>
  within(openMenu()).getByRole("menuitem", { name: "Reset sidebar width" });

/** What a reset leaves: the edge's values, the width on screen, what is kept. */
function widthState(container: HTMLElement) {
  const edge = container.querySelector('[role="separator"]');
  const wrapper = container.querySelector<HTMLElement>(
    '[class*="group/sidebar-wrapper"]',
  );
  return {
    now: edge?.getAttribute("aria-valuenow"),
    text: edge?.getAttribute("aria-valuetext"),
    css: wrapper?.style.getPropertyValue("--sidebar-width"),
    kept: window.localStorage.getItem(KEY),
  };
}

describe("Reset sidebar width (CHG-2026-142 follow-up)", () => {
  beforeEach(() => {
    // Wide enough for the full 24rem.
    vi.stubGlobal("innerWidth", 1920);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is not offered outside EYEON's sidebar provider", () => {
    render(<EyeonTopbarUserMenu user={USER} items={items(vi.fn(), vi.fn())} />);

    expect(
      within(openMenu()).queryByRole("menuitem", {
        name: "Reset sidebar width",
      }),
    ).toBeNull();
  });

  it("is named Reset sidebar width and sits after the theme", () => {
    render(<Shell />);

    const item = resetItem();
    expect(item).toHaveAccessibleName("Reset sidebar width");
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent),
    ).toEqual([
      "Account Settings",
      "v4 Migration",
      "Theme switch",
      "Reset sidebar width",
      "Feature Preview",
      "Instances",
      "Sign out",
    ]);
  });

  it("comes last when the menu has no theme item", () => {
    render(
      <Shell
        menuItems={items(vi.fn(), vi.fn()).filter(
          (entry) => entry.name !== "Theme",
        )}
      />,
    );

    const names = within(openMenu())
      .getAllByRole("menuitem")
      .map((entry) => entry.textContent);
    expect(names.at(-1)).toBe("Reset sidebar width");
  });

  it("is disabled while the kept width is the default, and then does nothing", () => {
    const { container } = render(<Shell />);
    const before = widthState(container);

    const item = resetItem();
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("data-disabled");
    fireEvent.click(item);
    expect(widthState(container)).toEqual(before);
  });

  it("is enabled once the width differs from the default, and disabled again after a reset", () => {
    const { container } = render(<Shell />);
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Resize sidebar" }),
      { key: "ArrowRight" },
    );
    expect(widthState(container).kept).toBe("12");

    const item = resetItem();
    expect(item).not.toHaveAttribute("aria-disabled");
    fireEvent.click(item);
    expect(widthState(container).kept).toBeNull();
    expect(resetItem()).toHaveAttribute("aria-disabled", "true");
  });

  it("resets exactly as Enter on the sidebar's edge does", () => {
    window.localStorage.setItem(KEY, "18");
    const viaEnter = render(<Shell />);
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Resize sidebar" }),
      { key: "Enter" },
    );
    const afterEnter = widthState(viaEnter.container);
    viaEnter.unmount();

    window.localStorage.setItem(KEY, "18");
    const { container } = render(<Shell />);
    expect(widthState(container)).toMatchObject({ now: "18", kept: "18" });
    fireEvent.click(resetItem());

    expect(widthState(container)).toEqual(afterEnter);
    expect(afterEnter).toEqual({
      now: "11.5",
      text: "11.5 rem, the default",
      css: "11.5rem",
      kept: null,
    });
  });

  it("is enabled when a narrow window already shows the default but a wider width is kept", () => {
    window.localStorage.setItem(KEY, "18");
    vi.stubGlobal("innerWidth", 700);
    const { container } = render(<Shell />);
    expect(widthState(container)).toMatchObject({ now: "11.5", kept: "18" });

    const item = resetItem();
    expect(item).not.toHaveAttribute("aria-disabled");
    fireEvent.click(item);
    expect(widthState(container).kept).toBeNull();
  });

  it("is in the compact (phone) menu too, on a phone where the sidebar has no edge", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("max-width: 767px"),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) satisfies MediaQueryList,
    );
    window.localStorage.setItem(KEY, "18");
    const { container } = render(<Shell compact />);
    expect(container.querySelector('[role="separator"]')).toBeNull();

    const item = resetItem();
    expect(item).toHaveAccessibleName("Reset sidebar width");
    expect(item).not.toHaveAttribute("aria-disabled");
    fireEvent.click(item);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(resetItem()).toHaveAttribute("aria-disabled", "true");
  });
});
