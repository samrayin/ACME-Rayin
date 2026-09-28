import "@/src/styles/globals.css";
import { AcmeNotFound } from "@/src/features/acme-enhancements/components/AcmeNotFound";
import { acmePageTitle } from "@/src/features/acme-enhancements/utils/acmeBranding";

/**
 * CHG-2026-085 c / ADR-0019 §12: because `src/app/` exists (for API routes),
 * Next.js serves every unmatched URL from the App Router. Without this file it
 * rendered its built-in 404 inside the root layout, titled "Next.js".
 */
export const metadata = {
  title: acmePageTitle("404: This page could not be found"),
  description: "This page could not be found.",
};

export default function NotFound() {
  return <AcmeNotFound />;
}
