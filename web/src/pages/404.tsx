import Head from "next/head";
import { AcmeNotFound } from "@/src/features/acme-enhancements/components/AcmeNotFound";
import { acmePageTitle } from "@/src/features/acme-enhancements/utils/acmeBranding";

/**
 * CHG-2026-085 b / ADR-0019: the Pages Router's not-found page, served when a
 * page's server-side props return `notFound: true`. Unmatched URLs are served
 * by the App Router's `app/not-found.tsx` instead (part c).
 *
 * It must stay static: Next.js refuses a 404 page with `getInitialProps`, so
 * it does not reuse `_error.tsx`'s default export.
 */
const NotFoundPage = () => (
  <>
    <Head>
      <title>{acmePageTitle("404: This page could not be found")}</title>
    </Head>
    <AcmeNotFound />
  </>
);

NotFoundPage.skipAppLayout = true;

export default NotFoundPage;
