import { useEffect } from "react";
import { useRouter } from "next/router";

// ACME (CHG-2026-073): the audit log moved to Security > Logs. Old links and
// bookmarks land on its tab there.
export default function AuditLogsRedirect() {
  const router = useRouter();
  const projectId = router.query.projectId;
  useEffect(() => {
    if (typeof projectId === "string")
      router
        .replace(
          `/project/${projectId}/acme-enhancements/security-logs?tab=audit`,
        )
        .catch(() => {});
  }, [projectId, router]);
  return (
    <p className="text-muted-foreground p-4 text-sm">
      Audit logs moved to Security &gt; Logs. Redirecting…
    </p>
  );
}
