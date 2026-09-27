/**
 * ACME UI customization presets. Deliberately a small, fixed set (not a free
 * color picker) so every combination stays legible and on-brand — matches
 * how this was scoped: "3-4 colors option only".
 *
 * Each accent preset sets the same CSS custom properties globals.css
 * defines for --primary/--link/--link-hover/--ring, applied at runtime via
 * a small <style> override (see AcmeThemeStyleInjector) rather than baked
 * into the build, so an owner/admin can change it without a redeploy.
 */
export const ACME_ACCENT_COLOR_KEYS = [
  "navy",
  "teal",
  "purple",
  "forest",
  "black",
  "red",
] as const;
export type AcmeAccentColorKey = (typeof ACME_ACCENT_COLOR_KEYS)[number];

export const ACME_ACCENT_COLOR_PRESETS: Record<
  AcmeAccentColorKey,
  {
    label: string;
    /** Swatch color shown in the picker UI (matches --primary below). */
    swatch: string;
    primary: string;
    link: string;
    linkHover: string;
    ring: string;
  }
> = {
  navy: {
    label: "Navy Blue",
    swatch: "hsl(217 70% 30%)",
    primary: "217 70% 30%",
    link: "217 70% 34%",
    linkHover: "217 70% 24%",
    ring: "217 60% 45%",
  },
  teal: {
    label: "Teal",
    swatch: "hsl(175 78% 24%)",
    primary: "175 78% 24%",
    link: "175 78% 28%",
    linkHover: "175 78% 18%",
    ring: "175 65% 42%",
  },
  purple: {
    label: "Purple",
    swatch: "hsl(262 55% 35%)",
    primary: "262 55% 35%",
    link: "262 55% 39%",
    linkHover: "262 55% 29%",
    ring: "262 50% 52%",
  },
  forest: {
    label: "Forest Green",
    swatch: "hsl(152 45% 25%)",
    primary: "152 45% 25%",
    link: "152 45% 29%",
    linkHover: "152 45% 19%",
    ring: "152 40% 40%",
  },
  black: {
    label: "Black",
    swatch: "hsl(0 0% 12%)",
    primary: "0 0% 12%",
    link: "0 0% 16%",
    linkHover: "0 0% 8%",
    ring: "0 0% 35%",
  },
  red: {
    // Deliberately deeper/more muted than --destructive (0 84.2% 60.2%,
    // used for error states) so a primary button and an error state never
    // read as the same color.
    label: "Red",
    swatch: "hsl(0 65% 35%)",
    primary: "0 65% 35%",
    link: "0 65% 39%",
    linkHover: "0 65% 29%",
    ring: "0 55% 50%",
  },
};

export const ACME_HEADER_BACKGROUND_KEYS = [
  "plain",
  "tinted",
  "gradient",
] as const;
export type AcmeHeaderBackgroundKey =
  (typeof ACME_HEADER_BACKGROUND_KEYS)[number];

export const ACME_HEADER_BACKGROUND_PRESETS: Record<
  AcmeHeaderBackgroundKey,
  { label: string; description: string }
> = {
  plain: {
    label: "Plain (default)",
    description: "No tint — matches the page background.",
  },
  tinted: {
    label: "Soft tint",
    description: "A subtle wash of the accent color behind the top bar.",
  },
  gradient: {
    label: "Gradient",
    description: "Accent color fading into the page background.",
  },
};

/**
 * Tailwind background class for PageHeader's top strip.
 *
 * ACME (CHG-2026-081): every preset is opaque. The header is sticky, so a
 * translucent one let the rows of a long page (the Logs tabs) show through it
 * as they scrolled underneath. The tint is now an image layered over the
 * solid page background: it looks the same, and nothing shows through.
 */
export function acmeHeaderBackgroundClass(
  key: AcmeHeaderBackgroundKey | undefined,
): string {
  switch (key) {
    case "tinted":
      return "bg-background bg-[image:linear-gradient(hsl(var(--primary)/0.06),hsl(var(--primary)/0.06))]";
    case "gradient":
      return "bg-background bg-[image:linear-gradient(to_bottom,hsl(var(--primary)/0.12),transparent)]";
    case "plain":
    default:
      return "bg-background";
  }
}

export type AcmeTheme = {
  accentColor: AcmeAccentColorKey;
  headerBackground: AcmeHeaderBackgroundKey;
};

export const ACME_THEME_DEFAULT: AcmeTheme = {
  accentColor: "navy",
  headerBackground: "plain",
};
