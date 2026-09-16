import Page from "@/src/components/layouts/page";
import { AcmePromptReviewTable } from "@/src/features/acme-enhancements/components/AcmePromptReviewTable";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

const headerProps = {
  title: "Prompt Reviews",
  help: {
    description:
      "Set a review date on any prompt's latest version and see what's " +
      "past due — checked nightly, with an optional Slack/webhook digest " +
      "for what's overdue.",
  },
};

export default function AcmePromptReviewPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <AcmePromptReviewTable projectId={projectId} /> : null}
    </Page>
  );
}
