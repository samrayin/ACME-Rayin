import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { Role } from "@langfuse/shared";
import { ROUTES, type Route } from "@/src/components/layouts/routes";
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
  SECURITY: [
    "Assurance (Preview)",
    "Audit Logs",
    "Contact ACME Support",
    "Go to...",
    "Guardrails",
    "LLM Gateway",
    "Projects",
    "Settings",
    "Settings",
    "Support",
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
  ],
  AUDITOR: [
    "Assurance (Preview)",
    "Audit Logs",
    "Contact ACME Support",
    "Go to...",
    "Guardrails",
    "LLM Gateway",
    "Projects",
    "Prompt Approvals",
    "Prompt Reviews",
    "Prompts",
    "Settings",
    "Settings",
    "Support",
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
