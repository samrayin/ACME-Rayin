import Head from "next/head";
import { CrashModal } from "@/src/components/CrashModal/CrashModal";
import { acmePageTitle } from "@/src/features/acme-enhancements/utils/acmeBranding";

/**
 * CHG-2026-085 b / ADR-0019: CAIRO's not-found page. Without this file
 * Next.js serves its built-in 404 page, whose browser tab says "Next.js";
 * `_error.tsx` does not handle not-found. It looks like the error page's 404.
 *
 * It must stay static: Next.js refuses a 404 page with `getInitialProps`, so
 * it does not reuse `_error.tsx`'s default export.
 */
const NotFoundPage = () => (
  <>
    <Head>
      <title>{acmePageTitle("404: This page could not be found")}</title>
    </Head>
    <div className="min-h-screen-with-banner bg-background text-foreground flex items-center justify-center px-6 py-10">
      <CrashModal
        description="This page could not be found."
        showReturnHome
        statusCode={404}
      />
    </div>
  </>
);

NotFoundPage.skipAppLayout = true;

export default NotFoundPage;
