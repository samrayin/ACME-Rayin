import { useEffect } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import Page from "@/src/components/layouts/page";
import { NoDataOrLoading } from "@/src/components/NoDataOrLoading";
import ProjectHomePage from "@/src/features/dashboard/ProjectHomePage";
import EyeonCommandCentrePage from "@/src/features/acme-enhancements/pages/EyeonCommandCentrePage";
import { projectHomeLanding } from "@/src/features/acme-enhancements/utils/eyeonHomeLanding";
import { useLandsOnGuardrails } from "@/src/features/rbac/hooks/useIsSecurityAnalyst";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { api } from "@/src/utils/api";

// ACME (CHG-2026-136, ADR-0028): the project home. With
// CAIRO_EYEON_HOME_ENABLED and CAIRO_EYEON_OVERVIEW_ENABLED on, a role that
// can open the EYEON overview gets EYEON Home: since CHG-2026-147 (ADR-0030)
// the command centre rather than the overview itself. Every other role, and every
// role while the flag is off, keeps the classic Home (ProjectHomePage,
// unchanged). The Security Analyst and the Auditor are sent to the page they
// can use before any Home renders: the Guardrail decisions page while its
// flag is on, otherwise the Guardrails page as before
// (utils/eyeonHomeLanding.ts). The flags are server-only, so this asks the
// server, as the navigation entries do; nothing else is fetched here.

export default function EyeonProjectHome() {
  const router = useRouter();
  const projectId =
    typeof router.query.projectId === "string"
      ? router.query.projectId
      : undefined;
  const session = useSession();
  const landsOnGuardrails = useLandsOnGuardrails(projectId);
  const hasGatewayRead = useHasProjectAccess({
    projectId,
    scope: "llmGateway:read",
  });
  const hasEvidenceRead = useHasProjectAccess({
    projectId,
    scope: "evidence:read",
  });
  const canOpenOverview = hasGatewayRead || hasEvidenceRead;

  const decisionsStatus = api.eyeonGuardrailDecisions.status.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: projectId !== undefined && landsOnGuardrails,
      staleTime: 60_000,
      retry: false,
    },
  );
  const homeStatus = api.eyeonOverview.homeStatus.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: projectId !== undefined && !landsOnGuardrails && canOpenOverview,
      staleTime: 60_000,
      retry: false,
    },
  );

  const landing = projectHomeLanding({
    projectId,
    sessionLoading: session.status === "loading",
    landsOnGuardrails,
    guardrailDecisionsOn: decisionsStatus.isError
      ? false
      : decisionsStatus.data?.enabled,
    canOpenOverview,
    eyeonHomeOn: homeStatus.isError ? false : homeStatus.data?.enabled,
  });

  const redirectTo = landing.kind === "redirect" ? landing.href : null;
  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  if (landing.kind === "eyeonHome") return <EyeonCommandCentrePage />;
  if (landing.kind === "classicHome") return <ProjectHomePage />;
  return (
    <Page withPadding scrollable headerProps={{ title: "Home" }}>
      <NoDataOrLoading isLoading />
    </Page>
  );
}
