import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { Role } from "@langfuse/shared";
import {
  ROUTES,
  ROUTE_GROUP_ORDER,
  RouteGroup,
  RouteSection,
  type Route,
} from "@/src/components/layouts/routes";
import { applyNavigationFilters } from "@/src/components/layouts/app-layout/utils/navigationFilters";

const PROJECT = "proj-nav";
const ORG = "org-nav";

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

function visibleTitles(role: Role): string[] {
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
  const flat = (rs: Route[]): string[] =>
    rs.flatMap((r) => [r.title, ...flat(r.items ?? [])]);
  return flat(routes).sort();
}

// Content surfaces: none may appear for a role without content access.
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

// Pinned. A change to routes.tsx or to a role's scopes that alters what a
// content-free role sees must update this list on purpose.
const EXPECTED: Record<"SECURITY" | "ANALYST" | "AUDITOR", string[]> = {
  // CHG-2026-073: the gateway logs moved to Security > Logs, so Security
  // Analyst no longer sees the LLM Gateway page (it held only the logs).
  // CHG-2026-133: the EYEON Guardrail decisions page (projectGuardrails:read);
  // its entry renders nothing while CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED
  // is off.
  // CHG-2026-138: the EYEON Enforcement and policy page (projectGuardrails:read).
  SECURITY: [
    "Contact ACME Support",
    "Enforcement & policy",
    "Go to...",
    "Guardrail decisions",
    "Guardrails",
    "Logs",
    "Projects",
    "Settings",
    "Settings",
    "Support",
    "UI Customization",
  ],
  ANALYST: [
    "Contact ACME Support",
    "Dashboards",
    "Go to...",
    "Home",
    "LLM Gateway",
    "Projects",
    "Settings",
    "Settings",
    "Support",
    "UI Customization",
  ],
  // CHG-2026-122: Applications (evidence:read; the list had not caught up).
  // CHG-2026-132: the EYEON overview, under the same scopes; its entry still
  // renders nothing while CAIRO_EYEON_OVERVIEW_ENABLED is off.
  // CHG-2026-133: the EYEON Guardrail decisions page (projectGuardrails:read).
  // CHG-2026-138: the EYEON Enforcement and policy page, under the same scope.
  // CHG-2026-139: the EYEON Gateway health page (evidence:read); its entry
  // renders nothing while CAIRO_EYEON_GATEWAY_HEALTH_ENABLED is off.
  AUDITOR: [
    "Applications",
    "Contact ACME Support",
    "Enforcement & policy",
    "Gateway health",
    "Go to...",
    "Guardrail decisions",
    "Guardrails",
    "LLM Gateway",
    "Logs",
    "Overview",
    "Projects",
    "Prompt Approvals",
    "Prompt Reviews",
    "Prompts",
    "Settings",
    "Settings",
    "Support",
    "UI Customization",
  ],
};

describe("sidebar per role (ADR-0011 §6)", () => {
  it.each([Role.SECURITY, Role.ANALYST, Role.AUDITOR] as const)(
    "%s sees exactly its pinned items",
    (role) => {
      expect(visibleTitles(role)).toEqual(
        EXPECTED[role as keyof typeof EXPECTED],
      );
    },
  );

  it.each([Role.SECURITY, Role.ANALYST, Role.AUDITOR])(
    "%s sees no trace, session or prompt-content surface",
    (role) => {
      const visible = visibleTitles(role);
      for (const title of CONTENT_ROUTES) expect(visible).not.toContain(title);
    },
  );

  it("control: a Prompt Analyst (MEMBER) does see Tracing", () => {
    expect(visibleTitles(Role.MEMBER)).toContain("Tracing");
  });
});

