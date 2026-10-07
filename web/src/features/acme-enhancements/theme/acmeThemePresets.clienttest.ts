import { describe, expect, it } from "vitest";
import {
  ACME_ACCENT_COLOR_PRESETS,
  ACME_DARK_ACCENT_KEYS,
  ACME_DARK_ACCENT_PRESETS,
  ACME_HEADER_BACKGROUND_KEYS,
  ACME_THEME_DEFAULT,
  acmeHeaderBackgroundClass,
  acmeThemeCss,
} from "./acmeThemePresets";

// The page header is sticky: a translucent background lets a long page's
// rows show through it as they scroll underneath (CHG-2026-081).
describe("page header background", () => {
  it.each(ACME_HEADER_BACKGROUND_KEYS)("%s is opaque", (key) => {
    const classes = acmeHeaderBackgroundClass(key).split(" ");
    expect(classes).toContain("bg-background");
    // No translucent colour as the background colour itself.
    expect(classes.some((c) => c.startsWith("bg-[hsl("))).toBe(false);
    expect(classes.some((c) => c.startsWith("from-"))).toBe(false);
  });

  it("an unset preset falls back to plain", () => {
    expect(acmeHeaderBackgroundClass(undefined)).toBe("bg-background");
  });
});

// CHG-2026-127: dark mode has its own bright accents; light mode keeps its
// presets, and each applies only in its own mode.
function luminance(hsl: string): number {
  const [h, s, l] = hsl.split(" ").map((v) => parseFloat(v));
  const sat = s! / 100;
  const light = l! / 100;
  const k = (n: number) => (n + h! / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const linear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [r, g, b] = [channel(0), channel(8), channel(4)].map(linear);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("dark-mode accents (CHG-2026-127)", () => {
  it.each(ACME_DARK_ACCENT_KEYS)(
    "%s reads clearly on the dark page and carries readable dark text",
    (key) => {
      const preset = ACME_DARK_ACCENT_PRESETS[key];
      // The dark page background and near-black text: WCAG AA (4.5:1).
      expect(contrast(preset.primary, "0 0% 4%")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(preset.link, "0 0% 4%")).toBeGreaterThanOrEqual(4.5);
      // The active sidebar item: the accent on its own dark tint.
      expect(
        contrast(preset.primary, preset.sidebarAccent),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("applies the light accent only in light mode and the dark one only in dark mode", () => {
    const css = acmeThemeCss({
      ...ACME_THEME_DEFAULT,
      accentColor: "teal",
      darkAccentColor: "pink",
    });
    const [lightBlock, darkBlock] = css.split(":root.dark");
    expect(lightBlock).toContain(":root:not(.dark)");
    expect(lightBlock).toContain(
      `--primary: ${ACME_ACCENT_COLOR_PRESETS.teal.primary};`,
    );
    expect(darkBlock).toContain(
      `--primary: ${ACME_DARK_ACCENT_PRESETS.pink.primary};`,
    );
    expect(darkBlock).not.toContain(ACME_ACCENT_COLOR_PRESETS.teal.primary);
  });

  it("colours the wordmark's ON and the active sidebar item in dark mode", () => {
    const css = acmeThemeCss({
      ...ACME_THEME_DEFAULT,
      darkAccentColor: "cyan",
    });
    expect(css).toContain(
      `--sidebar-accent-foreground: ${ACME_DARK_ACCENT_PRESETS.cyan.primary};`,
    );
    expect(css).toContain("--primary-foreground: 0 0% 4%;");
  });

  it("defaults to lime in dark mode", () => {
    expect(ACME_THEME_DEFAULT.darkAccentColor).toBe("lime");
  });
});
