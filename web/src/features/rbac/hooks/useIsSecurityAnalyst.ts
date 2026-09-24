import { useSession } from "next-auth/react";

/**
 * ACME: true once the session has loaded and the user's role in this project
 * is SECURITY (Security Analyst). False while loading, so callers never
 * redirect or hide things for other roles during session resolution.
 */
export function useIsSecurityAnalyst(projectId: string | undefined): boolean {
  const session = useSession();
  if (!projectId || session.status !== "authenticated") return false;
  if (session.data.user?.admin) return false;
  const role = session.data.user?.organizations
    .flatMap((org) => org.projects)
    .find((project) => project.id === projectId)?.role;
  return role === "SECURITY";
}

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

/**
 * ACME (ADR-0011 section 6): true once the session has loaded and the user's
 * role in this project is content-free (Security Analyst, Business Analyst,
 * Auditor). The server enforces these roles with procedure allow-lists; the
 * UI uses this to not render, and not query, what those lists refuse.
 * False while loading and for instance admins.
 */
export function useIsContentFreeRole(projectId: string | undefined): boolean {
  const session = useSession();
  if (!projectId || session.status !== "authenticated") return false;
  if (session.data.user?.admin) return false;
  const role = session.data.user?.organizations
    .flatMap((org) => org.projects)
    .find((project) => project.id === projectId)?.role;
  return role === "SECURITY" || role === "ANALYST" || role === "AUDITOR";
}
