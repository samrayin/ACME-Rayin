import type { Session } from "next-auth";
import { Role } from "@langfuse/shared";
import {
  ROUTES,
  RouteGroup,
  RouteSection,
} from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { applyNavigationFilters } from "@/src/components/layouts/app-layout/utils/navigationFilters";
import { groupNavigationItems } from "@/src/components/layouts/app-layout/utils/groupNavigationItems";
import { isPathActive } from "@/src/components/layouts/app-layout/utils/pathClassification";
import {
  buildEyeonRailModel,
  eyeonRailCategoryOf,
  eyeonRailItemKey,
  type EyeonRailNavigation,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";

// CHG-2026-135 (ADR-0026 §12.2): the rail sorts the sidebar's own items, as
// routes.tsx defines them and the same navigation filters pass them for a
// role (the derivation acme-role-navigation.clienttest.tsx pins), into the
// prototype's categories. Nothing is added, nothing is lost, and a category
// shows only when the role can see one of its items.

const PROJECT = "proj-rail";
const ORG = "org-rail";

function sessionFor(role: Role): Session {
  return {
    expires: "1",
    user: {
      id: "u",
      admin: false,
      featureFlags: {},
      canToggleV4: false,
      organizations: [
        {
          id: ORG,
          name: "org",
          role,
          plan: "oss",
          projects: [{ id: PROJECT, name: "p", role, deletedAt: null }],
        },
      ],
    },
    environment: { enableExperimentalFeatures: false },
  } as unknown as Session;
}

/** The sidebar's main navigation for a role, as useFilteredNavigation builds it. */
function navigationFor(
  role: Role,
  currentPathname = "/project/[projectId]",
): EyeonRailNavigation {
  const session = sessionFor(role);
  const routes = applyNavigationFilters(
    ROUTES,
    {
      routerProjectId: PROJECT,
      routerOrganizationId: ORG,
      session,
      enableExperimentalFeatures: false,
      cloudAdmin: false,
      entitlements: [],
      uiCustomization: null,
      isLangfuseCloud: false,
      hasActiveCloudIncident: false,
      forceV3Experience: false,
      currentPath: `/project/${PROJECT}`,
    },
    session.user!.organizations[0],
  );
  const items: NavigationItem[] = routes
    .filter((route) => route.section === RouteSection.Main)
    .map((route) => ({
      ...route,
      url: route.pathname
        .replace("[projectId]", PROJECT)
        .replace("[organizationId]", ORG),
      isActive: isPathActive(route.pathname, currentPathname),
      items: undefined,
    }));
  return groupNavigationItems(items);
}

/** Every item whose own component decides at render time, shown or not. */
function presenceOf(navigation: EyeonRailNavigation, shown: boolean) {
  const { probes } = buildEyeonRailModel({
    navigation,
    presence: {},
    selected: undefined,
  });
  return Object.fromEntries(
    probes.map((item) => [eyeonRailItemKey(item), shown]),
  );
}

function railFor(role: Role, menuEntriesShown = true) {
  const navigation = navigationFor(role);
  return buildEyeonRailModel({
    navigation,
    presence: presenceOf(navigation, menuEntriesShown),
    selected: undefined,
  });
}

const categoriesOf = (role: Role, menuEntriesShown = true) =>
  railFor(role, menuEntriesShown).categories.map((category) => category.id);

const CONTENT_ROUTES = [
  "Tracing",
  "Sessions",
  "Users",
  "Playground",
  "Scores",
  "Evaluators",
  "Human Annotation",
  "Datasets",
  "Experiments",
];

describe("rail categories per role (CHG-2026-135)", () => {
  // The content-free roles' pinned sidebars, sorted into categories.
  it.each([
    [Role.SECURITY, ["governance", "logs", "settings", "support"]],
    // Dashboards sit under Reports (owner, 2026-10-07); Gateway health
    // (CHG-2026-139) under Observability, open to the Auditor.
    [Role.ANALYST, ["home", "governance", "reports", "settings", "support"]],
    [
      Role.AUDITOR,
      ["governance", "observability", "prompts", "logs", "settings", "support"],
    ],
    [
      Role.OWNER,
      [
        "home",
        "governance",
        "observability",
        "evaluation",
        "prompts",
        "reports",
        "logs",
        "settings",
        "support",
      ],
    ],
  ])("%s sees exactly these categories", (role, expected) => {
    expect(categoriesOf(role)).toEqual(expected);
  });

  it.each([
    Role.OWNER,
    Role.ADMIN,
    Role.MEMBER,
    Role.VIEWER,
    Role.SECURITY,
    Role.ANALYST,
    Role.AUDITOR,
  ])(
    "%s: every sidebar item is in one category or above every list, none added",
    (role) => {
      const navigation = navigationFor(role);
      const rail = railFor(role);
      const placed = [
        ...rail.sidebarNavigation.ungrouped,
        ...rail.categories.flatMap((category) => category.items),
      ].map(eyeonRailItemKey);
      expect([...placed].sort()).toEqual(
        navigation.flattened.map(eyeonRailItemKey).sort(),
      );
    },
  );

  it.each([Role.SECURITY, Role.ANALYST, Role.AUDITOR])(
    "%s: no content surface appears in any category",
    (role) => {
      const titles = railFor(role).categories.flatMap((category) =>
        category.items.map((item) => item.title),
      );
      for (const title of CONTENT_ROUTES) expect(titles).not.toContain(title);
    },
  );

  it("a category whose only entries render nothing stays hidden", () => {
    // Every entry that decides for itself renders nothing (the EYEON pages
    // and LLM Gateway behind their flags, and, for this test, Support too).
    // The Business Analyst's Governance Controls entries are LLM Gateway and
    // Spend (CHG-2026-143), both behind flags, so the category goes; Support
    // holds only such entries, so it goes too. Dashboards is a plain link, so
    // Reports stays.
    expect(categoriesOf(Role.ANALYST, false)).toEqual([
      "home",
      "reports",
      "settings",
    ]);
    // Guardrails is a plain link, so the Security Analyst keeps the category.
    expect(categoriesOf(Role.SECURITY, false)).toContain("governance");

    // Only LLM Gateway and Spend switched off: Support stays, Governance
    // Controls goes.
    const navigation = navigationFor(Role.ANALYST);
    const presence = {
      ...presenceOf(navigation, true),
      [eyeonRailItemKey({
        title: "LLM Gateway",
        pathname: "/project/[projectId]/acme-enhancements/llm-gateway",
      })]: false,
      [eyeonRailItemKey({
        title: "Spend",
        pathname: "/project/[projectId]/acme-enhancements/spend",
      })]: false,
    };
    expect(
      buildEyeonRailModel({
        navigation,
        presence,
        selected: undefined,
      }).categories.map((category) => category.id),
    ).toEqual(["home", "reports", "settings", "support"]);
  });

  it("Reports and Logs are separate: Reports holds Dashboards, Logs holds Logs", () => {
    const owner = railFor(Role.OWNER);
    const logs = owner.categories.find((category) => category.id === "logs");
    expect(logs?.items.map((item) => item.title)).toEqual(["Logs"]);
    const reports = owner.categories.find((c) => c.id === "reports");
    expect(reports?.items.map((item) => item.title)).toEqual(["Dashboards"]);
    const home = owner.categories.find((c) => c.id === "home");
    expect(home?.items.map((item) => item.title)).toEqual(["Home"]);
  });
});

describe("placing items (CHG-2026-135)", () => {
  it("places Home alone, Dashboards under Reports and gateway health under Observability", () => {
    expect(
      eyeonRailCategoryOf({
        pathname: "/project/[projectId]",
        group: undefined,
      }),
    ).toBe("home");
    expect(
      eyeonRailCategoryOf({
        pathname: "/project/[projectId]/dashboards",
        group: undefined,
      }),
    ).toBe("reports");
    expect(
      eyeonRailCategoryOf({
        pathname: "/project/[projectId]/acme-enhancements/gateway-health",
        group: RouteGroup.GovernanceControls,
      }),
    ).toBe("observability");
  });

  it("a route added later lands in its group's category", () => {
    expect(
      eyeonRailCategoryOf({
        pathname: "/project/[projectId]/acme-enhancements/new-dashboard",
        group: RouteGroup.GovernanceControls,
      }),
    ).toBe("governance");
    expect(
      eyeonRailCategoryOf({
        pathname: "/project/[projectId]/new-evaluation-page",
        group: RouteGroup.Evaluation,
      }),
    ).toBe("evaluation");
    expect(
      eyeonRailCategoryOf({
        pathname: "/project/[projectId]/acme-enhancements/new-log",
        group: RouteGroup.ReportsLogs,
      }),
    ).toBe("logs");
  });

  it("keeps ungrouped entries such as Go to... and Projects above every list", () => {
    const owner = railFor(Role.OWNER);
    expect(owner.sidebarNavigation.ungrouped.map((item) => item.title)).toEqual(
      ["Go to...", "Projects"],
    );
  });
});

describe("the active category (CHG-2026-135)", () => {
  function railAt(pathname: string, selected?: "evaluation" | "reports") {
    const navigation = navigationFor(Role.OWNER, pathname);
    return buildEyeonRailModel({
      navigation,
      presence: presenceOf(navigation, true),
      selected,
    });
  }

  it("is the category of the page on screen, and the sidebar lists it", () => {
    const rail = railAt("/project/[projectId]/traces/[traceId]");
    expect(rail.activeId).toBe("observability");
    expect(Object.keys(rail.sidebarNavigation.grouped ?? {})).toEqual([
      "Observability",
    ]);
    expect(
      rail.sidebarNavigation.grouped?.[RouteGroup.Observability]?.map(
        (item) => item.title,
      ),
    ).toEqual(["Gateway health", "Tracing", "Sessions", "Users"]);
  });

  it("is the chosen category while the person stays on the page", () => {
    const rail = railAt("/project/[projectId]/traces", "evaluation");
    expect(rail.activeId).toBe("evaluation");
    const evaluation = rail.categories.find((c) => c.id === "evaluation");
    expect(evaluation?.containsCurrentPage).toBe(false);
  });

  it("ignores a chosen category the person cannot see", () => {
    // The Security Analyst has no Evaluation category.
    const navigation = navigationFor(
      Role.SECURITY,
      "/project/[projectId]/acme-enhancements/guardrails",
    );
    const rail = buildEyeonRailModel({
      navigation,
      presence: presenceOf(navigation, true),
      selected: "evaluation",
    });
    expect(rail.activeId).toBe("governance");
  });

  it("goes to each category's first page, except the page's own category", () => {
    const rail = railAt("/project/[projectId]/traces");
    const observability = rail.categories.find((c) => c.id === "observability");
    expect(observability?.containsCurrentPage).toBe(true);
    expect(observability?.href).toBeUndefined();
    const evaluation = rail.categories.find((c) => c.id === "evaluation");
    expect(evaluation?.href).toBe(evaluation?.items[0]?.url);
    expect(evaluation?.href).toBeDefined();
  });

  it("never sends a category to an entry that renders nothing", () => {
    const navigation = navigationFor(Role.OWNER, "/project/[projectId]/traces");
    const rail = buildEyeonRailModel({
      navigation,
      presence: presenceOf(navigation, false),
      selected: undefined,
    });
    for (const category of rail.categories) {
      const target = category.items.find((item) => item.url === category.href);
      if (category.href) expect(target?.menuNode).toBeUndefined();
    }
  });

  it("falls back to Home, which goes to the project home", () => {
    const rail = railAt("/project/[projectId]/some-unlisted-page");
    expect(rail.activeId).toBe("home");
    expect(rail.categories[0]).toMatchObject({
      id: "home",
      href: `/project/${PROJECT}`,
    });
  });
});
