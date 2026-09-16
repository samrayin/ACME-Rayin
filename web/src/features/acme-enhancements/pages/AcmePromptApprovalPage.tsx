import Page from "@/src/components/layouts/page";
import { AcmePromptApprovalTable } from "@/src/features/acme-enhancements/components/AcmePromptApprovalTable";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

const headerProps = {
  title: "Prompt Approvals",
  help: {
    description:
      "Request/approve/reject trail for pushing a prompt version to a " +
      "label before go-live — a named approver, not just a permission " +
      "check.",
  },
};

export default function AcmePromptApprovalPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <AcmePromptApprovalTable projectId={projectId} /> : null}
    </Page>
  );
}
