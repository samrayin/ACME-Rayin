import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Eye } from "lucide-react";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { api } from "@/src/utils/api";

function useRouterProjectId(): string | undefined {
  const projectId = useRouter().query.projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

/**
 * Headless gate: passes its children through only while the server says the
 * EYEON overview is switched on. The flag is server-only (no NEXT_PUBLIC_
 * form, on purpose), so the client has to ask, as for the LLM Gateway entry.
 */
function EyeonOverviewEnabledGate({ children }: { children: ReactNode }) {
  const projectId = useRouterProjectId();
  const status = api.eyeonOverview.status.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== undefined, staleTime: 60_000, retry: false },
  );
  return status.data?.enabled === true ? children : null;
}

function EyeonOverviewNavLink() {
  const router = useRouter();
  const projectId = useRouterProjectId();
  const href = `/project/${projectId ?? ""}/acme-enhancements/overview`;
  return (
    <SidebarMenuButton
      asChild
      tooltip="Overview"
      isActive={router.asPath.startsWith(href)}
    >
      <Link href={href}>
        <Eye />
        <span>Overview</span>
      </Link>
    </SidebarMenuButton>
  );
}

/**
 * ACME (CHG-2026-132, ADR-0027): nav entry for the EYEON overview. Renders
 * nothing while CAIRO_EYEON_OVERVIEW_ENABLED is off, so a deployment sees no
 * change until an operator turns the page on.
 */
export function EyeonOverviewNavItem() {
  return (
    <EyeonOverviewEnabledGate>
      <EyeonOverviewNavLink />
    </EyeonOverviewEnabledGate>
  );
}
