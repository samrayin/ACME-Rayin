import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Home, Settings } from "lucide-react";
import { Role } from "@langfuse/shared";
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
//
// CHG-2026-141: ACME AI is back behind CAIRO_ACME_AI_ENABLED (default off).
// Off, the top bars are as above; on, its launcher sits just left of the user
// menu for roles that may use it. Upstream's assistant stays removed.

const assistant = vi.hoisted(() => ({
  setOpen: vi.fn(),
  openAssistant: vi.fn(),
}));

// CHG-2026-141: the person's role in project p1 (none by default, as in the
// CHG-2026-134 tests) and ACME AI's switch, as acmeChat.status answers it.
const acmeAi = vi.hoisted(() => ({
  role: undefined as string | undefined,
  switchedOn: false,
  statusQuery: vi.fn(),
}));

vi.mock("@/src/utils/api", () => ({
  api: {
    acmeChat: {
      status: {
        useQuery: (...args: unknown[]) => {
          acmeAi.statusQuery(...args);
          return { data: { enabled: acmeAi.switchedOn } };
        },
      },
    },
  },
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
      user: {
        name: "Ada Lovelace",
        email: "ada-email",
        organizations: acmeAi.role
          ? [
              {
                id: "o1",
                name: "org",
                role: acmeAi.role,
                plan: "oss",
                projects: [
                  {
                    id: "p1",
                    name: "p",
                    role: acmeAi.role,
                    deletedAt: null,
                    retentionDays: null,
                  },
                ],
              },
            ]
          : [],
      },
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
          {mobile ? (
            <div data-testid="mobile-top-bar">
              <MobileTopBar />
            </div>
          ) : (
            <PageHeader title="Tracing" />
          )}
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

  // CHG-2026-141 narrowed this check: ACME AI may be mounted only through its
  // switched entry points (AcmeChatTopbarLauncher, AcmeChatPanelHost), never
  // directly; upstream's assistant launcher stays out entirely.
  it("no top bar or layout mounts the assistant launcher, or ACME AI except behind its switch", () => {
    const pageHeader = "src/components/layouts/page-header.tsx";
    const mobileTopBar = "src/components/layouts/mobile-top-bar.tsx";
    const layout =
      "src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx";
    const sources = new Map(
      [pageHeader, mobileTopBar, layout].map((file) => [
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
      ]),
    );
    expect(sources.get(pageHeader)).toContain("<AcmeChatTopbarLauncher />");
    expect(sources.get(mobileTopBar)).toContain(
      "<AcmeChatTopbarLauncher compact />",
    );
    expect(sources.get(layout)).toContain("<AcmeChatPanelHost");
    for (const [file, source] of sources) {
      for (const pattern of [
        /InAppAiAgentButton/,
        /<AcmeChatLauncher\b/,
        /<AcmeChatWidget\b/,
        /useIsAcmeChatLauncherVisible/,
      ]) {
        expect(`${file} matches ${pattern}: ${pattern.test(source)}`).toBe(
          `${file} matches ${pattern}: false`,
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

// The buttons of the top bar on screen, left to right.
function topBarControls(mobile: boolean) {
  const bar = mobile
    ? screen.getByTestId("mobile-top-bar")
    : document.getElementById("page-header");
  expect(bar).not.toBeNull();
  return within(bar!).getAllByRole("button");
}

describe("ACME AI behind CAIRO_ACME_AI_ENABLED (CHG-2026-141)", () => {
  beforeEach(() => {
    acmeAi.role = Role.OWNER;
    acmeAi.switchedOn = false;
    acmeAi.statusQuery.mockClear();
  });

  afterEach(() => {
    acmeAi.role = undefined;
    acmeAi.switchedOn = false;
  });

  it.each([false, true])(
    "switched off: no launcher even for an Owner, and the user menu stays last (mobile: %s)",
    (mobile) => {
      render(<Shell mobile={mobile} />);

      expect(screen.queryByRole("button", { name: /ACME AI/ })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(topBarControls(mobile).at(-1)).toHaveAccessibleName(
        "User menu, Ada Lovelace, ada-email",
      );
    },
  );

  it.each([false, true])(
    "switched on: the launcher sits just left of the user menu (mobile: %s)",
    (mobile) => {
      acmeAi.switchedOn = true;
      render(<Shell mobile={mobile} />);

      const controls = topBarControls(mobile);
      expect(controls.at(-1)).toHaveAccessibleName(
        "User menu, Ada Lovelace, ada-email",
      );
      expect(controls.at(-2)).toHaveAccessibleName("Open ACME AI");
      // Upstream's assistant is not part of this change: still no launcher.
      expect(screen.queryByRole("button", { name: /assistant/i })).toBeNull();
    },
  );

  it.each([Role.ADMIN, Role.MEMBER])(
    "switched on, %s gets the launcher too",
    (role) => {
      acmeAi.role = role;
      acmeAi.switchedOn = true;
      render(<Shell />);

      expect(
        screen.getByRole("button", { name: "Open ACME AI" }),
      ).toBeInTheDocument();
    },
  );

  // Content-free roles and Viewers do not hold projectAiAssistant:use, so
  // their top bars never ask acmeChat.status, whatever the switch.
  it.each([Role.VIEWER, Role.SECURITY, Role.ANALYST, Role.AUDITOR])(
    "switched on, %s gets no launcher and never asks for the switch",
    (role) => {
      acmeAi.role = role;
      acmeAi.switchedOn = true;
      render(<Shell />);
      render(<Shell mobile />);

      expect(screen.queryByRole("button", { name: /ACME AI/ })).toBeNull();
      expect(acmeAi.statusQuery).not.toHaveBeenCalled();
    },
  );
});
