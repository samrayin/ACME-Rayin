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
