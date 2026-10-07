import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Scale } from "lucide-react";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { api } from "@/src/utils/api";

function useRouterProjectId(): string | undefined {
  const projectId = useRouter().query.projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

/**
 * Headless gate: passes its children through only while the server says the
 * EYEON Enforcement and policy page is switched on. The flag is server-only
 * (no NEXT_PUBLIC_ form, on purpose), so the client has to ask, as for the
 * other EYEON entries.
 */
function EyeonEnforcementEnabledGate({ children }: { children: ReactNode }) {
  const projectId = useRouterProjectId();
  const status = api.eyeonEnforcement.status.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== undefined, staleTime: 60_000, retry: false },
  );
  return status.data?.enabled === true ? children : null;
}

function EyeonEnforcementNavLink() {
  const router = useRouter();
  const projectId = useRouterProjectId();
  const href = `/project/${projectId ?? ""}/acme-enhancements/enforcement`;
  return (
    <SidebarMenuButton
      asChild
      tooltip="Enforcement & policy"
      isActive={router.asPath.startsWith(href)}
    >
      <Link href={href}>
        <Scale />
        <span>Enforcement &amp; policy</span>
      </Link>
    </SidebarMenuButton>
  );
}

/**
 * ACME (CHG-2026-138, ADR-0027): nav entry for the EYEON Enforcement and
 * policy page. Renders nothing while CAIRO_EYEON_ENFORCEMENT_ENABLED is off,
 * so a deployment sees no change until an operator turns the page on.
 */
export function EyeonEnforcementNavItem() {
  return (
    <EyeonEnforcementEnabledGate>
      <EyeonEnforcementNavLink />
    </EyeonEnforcementEnabledGate>
  );
}
