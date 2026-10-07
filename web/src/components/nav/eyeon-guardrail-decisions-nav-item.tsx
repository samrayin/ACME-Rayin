import { type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ShieldCheck } from "lucide-react";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { api } from "@/src/utils/api";

function useRouterProjectId(): string | undefined {
  const projectId = useRouter().query.projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

/**
 * Headless gate: passes its children through only while the server says the
 * EYEON Guardrail decisions page is switched on. The flag is server-only (no
 * NEXT_PUBLIC_ form, on purpose), so the client has to ask, as for the
 * overview's entry.
 */
function EyeonGuardrailDecisionsEnabledGate({
  children,
}: {
  children: ReactNode;
}) {
  const projectId = useRouterProjectId();
  const status = api.eyeonGuardrailDecisions.status.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== undefined, staleTime: 60_000, retry: false },
  );
  return status.data?.enabled === true ? children : null;
}

function EyeonGuardrailDecisionsNavLink() {
  const router = useRouter();
  const projectId = useRouterProjectId();
  const href = `/project/${projectId ?? ""}/acme-enhancements/guardrail-decisions`;
  return (
    <SidebarMenuButton
      asChild
      tooltip="Guardrail decisions"
      isActive={router.asPath.startsWith(href)}
    >
      <Link href={href}>
        <ShieldCheck />
        <span>Guardrail decisions</span>
      </Link>
    </SidebarMenuButton>
  );
}

/**
 * ACME (CHG-2026-133, ADR-0027): nav entry for the EYEON Guardrail decisions
 * page. Renders nothing while CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED is off,
 * so a deployment sees no change until an operator turns the page on.
 */
export function EyeonGuardrailDecisionsNavItem() {
  return (
    <EyeonGuardrailDecisionsEnabledGate>
      <EyeonGuardrailDecisionsNavLink />
    </EyeonGuardrailDecisionsEnabledGate>
  );
}
