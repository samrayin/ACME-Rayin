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
    // ACME (CHG-2026-124 follow-up): the page is taller than the screen now
    // that it has the Add Logo card, so its content must scroll.
    <Page headerProps={headerProps} scrollable>
      {projectId ? <AcmeUiCustomizationSettings projectId={projectId} /> : null}
    </Page>
  );
}
