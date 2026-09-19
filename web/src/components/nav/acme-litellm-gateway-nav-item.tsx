import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Waypoints } from "lucide-react";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { api } from "@/src/utils/api";

function useRouterProjectId(): string | undefined {
  const projectId = useRouter().query.projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

/**
 * Headless gate: passes its children through only while the server says LLM
 * Gateway management is switched on. The feature flag is server-only (no
 * NEXT_PUBLIC_ form, on purpose), so the client has to ask.
 */
function AcmeLitellmEnabledGate({ children }: { children: ReactNode }) {
  const projectId = useRouterProjectId();
  const status = api.acmeLitellm.status.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== undefined, staleTime: 60_000, retry: false },
  );
  return status.data?.enabled === true ? children : null;
}

function AcmeLitellmGatewayNavLink() {
  const router = useRouter();
  const projectId = useRouterProjectId();
  const href = `/project/${projectId ?? ""}/acme-enhancements/llm-gateway`;
  return (
    <SidebarMenuButton
      asChild
      tooltip="LLM Gateway"
      isActive={router.asPath.startsWith(href)}
    >
      <Link href={href}>
        <Waypoints />
        <span>LLM Gateway</span>
      </Link>
    </SidebarMenuButton>
  );
}

/**
 * ACME addition (ADR-0003): nav entry for the LLM Gateway page. Renders
 * nothing while CAIRO_LITELLM_MANAGEMENT_ENABLED is off, so an existing
 * deployment sees no change until an operator turns the feature on.
 */
export function AcmeLitellmGatewayNavItem() {
  return (
    <AcmeLitellmEnabledGate>
      <AcmeLitellmGatewayNavLink />
    </AcmeLitellmEnabledGate>
  );
}
