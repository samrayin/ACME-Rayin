import Page from "@/src/components/layouts/page";
import { AcmeAssuranceDemoTable } from "@/src/features/acme-enhancements/components/AcmeAssuranceDemoTable";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

const headerProps = {
  title: "Assurance (Preview)",
  help: {
    description:
      "A deliberately thin demo pairing a declared Inherent Risk " +
      "classification with a real, live Residual Assurance signal from " +
      "rayin-guardrails — built to validate the concept before committing " +
      "to the full Asset Inventory and Assurance features. Not the " +
      "production feature; nothing here is stored in a database.",
  },
};

export default function AcmeAssuranceDemoPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <AcmeAssuranceDemoTable projectId={projectId} /> : null}
    </Page>
  );
}
