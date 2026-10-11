import Image from "next/image";
import { env } from "@/src/env.mjs";
import { cn } from "@/src/utils/tailwind";

/**
 * The two logo files under web/public/eyeon, trimmed from the owner's
 * originals: 172 x 64 px, twice the largest height they are shown at.
 */
const LOGO_WIDTH_PX = 172;
const LOGO_HEIGHT_PX = 64;

const basePath = env.NEXT_PUBLIC_BASE_PATH ?? "";

const EYEON_LOGO_SRC = {
  /** Black lettering: the logo for the light theme. */
  light: `${basePath}/eyeon/eyeon-logo-light.png`,
  /** White lettering: the logo for the dark theme. */
  dark: `${basePath}/eyeon/eyeon-logo-dark.png`,
} as const;

export const EYEON_LOGO_ALT = "EYEON";

/** 24px on its own; 20px beside a customer's logo or in the phone's top bar. */
const HEIGHT_CLASS = { md: "h-6", sm: "h-5" } as const;

type EyeonLogoProps = {
  size?: keyof typeof HEIGHT_CLASS;
};

/**
 * ACME (CHG-2026-150, ADR-0026 §12.5): the EYEON logo, the owner's image in
 * place of the "EYE" + "ON" text wordmark. Its colours are fixed: it does not
 * follow the accent colour. It always sits on a surface that follows the
 * theme (the logo row takes the page header's background, owner's option B,
 * 2026-10-11), so the light-theme logo (black lettering) shows in the light
 * theme and the dark-theme logo (white lettering) in the dark theme, by the
 * `.dark` class on `<html>`. The images are served as they are, without
 * Next's image optimiser (`unoptimized`): they are already small, and the
 * console runs where that service may not be available.
 */
export function EyeonLogo({ size = "md" }: EyeonLogoProps) {
  const imageClass = cn("w-auto object-contain", HEIGHT_CLASS[size]);

  return (
    <span className="flex shrink-0 items-center">
      <Image
        src={EYEON_LOGO_SRC.light}
        alt={EYEON_LOGO_ALT}
        width={LOGO_WIDTH_PX}
        height={LOGO_HEIGHT_PX}
        unoptimized
        loading="eager"
        className={cn(imageClass, "dark:hidden")}
      />
      <Image
        src={EYEON_LOGO_SRC.dark}
        alt={EYEON_LOGO_ALT}
        width={LOGO_WIDTH_PX}
        height={LOGO_HEIGHT_PX}
        unoptimized
        loading="eager"
        className={cn(imageClass, "hidden dark:block")}
      />
    </span>
  );
}
