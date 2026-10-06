import { LangfuseIcon } from "@/src/components/design-system/LangfuseIcon/LangfuseIcon";
import { cn } from "@/src/utils/tailwind";
import { PlusIcon } from "lucide-react";

export const LangfuseLogo = ({
  logoLightModeHref,
  logoDarkModeHref,
}: {
  logoLightModeHref?: string;
  logoDarkModeHref?: string;
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
    <div className="flex items-center">
      {/* ACME (CHG-2026-121, was CHG-2026-081): EYEON, "EYE" in white and
          "ON" in the accent colour (owner's choice, 2026-10-06), on its own
          and at 24 px: the ACME logo that stood beside it is removed (owner,
          2026-10-06). The wordmark keeps its extra-bold logo weight: it is
          lettering, not body type. */}
      <span
        title="EYEON"
        // eslint-disable-next-line @repo/no-raw-font-weight
        className="truncate text-2xl leading-none font-extrabold tracking-wide text-white group-data-[collapsible=icon]:hidden"
      >
        EYE<span className="text-sidebar-accent-foreground">ON</span>
      </span>
      <div className="hidden scale-120 group-data-[collapsible=icon]:block">
        <LangfuseIcon size={28} />
      </div>
    </div>
  );
};
