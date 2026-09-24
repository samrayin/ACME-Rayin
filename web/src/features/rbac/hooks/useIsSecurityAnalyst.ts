import { useSession } from "next-auth/react";

/**
 * ACME (ADR-0011): true once the session has loaded and the user's role in
 * this project has no dashboard access (Security Analyst, Auditor), so the
 * home page sends them to the guardrails page instead. Business Analyst uses
 * the home dashboard. False while loading.
 */
export function useLandsOnGuardrails(projectId: string | undefined): boolean {
  const session = useSession();
  if (!projectId || session.status !== "authenticated") return false;
  if (session.data.user?.admin) return false;
  const role = session.data.user?.organizations
    .flatMap((org) => org.projects)
    .find((project) => project.id === projectId)?.role;
  return role === "SECURITY" || role === "AUDITOR";
}
