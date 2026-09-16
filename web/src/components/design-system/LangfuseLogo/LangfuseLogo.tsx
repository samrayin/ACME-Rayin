import { LangfuseIcon } from "@/src/components/design-system/LangfuseIcon/LangfuseIcon";
import { env } from "@/src/env.mjs";
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
      {/* The source logo file is an opaque (non-transparent) lockup, so it
          needs its own light backing to stay legible on the navy sidebar in
          light mode and the near-black sidebar in dark mode -- same fixed
          artwork in both themes rather than a separate dark-mode variant. */}
      <div className="rounded-md bg-white px-2 py-1 group-data-[collapsible=icon]:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="h-5 max-w-22 translate-y-px"
          src={`${env.NEXT_PUBLIC_BASE_PATH ?? ""}/wordart-black.svg`}
          alt="ACME Logo"
        />
      </div>
      <span className="ml-2 truncate text-base font-extrabold tracking-wide text-white group-data-[collapsible=icon]:hidden">
        CAI<span className="text-sidebar-accent-foreground">RO</span>
      </span>
      <div className="hidden scale-120 group-data-[collapsible=icon]:block">
        <LangfuseIcon size={28} />
      </div>
    </div>
  );
};
