import { type Flag } from "@/src/features/feature-flags/types";
import { type ProjectScope } from "@langfuse/shared";
import {
  BellRing,
  Database,
  LayoutDashboard,
  LifeBuoy,
  ListTree,
  type LucideIcon,
  Settings,
  UsersIcon,
  TerminalIcon,
  Lightbulb,
  Grid2X2,
  Sparkle,
  FileJson,
  Search,
  Home,
  SquarePercent,
  ClipboardPen,
  Clock,
  Beaker,
  ShieldCheck,
  ShieldAlert,
  Palette,
  Gauge,
  CalendarClock,
  CheckCircle2,
} from "lucide-react";
import { type ReactNode } from "react";
import { type Entitlement } from "@/src/features/entitlements/constants/entitlements";
import { type Session } from "next-auth";
import { type OrganizationScope } from "@/src/features/rbac/constants/organizationAccessRights";
import { SupportButton } from "@/src/components/nav/support-button";
import { V4MigrationNavItem } from "@/src/features/v4-migration/V4MigrationNavItem";
import { V4SidebarToggle } from "@/src/features/events/components/V4SidebarToggle";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { KeyboardShortcut } from "@/src/components/design-system/KeyboardShortcut/KeyboardShortcut";
import { useCommandMenu } from "@/src/features/command-k-menu/CommandMenuProvider";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";
import { CloudStatusMenu } from "@/src/features/cloud-status-notification/components/CloudStatusMenu";
import { AcmeContactSupportNavItem } from "@/src/components/nav/acme-contact-support-nav-item";
import { AcmeLitellmGatewayNavItem } from "@/src/components/nav/acme-litellm-gateway-nav-item";
import { type ProductModule } from "@/src/ee/features/ui-customization/productModuleSchema";

export enum RouteSection {
  Main = "main",
  Secondary = "secondary",
}

export enum RouteGroup {
  Observability = "Observability",
  PromptManagement = "Prompt Management",
  Evaluation = "Evaluation",
  AcmeEnhancements = "ACME Enhancements",
}

export type Route = {
  title: string;
  menuNode?: ReactNode;
  featureFlag?: Flag;
  label?: string | ReactNode;
  projectRbacScopes?: ProjectScope[]; // array treated as OR
  organizationRbacScope?: OrganizationScope;
  icon?: LucideIcon; // ignored for nested routes
  pathname: string; // link
  legacyPathname?: string; // link used when the V4 preview is disabled
  items?: Array<Route>; // folder
  section?: RouteSection; // which section of the sidebar (top/main/bottom)
  newTab?: boolean; // open in new tab
  entitlements?: Entitlement[]; // entitlements required, array treated as OR
  productModule?: ProductModule; // Product module this route belongs to. Used to show/hide modules via ui customization.
  show?: (p: {
    organization:
      | NonNullable<Session["user"]>["organizations"][number]
      | undefined;
    projectId: string | undefined;
    isLangfuseCloud: boolean;
    hasActiveCloudIncident: boolean;
    canToggleV4: boolean;
    forceV3Experience: boolean;
    v4WriteMode: undefined | "legacy" | "dual" | "events_only"; // undefined until the session has loaded
    v4UpgradeUiAvailable: boolean; // deployment shows the v4 migration UI (see isV4UpgradeUiAvailable)
  }) => boolean;
  group?: RouteGroup; // group this route belongs to (within a section)
};

