import Page from "@/src/components/layouts/page";
import { AcmeApplicationsScorecard } from "@/src/features/acme-enhancements/components/AcmeApplicationsScorecard";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

const headerProps = {
  title: "Applications",
  help: {
    description:
      "One scorecard per application connected through the gateway: " +
      "protection, threat activity, data protection, access hygiene, spend " +
      "and reliability, each rated from metadata EYEON already records.",
  },
};

export default function AcmeApplicationsPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <AcmeApplicationsScorecard projectId={projectId} /> : null}
    </Page>
  );
}
