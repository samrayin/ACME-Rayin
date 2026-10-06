import Page from "@/src/components/layouts/page";
import { AcmeUiCustomizationSettings } from "@/src/features/acme-enhancements/components/AcmeUiCustomizationSettings";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

const headerProps = {
  title: "UI Customization",
  help: {
    description:
      "Add your organization's logo, and pick the accent color and top-bar " +
      "background — applied live, no redeploy needed.",
  },
};

export default function AcmeUiCustomizationPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps}>
      {projectId ? <AcmeUiCustomizationSettings projectId={projectId} /> : null}
    </Page>
  );
}