describe("sidebar sections (CHG-2026-073, CHG-2026-081)", () => {
  const groupsOf = (title: string) =>
    ROUTES.filter((r) => r.title === title).map((r) => r.group);

  it("sections appear in the owner's order", () => {
    expect(ROUTE_GROUP_ORDER).toEqual([
      "Governance Controls",
      "Observability",
      "Evaluation",
      "Prompt Management",
      "Reports / Logs",
      "Settings",
      "Support",
    ]);
  });

  it("every section has a place in the order", () => {
    expect([...ROUTE_GROUP_ORDER].sort()).toEqual(
      Object.values(RouteGroup).sort(),
    );
  });

  it("each route sits in its section", () => {
    expect(groupsOf("Overview")).toEqual(["Governance Controls"]);
    expect(groupsOf("Guardrail decisions")).toEqual(["Governance Controls"]);
    expect(groupsOf("Guardrails")).toEqual(["Governance Controls"]);
    expect(groupsOf("LLM Gateway")).toEqual(["Governance Controls"]);
    // CHG-2026-083: the Assurance (Preview) demo is gone.
    expect(groupsOf("Assurance (Preview)")).toEqual([]);
    expect(groupsOf("Logs")).toEqual(["Reports / Logs"]);
    // Project and organization settings: one or the other shows, by context.
    expect(groupsOf("Settings")).toEqual(["Settings", "Settings"]);
    expect(groupsOf("UI Customization")).toEqual(["Settings"]);
    expect(groupsOf("Support")).toEqual(["Support"]);
    expect(groupsOf("Contact ACME Support")).toEqual(["Support"]);
    expect(groupsOf("Audit Logs")).toEqual([]);
  });

  it("the EYEON overview is first under Governance Controls (CHG-2026-132)", () => {
    const governance = ROUTES.filter(
      (r) => r.group === RouteGroup.GovernanceControls,
    ).map((r) => r.title);
    expect(governance[0]).toBe("Overview");
  });

  it("the EYEON Guardrail decisions page comes right after the overview (CHG-2026-133)", () => {
    const governance = ROUTES.filter(
      (r) => r.group === RouteGroup.GovernanceControls,
    ).map((r) => r.title);
    expect(governance.slice(0, 2)).toEqual(["Overview", "Guardrail decisions"]);
    const entry = ROUTES.find((r) => r.title === "Guardrail decisions");
    expect(entry?.projectRbacScopes).toEqual(["projectGuardrails:read"]);
    expect(entry?.menuNode).toBeDefined();
  });

  it.each([Role.OWNER, Role.ADMIN])(
    "%s sees the Guardrail decisions entry; Business and Prompt Analysts do not (CHG-2026-133)",
    (role) => {
      expect(visibleTitles(role)).toContain("Guardrail decisions");
      expect(visibleTitles(Role.ANALYST)).not.toContain("Guardrail decisions");
      expect(visibleTitles(Role.MEMBER)).not.toContain("Guardrail decisions");
      expect(visibleTitles(Role.VIEWER)).not.toContain("Guardrail decisions");
    },
  );

  it("the EYEON Enforcement and policy page comes right after Guardrail decisions, before Guardrails (CHG-2026-138)", () => {
    const governance = ROUTES.filter(
      (r) => r.group === RouteGroup.GovernanceControls,
    ).map((r) => r.title);
    const at = governance.indexOf("Enforcement & policy");
    expect(at).toBe(governance.indexOf("Guardrail decisions") + 1);
    expect(governance[at + 1]).toBe("Guardrails");
    expect(groupsOf("Enforcement & policy")).toEqual(["Governance Controls"]);
    const entry = ROUTES.find((r) => r.title === "Enforcement & policy");
    expect(entry?.projectRbacScopes).toEqual(["projectGuardrails:read"]);
    expect(entry?.menuNode).toBeDefined();
  });

  it.each([Role.OWNER, Role.ADMIN])(
    "%s sees the Enforcement & policy entry; Business and Prompt Analysts and Viewers do not (CHG-2026-138)",
    (role) => {
      expect(visibleTitles(role)).toContain("Enforcement & policy");
      for (const other of [Role.ANALYST, Role.MEMBER, Role.VIEWER])
        expect(visibleTitles(other)).not.toContain("Enforcement & policy");
    },
  );

  it("the EYEON Gateway health page is first under Observability (CHG-2026-139)", () => {
    const observability = ROUTES.filter(
      (r) => r.group === RouteGroup.Observability,
    ).map((r) => r.title);
    expect(observability[0]).toBe("Gateway health");
    const entry = ROUTES.find((r) => r.title === "Gateway health");
    expect(entry?.projectRbacScopes).toEqual([
      "llmGateway:read",
      "evidence:read",
    ]);
    expect(entry?.menuNode).toBeDefined();
  });

  it.each([Role.OWNER, Role.ADMIN, Role.AUDITOR])(
    "%s sees the Gateway health entry; Security, Business and Prompt Analysts and Viewers do not (CHG-2026-139)",
    (role) => {
      expect(visibleTitles(role)).toContain("Gateway health");
      for (const other of [
        Role.SECURITY,
        Role.ANALYST,
        Role.MEMBER,
        Role.VIEWER,
      ]) {
        expect(visibleTitles(other)).not.toContain("Gateway health");
      }
    },
  );

  it("Settings and Support are no longer in the bottom (secondary) section", () => {
    for (const title of ["Settings", "Support"]) {
      for (const route of ROUTES.filter((r) => r.title === title)) {
        expect(route.section).toBe(RouteSection.Main);
      }
    }
  });
});
