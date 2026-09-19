import Page from "@/src/components/layouts/page";
import { AcmeLitellmGateway } from "@/src/features/acme-enhancements/components/AcmeLitellmGateway";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

const headerProps = {
  title: "LLM Gateway",
  help: {
    description:
      "Keys, teams, budgets, models and spend for the LLM gateway, managed " +
      "from CAIRO under this project's roles. Every change is written to an " +
      "append-only record before it is confirmed.",
  },
};

export default function AcmeLitellmGatewayPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <AcmeLitellmGateway projectId={projectId} /> : null}
    </Page>
  );
}
