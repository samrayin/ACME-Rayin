"use client";

import { CrashModal } from "@/src/components/CrashModal/CrashModal";

/**
 * CHG-2026-085 b/c / ADR-0019: the body of CAIRO's not-found page, the error
 * page's 404 card. Shared by the App Router's `app/not-found.tsx`, which
 * serves every unmatched URL, and the Pages Router's `pages/404.tsx`, which
 * serves `notFound: true` from a page's server-side props.
 */
export function AcmeNotFound() {
  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center px-6 py-10">
      <CrashModal
        description="This page could not be found."
        showReturnHome
        statusCode={404}
      />
    </div>
  );
}