export const ROUTES: Route[] = [
  {
    title: "Go to...",
    pathname: "", // Empty pathname since this is a dropdown
    icon: Search,
    menuNode: <CommandMenuTrigger />,
    section: RouteSection.Main,
  },
  {
    title: "Organizations",
    pathname: "/",
    icon: Grid2X2,
    show: ({ organization }) => organization === undefined,
    section: RouteSection.Main,
  },
  {
    title: "Projects",
    pathname: "/organization/[organizationId]",
    icon: Grid2X2,
    section: RouteSection.Main,
  },
  {
    title: "Home",
    projectRbacScopes: ["projectData:read"],
    pathname: `/project/[projectId]`,
    icon: Home,
    section: RouteSection.Main,
  },
  {
    title: "Dashboards",
    projectRbacScopes: ["projectData:read"],
    pathname: `/project/[projectId]/dashboards`,
    icon: LayoutDashboard,
    productModule: "dashboards",
    section: RouteSection.Main,
  },
  {
    // ACME addition: policy enforcement (PII redaction, jailbreak/topical
    // rails) via rayin-guardrails (github.com/samrayin/rayin-guardrails) —
    // a separate service, not code in this repo. Standalone top-level
    // feature, not nested under ACME Enhancements, since it's a runtime
    // security control rather than a console customization. See
    // acmeGuardrailsRouter.ts for why this dashboard is only ever as
    // durable as that service's own in-memory buffer.
    title: "Guardrails",
    pathname: `/project/[projectId]/acme-enhancements/guardrails`,
    icon: ShieldAlert,
    projectRbacScopes: ["projectGuardrails:read"],
    section: RouteSection.Main,
  },
  {
    // ACME addition (ADR-0003, CHG-2026-005): CAIRO as the only control plane
    // for the LiteLLM gateway. Top-level, next to Guardrails: a runtime
    // control, not a console customization. menuNode, not a plain link: the
    // feature flag is server-only, so the item asks the server and renders
    // nothing while CAIRO_LITELLM_MANAGEMENT_ENABLED is off.
    title: "LLM Gateway",
    pathname: `/project/[projectId]/acme-enhancements/llm-gateway`,
    projectRbacScopes: ["llmGateway:read", "llmGatewayLogs:read"],
    section: RouteSection.Main,
    menuNode: <AcmeLitellmGatewayNavItem />,
  },
  {
    // ACME PREVIEW — a deliberately thin demo (acmeAssuranceDemoRouter.ts),
    // not the production Asset Inventory / Assurance features it's meant to
    // validate the concept for. Remove this nav entry (and the demo page)
    // once those real features ship, rather than let a demo linger as if
    // it were the shipped thing.
    title: "Assurance (Preview)",
    pathname: `/project/[projectId]/acme-enhancements/assurance-demo`,
    icon: Gauge,
    projectRbacScopes: ["projectGuardrails:read"],
    section: RouteSection.Main,
  },
  {
    title: "Tracing",
    projectRbacScopes: ["projectData:read"],
    icon: ListTree,
    productModule: "tracing",
    group: RouteGroup.Observability,
    section: RouteSection.Main,
    pathname: `/project/[projectId]/traces`,
  },
  {
    title: "Sessions",
    projectRbacScopes: ["projectData:read"],
    icon: Clock,
    productModule: "tracing",
    group: RouteGroup.Observability,
    section: RouteSection.Main,
    pathname: `/project/[projectId]/sessions`,
  },
  {
    title: "Users",
    projectRbacScopes: ["projectData:read"],
    pathname: `/project/[projectId]/users`,
    icon: UsersIcon,
    productModule: "tracing",
    group: RouteGroup.Observability,
    section: RouteSection.Main,
  },
  {
    title: "Alerts",
    pathname: "/project/[projectId]/alerts",
    icon: BellRing,
    projectRbacScopes: ["alerts:read"],
    show: ({ v4WriteMode }) => Boolean(v4WriteMode) && v4WriteMode !== "legacy",
    group: RouteGroup.Observability,
    section: RouteSection.Main,
  },
  {
    title: "Prompts",
    pathname: "/project/[projectId]/prompts",
    icon: FileJson,
    projectRbacScopes: ["prompts:read"],
    productModule: "prompt-management",
    group: RouteGroup.PromptManagement,
    section: RouteSection.Main,
  },
  {
    title: "Playground",
    projectRbacScopes: ["projectData:read"],
    pathname: "/project/[projectId]/playground",
    icon: TerminalIcon,
    productModule: "playground",
    group: RouteGroup.PromptManagement,
    section: RouteSection.Main,
  },
  {
    // ACME addition: review-date management for prompts (Prompt.config.
    // reviewDate, no migration). Gated on the existing prompts:read scope
    // rather than a new one -- see acmePromptReviewRouter.ts.
    title: "Prompt Reviews",
    pathname: `/project/[projectId]/acme-enhancements/prompt-reviews`,
    icon: CalendarClock,
    projectRbacScopes: ["prompts:read"],
    group: RouteGroup.PromptManagement,
    section: RouteSection.Main,
  },
  {
    // ACME addition: request/approve/reject trail for pushing a prompt
    // version to a label -- see acmePromptApprovalRouter.ts.
    title: "Prompt Approvals",
    pathname: `/project/[projectId]/acme-enhancements/prompt-approvals`,
    icon: CheckCircle2,
    projectRbacScopes: ["prompts:read"],
    group: RouteGroup.PromptManagement,
    section: RouteSection.Main,
  },
  {
    title: "Scores",
    projectRbacScopes: ["projectData:read"],
    pathname: `/project/[projectId]/scores`,
    group: RouteGroup.Evaluation,
    section: RouteSection.Main,
    icon: SquarePercent,
  },
  {
    title: "Evaluators",
    icon: Lightbulb,
    productModule: "evaluation",
    projectRbacScopes: ["evaluator:read", "evaluationRule:read"],
    group: RouteGroup.Evaluation,
    section: RouteSection.Main,
    pathname: `/project/[projectId]/evals`,
    legacyPathname: `/project/[projectId]/evals/legacy`,
  },
  {
    title: "Human Annotation",
    pathname: `/project/[projectId]/annotation-queues`,
    projectRbacScopes: ["annotationQueues:read"],
    group: RouteGroup.Evaluation,
    section: RouteSection.Main,
    icon: ClipboardPen,
  },
  {
    title: "Datasets",
    pathname: `/project/[projectId]/datasets`,
    icon: Database,
    productModule: "datasets",
    projectRbacScopes: ["datasets:read"],
    group: RouteGroup.Evaluation,
    section: RouteSection.Main,
  },
  {
    title: "Experiments",
    projectRbacScopes: ["projectData:read"],
    pathname: `/project/[projectId]/experiments`,
    icon: Beaker,
    featureFlag: "experimentsV4Enabled",
    group: RouteGroup.Evaluation,
    section: RouteSection.Main,
  },
  {
    // ACME addition: read-only audit log viewer, no Enterprise entitlement
    // required — see acmeAuditLogsRouter.ts for why this is a separate
    // route/router rather than reusing Langfuse's own (EE-licensed,
    // entitlement-gated) audit log viewer.
    title: "Audit Logs",
    pathname: `/project/[projectId]/acme-enhancements/audit-logs`,
    icon: ShieldCheck,
    projectRbacScopes: ["projectAuditLogs:read"],
    group: RouteGroup.AcmeEnhancements,
    section: RouteSection.Main,
  },
  {
    // ACME addition: direct support contact, relocated here from the
    // generic Support drawer (see IntroSection.tsx) so it's a first-class
    // ACME Enhancements item rather than buried behind the Support button.
    title: "Contact ACME Support",
    pathname: "",
    group: RouteGroup.AcmeEnhancements,
    section: RouteSection.Main,
    menuNode: <AcmeContactSupportNavItem />,
  },
  {
    // ACME addition: lets an owner/admin pick accent color + top-bar
    // background from a fixed preset list, applied live for the whole
    // project (see acmeThemeRouter.ts). Nav item itself is owner/admin-only
    // (project:update) even though the applied theme is visible to everyone.
    title: "UI Customization",
    pathname: `/project/[projectId]/acme-enhancements/ui-customization`,
    icon: Palette,
    projectRbacScopes: ["project:update"],
    group: RouteGroup.AcmeEnhancements,
    section: RouteSection.Main,
  },
  {
    // Keep Action required first in the secondary nav so it is not sandwiched
    // between regular items like Upgrade Plan and Settings.
    title: "Update",
    pathname: "",
    section: RouteSection.Secondary,
    show: ({ projectId, v4UpgradeUiAvailable }) =>
      v4UpgradeUiAvailable && projectId !== undefined,
    menuNode: <V4MigrationNavItem />,
  },
  {
    title: "Cloud Status",
    section: RouteSection.Secondary,
    pathname: "",
    show: ({ isLangfuseCloud, hasActiveCloudIncident }) =>
      isLangfuseCloud && hasActiveCloudIncident,
    menuNode: <CloudStatusMenu />,
  },
  {
    title: "V4 Preview",
    pathname: "",
    section: RouteSection.Secondary,
    featureFlag: "v4BetaToggleVisible",
    // v4-upgrade users get this toggle inside the migration panel instead.
    show: ({ canToggleV4, forceV3Experience, v4UpgradeUiAvailable }) =>
      canToggleV4 && (!v4UpgradeUiAvailable || forceV3Experience),
    menuNode: <V4SidebarToggle />,
  },
  {
    title: "Upgrade",
    icon: Sparkle,
    pathname: "/project/[projectId]/settings/billing",
    section: RouteSection.Secondary,
    entitlements: ["cloud-billing"],
    organizationRbacScope: "langfuseCloudBilling:CRUD",
    show: ({ organization }) => organization?.plan === "cloud:hobby",
  },
  {
    title: "Upgrade",
    icon: Sparkle,
    pathname: "/organization/[organizationId]/settings/billing",
    section: RouteSection.Secondary,
    entitlements: ["cloud-billing"],
    organizationRbacScope: "langfuseCloudBilling:CRUD",
    show: ({ organization }) => organization?.plan === "cloud:hobby",
  },
  {
    title: "Settings",
    pathname: "/project/[projectId]/settings",
    icon: Settings,
    section: RouteSection.Secondary,
  },
  {
    title: "Settings",
    pathname: "/organization/[organizationId]/settings",
    icon: Settings,
    section: RouteSection.Secondary,
  },
  // ACME: upstream's "Book a call" entry (a Langfuse sales link) is removed;
  // CAIRO support goes through "Contact ACME Support".
  {
    title: "Support",
    icon: LifeBuoy,
    section: RouteSection.Secondary,
    pathname: "", // Empty pathname since this is a dropdown
    menuNode: <SupportButton />,
  },
];

function CommandMenuTrigger() {
  const { setOpen } = useCommandMenu();
  const capture = usePostHogClientCapture();

  return (
    <SidebarMenuButton
      onClick={() => {
        capture("cmd_k_menu:opened", {
          source: "main_navigation",
        });
        setOpen(true);
      }}
      className="whitespace-nowrap"
    >
      <Search className="h-4 w-4" />
      Go to...
      <span className="ml-auto hidden md:inline-flex">
        <KeyboardShortcut keys={["Mod", "K"]} />
      </span>
    </SidebarMenuButton>
  );
}
