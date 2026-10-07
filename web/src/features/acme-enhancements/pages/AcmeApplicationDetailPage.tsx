import { useRouter } from "next/router";
import Page from "@/src/components/layouts/page";
import { AcmeApplicationDetail } from "@/src/features/acme-enhancements/components/AcmeApplicationDetail";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

// ACME (CHG-2026-125, ADR-0023 §3.5): one application's detail screen,
// reached from its card on the Applications page.
export default function AcmeApplicationDetailPage() {
  const projectId = useProjectIdFromURL();
  const router = useRouter();
  const lineageId =
    typeof router.query.lineageId === "string"
      ? router.query.lineageId
      : undefined;

  return (
    <Page
      headerProps={{
        title: "Application",
        breadcrumb: projectId
          ? [
              {
                name: "Applications",
                href: `/project/${projectId}/acme-enhancements/applications`,
              },
            ]
          : undefined,
        help: {
          description:
            "One application connected through the gateway: its scorecard, " +
            "key and limits, daily activity, latest requests with the " +
            "guardrail's decisions, and its key's change record, from " +
            "metadata EYEON already records.",
        },
      }}
      scrollable
      withPadding
    >
      {projectId && lineageId ? (
        <AcmeApplicationDetail projectId={projectId} lineageId={lineageId} />
      ) : null}
    </Page>
  );
}
