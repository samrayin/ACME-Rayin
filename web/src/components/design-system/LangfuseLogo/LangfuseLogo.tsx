import { LangfuseIcon } from "@/src/components/design-system/LangfuseIcon/LangfuseIcon";
import { cn } from "@/src/utils/tailwind";
import { PlusIcon } from "lucide-react";

export const LangfuseLogo = ({
  logoLightModeHref,
  logoDarkModeHref,
  customerLogoSrc,
}: {
  logoLightModeHref?: string;
  logoDarkModeHref?: string;
  /** ACME (CHG-2026-124): the organization's own logo, as a data URL. */
  customerLogoSrc?: string;
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
      {/* ACME (CHG-2026-121, was CHG-2026-081): EYEON, "EYE" in white and
          "ON" in the accent colour (owner's choice, 2026-10-06), at 24 px on
          its own, or 20 px beside a customer logo so both fit the sidebar.
          The ACME logo that stood beside it is removed (owner, 2026-10-06).
          The wordmark keeps its extra-bold logo weight: it is lettering, not
          body type. */}
      <span
        title="EYEON"
        className={cn(
          // eslint-disable-next-line @repo/no-raw-font-weight
          "truncate leading-none font-extrabold tracking-wide text-white group-data-[collapsible=icon]:hidden",
          customerLogoSrc ? "text-xl" : "text-2xl",
        )}
      >
        EYE<span className="text-sidebar-accent-foreground">ON</span>
      </span>
      <div className="hidden scale-120 group-data-[collapsible=icon]:block">
        <LangfuseIcon size={28} />
      </div>
    </div>
  );
};
