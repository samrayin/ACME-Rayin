// This page is part of the cloud signup flow and can also be opened directly for local testing.

import Head from "next/head";
import { ConnectedOnboardingSurvey } from "@/src/features/onboarding/components/ConnectedOnboardingSurvey";
import { acmePageTitle } from "@/src/features/acme-enhancements/utils/acmeBranding";

export default function OnboardingPage() {
  return (
    <>
      <Head>
        <title>{acmePageTitle("Onboarding")}</title>
      </Head>
      <ConnectedOnboardingSurvey />
    </>
  );
}
