import { render, screen } from "@testing-library/react";
import { Home, Settings } from "lucide-react";

import { APP_SHELL_CHROME_ROW_TEST_ID } from "@/src/components/layouts/app-shell-chrome";
import PageHeader from "@/src/components/layouts/page-header";
import { AppSidebar } from "@/src/components/nav/AppSidebar/AppSidebar";
import { SidebarPresenceProvider } from "@/src/components/nav/sidebar-presence";
import { SidebarProvider } from "@/src/components/ui/sidebar";

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
        email: "ada@langfuse.com",
        organizations: [],
      },
    },
    status: "authenticated",
  }),
}));

vi.mock("@/src/features/organizations/hooks", () => ({
  useLangfuseCloudRegion: () => ({ isLangfuseCloud: true, region: "EU" }),
}));

vi.mock("@/src/features/projects/hooks", () => ({
  useQueryProjectOrOrganization: () => ({
    organization: null,
    project: null,
  }),
  useOrgProjectSwitchPaths: () => ({
    getProjectPath: vi.fn(),
    getOrgPath: vi.fn(),
  }),
}));

vi.mock("@/src/components/nav/in-app-ai-agent-button", () => ({
  InAppAiAgentButton: () => null,
}));

vi.mock("@/src/features/in-app-agent/components/InAppAiAgentProvider", () => ({
  useIsInAppAgentLauncherVisible: () => true,
}));

vi.mock("@/src/components/nav/topbar-brand", () => ({
  TopbarBrand: () => null,
}));

// ACME (CHG-2026-131): the header-background hook reads the theme over tRPC,
// which this render has no provider for (every test here failed on that).
// Without a stored theme the hook returns the plain preset, as here.
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

const sidebarArgs = {
  navItems: {
    ungrouped: [{ title: "Home", url: "/", icon: Home, isActive: true }],
    grouped: null,
  },
  secondaryNavItems: {
    ungrouped: [{ title: "Settings", url: "/settings", icon: Settings }],
    grouped: null,
  },
  user: { name: "Ada Lovelace", email: "ada@example.com", avatar: "" },
  userMenuItems: [
    {
      type: "link" as const,
      name: "Account Settings",
      href: "/account/settings",
    },
  ],
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

const Shell = () => (
  <SidebarPresenceProvider>
    <SidebarProvider>
      <AppSidebar {...sidebarArgs} />
      <PageHeader title="Tracing" />
    </SidebarProvider>
  </SidebarPresenceProvider>
);

describe("app shell chrome row", () => {
  it("puts the sidebar and page-header dividers on the same min-h-11 row", () => {
    const { container } = render(<Shell />);

    const rows = screen.getAllByTestId(APP_SHELL_CHROME_ROW_TEST_ID);
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.className).toContain("min-h-11");
      expect(row.className).toContain("border-b");
      expect(row.className).toContain("items-center");
    }

    expect(container.querySelector(".h-1.flex-1.border-b")).toBeNull();
  });

  it("sizes the desktop sidebar toggle to the same 20px as the wordmark", () => {
    const { container } = render(<Shell />);

    const desktopToggle = [
      ...container.querySelectorAll("[data-sidebar=trigger] svg"),
    ].find((svg) => (svg.getAttribute("class") ?? "").includes("md:block"));

    expect(desktopToggle?.getAttribute("class")).toContain("size-5");
    expect(desktopToggle?.getAttribute("class")).not.toContain("size-4");
  });

  // CHG-2026-131 (ADR-0026): in dark mode the page header is the prototype's
  // top bar (chrome surface, hairline, no shadow); light keeps its classes.
  it("gives the page header the prototype's top bar in dark mode only", () => {
    render(<Shell />);

    const header = document.getElementById("page-header");
    expect(header).toHaveClass("bg-background", "border-b", "shadow-xs");
    expect(header).toHaveClass("dark:bg-header", "dark:shadow-none");
    expect(screen.getByRole("heading", { name: "Tracing" })).toHaveClass(
      "text-primary",
      "text-lg",
      "dark:tracking-heading",
    );
  });

  it("keeps the page-header chrome divider full-width on container pages", () => {
    render(
      <SidebarPresenceProvider>
        <SidebarProvider>
          <PageHeader title="Settings" container />
        </SidebarProvider>
      </SidebarPresenceProvider>,
    );

    const row = screen.getByTestId(APP_SHELL_CHROME_ROW_TEST_ID);
    expect(row.className).toContain("border-b");
    expect(row.className).not.toContain("lg:mx-auto");
    expect(row.className).not.toContain("max-w-screen");

    const inner = row.firstElementChild;
    expect(inner).toBeInstanceOf(HTMLElement);
    expect((inner as HTMLElement).className).toContain("lg:mx-auto");
  });
});
