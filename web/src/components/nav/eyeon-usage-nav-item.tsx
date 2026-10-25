import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Users } from "lucide-react";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { api } from "@/src/utils/api";

function useRouterProjectId(): string | undefined {
  const projectId = useRouter().query.projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

/**
 * Headless gate: passes its children through only while the server says the
 * EYEON Usage drill-down page is switched on. The flag is server-only, so the
 * client has to ask, as for the other EYEON entries.
 */
function EyeonUsageEnabledGate({ children }: { children: ReactNode }) {
  const projectId = useRouterProjectId();
  const status = api.eyeonUsageDrilldown.status.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== undefined, staleTime: 60_000, retry: false },
  );
  return status.data?.enabled === true ? children : null;
}

function EyeonUsageNavLink() {
  const router = useRouter();
  const projectId = useRouterProjectId();
  const href = `/project/${projectId ?? ""}/acme-enhancements/usage`;
  return (
    <SidebarMenuButton
      asChild
      tooltip="Usage"
      isActive={router.asPath.startsWith(href)}
    >
      <Link href={href}>
        <Users />
        <span>Usage</span>
      </Link>
    </SidebarMenuButton>
  );
}

/**
 * ACME (ADR-0027): nav entry for the EYEON Usage drill-down page. Renders
 * nothing while CAIRO_EYEON_USAGE_ENABLED is off.
 */
export function EyeonUsageNavItem() {
  return (
    <EyeonUsageEnabledGate>
      <EyeonUsageNavLink />
    </EyeonUsageEnabledGate>
  );
}
