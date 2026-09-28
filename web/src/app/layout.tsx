import { ACME_PRODUCT_NAME } from "@/src/features/acme-enhancements/utils/acmeBranding";

// CHG-2026-085 c: this layout only renders the not-found page (the App Router
// holds API routes otherwise), so it no longer carries Next.js's boilerplate.
export const metadata = {
  title: ACME_PRODUCT_NAME,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
