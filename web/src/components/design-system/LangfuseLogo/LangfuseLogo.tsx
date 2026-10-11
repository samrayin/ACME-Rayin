import type { ReactNode } from "react";
import { LangfuseIcon } from "@/src/components/design-system/LangfuseIcon/LangfuseIcon";
import { cn } from "@/src/utils/tailwind";
import { PlusIcon } from "lucide-react";

export const LangfuseLogo = ({
  logoLightModeHref,
  logoDarkModeHref,
  customerLogoSrc,
  brand,
}: {
  logoLightModeHref?: string;
  logoDarkModeHref?: string;
  /** ACME (CHG-2026-124): the organization's own logo, as a data URL. */
  customerLogoSrc?: string;
  /**
   * ACME (CHG-2026-150): the EYEON logo, passed in by the app (a
   * design-system file does not import feature code).
   */
  brand?: ReactNode;
}) => {
  if (logoLightModeHref && logoDarkModeHref) {
    // logo is a url, maximum aspect ratio of 1:3 needs to be supported according to docs
    return (
      <div className="flex items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoLightModeHref}
          alt="Langfuse Logo"
          className={cn(
            "group-data-[collapsible=icon]:hidden dark:hidden",
            "max-h-4 max-w-14",
          )}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoDarkModeHref}
          alt="Langfuse Logo"
          className={cn(
            "hidden group-data-[collapsible=icon]:hidden dark:block",
            "max-h-4 max-w-14",
          )}
        />
        <PlusIcon size={8} className="group-data-[collapsible=icon]:hidden" />
        <LangfuseIcon size={16} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* ACME (CHG-2026-124, ADR-0025): the customer's own logo, uploaded
          under UI Customization. On a white tile so a dark logo stays legible
          on the navy or near-black sidebar; 24 px high and at most 72 px wide
          (ACME_LOGO_DISPLAY), keeping its proportions. */}
      {customerLogoSrc ? (
        <div className="flex h-8 shrink-0 items-center rounded-md bg-white px-1.5 group-data-[collapsible=icon]:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={customerLogoSrc}
            alt="Organization logo"
            className="max-h-6 max-w-18 object-contain"
          />
        </div>
      ) : null}
      {/* ACME (CHG-2026-150, was CHG-2026-121): the EYEON logo, an image
          with fixed colours, in place of the "EYE" + "ON" text wordmark
          (AppSidebar passes it in). Collapsed to icons, the sidebar shows
          the icon below instead, as before. */}
      {brand ? (
        <span className="flex shrink-0 group-data-[collapsible=icon]:hidden">
          {brand}
        </span>
      ) : null}
      <div className="hidden scale-120 group-data-[collapsible=icon]:block">
        <LangfuseIcon size={28} />
      </div>
    </div>
  );
};
