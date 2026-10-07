import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Home, Settings } from "lucide-react";
import PageHeader from "@/src/components/layouts/page-header";
import { MobileTopBar } from "@/src/components/layouts/mobile-top-bar";
import { AppSidebar } from "@/src/components/nav/AppSidebar/AppSidebar";
import { SidebarPresenceProvider } from "@/src/components/nav/sidebar-presence";
import { SidebarProvider } from "@/src/components/ui/sidebar";
import { EyeonUserMenuProvider } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonUserMenuContext";

// CHG-2026-134: ACME AI is removed from EYEON and the user menu takes its
// place at the right edge of the top bar. Neither top bar mounts an AI
// launcher or its Ctrl/Cmd+I shortcut any more, even where upstream's
// assistant would be available; the sidebar footer no longer holds the user
// menu; on a phone the full menu is in the mobile top bar.

const assistant = vi.hoisted(() => ({
  setOpen: vi.fn(),
  openAssistant: vi.fn(),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/project/p1/traces",
    pathname: "/project/[projectId]/traces",
    push: vi.fn(),
    query: { projectId: "p1" },
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { name: "Ada Lovelace", email: "ada-email", organizations: [] },
      // As if upstream's assistant were switched on for this instance.
      environment: { inAppAgentEnabled: true },
    },
    status: "authenticated",
  }),
}));

vi.mock("@/src/features/organizations/hooks", () => ({
  useLangfuseCloudRegion: () => ({ isLangfuseCloud: false, region: undefined }),
}));

vi.mock("@/src/features/projects/hooks", () => ({
  useQueryProjectOrOrganization: () => ({ organization: null, project: null }),
  useOrgProjectSwitchPaths: () => ({
    getProjectPath: vi.fn(),
    getOrgPath: vi.fn(),
  }),
}));

// Upstream's assistant, as if it were available: its launcher would show and
// Ctrl/Cmd+I would open it. EYEON's top bars must not offer it.
vi.mock("@/src/features/in-app-agent/components/InAppAiAgentProvider", () => ({
  useIsInAppAgentLauncherVisible: () => true,
  useInAppAiAgent: () => ({
    open: false,
    attentionCount: 0,
    isAvailable: true,
    setOpen: assistant.setOpen,
    openAssistant: assistant.openAssistant,
  }),
}));

vi.mock("@/src/components/nav/topbar-brand", () => ({
  TopbarBrand: () => <span>EYEON</span>,
}));

vi.mock(
  "@/src/features/acme-enhancements/theme/useAcmeHeaderBackgroundClassName",
  async () => {
    const { acmeHeaderBackgroundClass } =
      await import("@/src/features/acme-enhancements/theme/acmeThemePresets");
    return {
      useAcmeHeaderBackgroundClassName: () =>
        acmeHeaderBackgroundClass(undefined),
    };
  },
);

const USER = { name: "Ada Lovelace", email: "ada-email", avatar: "" };
const signOut = vi.fn();
const MENU_ITEMS = [
  {
    type: "link" as const,
    name: "Account Settings",
    href: "/account/settings",
  },
  {
    type: "action" as const,
    name: "Theme",
    onClick: () => {},
    content: <span>Theme switch</span>,
  },
  { type: "action" as const, name: "Sign out", onClick: signOut },
];

const sidebarArgs = {
  navItems: {
    ungrouped: [{ title: "Home", url: "/", icon: Home, isActive: true }],
    grouped: null,
  },
  secondaryNavItems: {
    ungrouped: [{ title: "Settings", url: "/settings", icon: Settings }],
    grouped: null,
  },
  user: USER,
  userMenuItems: MENU_ITEMS,
  isMobile: false,
  logo: {},
  versionState: { deployment: "cloud" as const },
  showDemoBadge: false,
  v4UpgradeUiEnabled: true,
  notificationState: {
    dismissedIds: [] as string[],
    onDismiss: vi.fn(),
    onLinkClick: vi.fn(),
  },
  organization: null,
  project: null,
  organizations: null,
  canCreateOrganizations: false,
  canCreateProjects: false,
};

function Shell({ mobile = false }: { mobile?: boolean }) {
  return (
    <EyeonUserMenuProvider user={USER} items={MENU_ITEMS}>
      <SidebarPresenceProvider>
        <SidebarProvider>
          <AppSidebar {...sidebarArgs} />
          {mobile ? <MobileTopBar /> : <PageHeader title="Tracing" />}
        </SidebarProvider>
      </SidebarPresenceProvider>
    </EyeonUserMenuProvider>
  );
}

function pressShortcut(modifier: "ctrlKey" | "metaKey") {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "i", bubbles: true, [modifier]: true }),
  );
}

describe("ACME AI is gone from the top bar (CHG-2026-134)", () => {
  beforeEach(() => {
    assistant.setOpen.mockReset();
    assistant.openAssistant.mockReset();
  });

  it.each([false, true])(
    "offers no AI launcher and no Ctrl/Cmd+I shortcut (mobile: %s)",
    (mobile) => {
      render(<Shell mobile={mobile} />);

      expect(screen.queryByRole("button", { name: /ACME AI/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /assistant/i })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();

      pressShortcut("ctrlKey");
      pressShortcut("metaKey");
      expect(assistant.openAssistant).not.toHaveBeenCalled();
      expect(assistant.setOpen).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("no top bar, panel host or layout mounts ACME AI or the assistant launcher", () => {
    for (const file of [
      "src/components/layouts/page-header.tsx",
      "src/components/layouts/mobile-top-bar.tsx",
      "src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const name of [
        "AcmeChatLauncher",
        "AcmeChatWidget",
        "InAppAiAgentButton",
      ]) {
        expect(`${file} uses ${name}: ${source.includes(name)}`).toBe(
          `${file} uses ${name}: false`,
        );
      }
    }
  });
});

describe("the user menu sits in the top bar (CHG-2026-134)", () => {
  it("is the last control at the right edge of the desktop top bar", () => {
    render(<Shell />);

    const header = document.getElementById("page-header");
    expect(header).not.toBeNull();
    const controls = within(header!).getAllByRole("button");
    expect(controls[controls.length - 1]).toHaveAccessibleName(
      "User menu, Ada Lovelace, ada-email",
    );
  });

  it("opens with the person and the layout's items", () => {
    render(<Shell />);

    fireEvent.keyDown(screen.getByRole("button", { name: /User menu/ }), {
      key: "Enter",
    });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("ada-email")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Account Settings", "Theme switch", "Sign out"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("is no longer in the sidebar footer", () => {
    const { container } = render(<Shell />);

    expect(container.querySelector('[data-sidebar="footer"]')).toBeNull();
    const sidebar = container.querySelector('[data-sidebar="sidebar"]');
    expect(sidebar).not.toBeNull();
    expect(
      within(sidebar as HTMLElement).queryByText("Ada Lovelace"),
    ).toBeNull();
  });

  it("is reachable on a phone: the mobile top bar has the full menu", () => {
    render(<Shell mobile />);

    const trigger = screen.getByRole("button", { name: /^User menu/ });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(
      within(screen.getByRole("menu")).getAllByRole("menuitem"),
    ).toHaveLength(MENU_ITEMS.length);
    // The short account menu is only the fallback outside the layout.
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("outside the authenticated layout the mobile top bar keeps its account menu", () => {
    render(
      <SidebarPresenceProvider>
        <SidebarProvider>
          <MobileTopBar />
        </SidebarProvider>
      </SidebarPresenceProvider>,
    );

    expect(screen.getByRole("button", { name: "Account menu" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /User menu/ })).toBeNull();
  });
});
