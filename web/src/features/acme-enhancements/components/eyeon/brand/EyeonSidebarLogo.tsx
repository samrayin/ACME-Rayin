import { EyeonLogo } from "@/src/features/acme-enhancements/components/eyeon/brand/EyeonLogo";

/**
 * ACME (CHG-2026-150, ADR-0025 §5): the EYEON logo as the sidebar's logo row
 * shows it, and as the UI Customization preview shows that row. The row takes
 * the page header's background (light in the light theme, dark in the dark
 * theme; owner's option B, 2026-10-11), so the logo follows the theme. 24px
 * high on its own, or 20px beside a customer's logo so both fit the 184px
 * sidebar.
 */
export function EyeonSidebarLogo({
  besideCustomerLogo,
}: {
  besideCustomerLogo: boolean;
}) {
  return <EyeonLogo size={besideCustomerLogo ? "sm" : "md"} />;
}
