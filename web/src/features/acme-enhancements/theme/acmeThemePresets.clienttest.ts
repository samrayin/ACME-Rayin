import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    expect(acmeHeaderBackgroundClass(undefined)).toBe(
      acmeHeaderBackgroundClass("plain"),
    );
  });

  // CHG-2026-131 (ADR-0026 slice 1): light mode keeps exactly the classes it
  // had before; only `dark:` classes were added.
  it.each([
    ["plain", "bg-background"],
    [
      "tinted",
      "bg-background bg-[image:linear-gradient(hsl(var(--primary)/0.06),hsl(var(--primary)/0.06))]",
    ],
    [
      "gradient",
      "bg-background bg-[image:linear-gradient(to_bottom,hsl(var(--primary)/0.12),transparent)]",
    ],
  ] as const)("%s keeps its light-mode classes", (key, before) => {
    const light = acmeHeaderBackgroundClass(key)
      .split(" ")
      .filter((c) => !c.startsWith("dark:"));
    expect(light.join(" ")).toBe(before);
  });

  // The prototype's top bar: the chrome surface, never tinted in dark mode.
  it.each(ACME_HEADER_BACKGROUND_KEYS)(
    "%s is the untinted chrome surface in dark mode",
    (key) => {
      const classes = acmeHeaderBackgroundClass(key).split(" ");
      expect(classes).toContain("dark:bg-header");
      if (classes.some((c) => c.startsWith("bg-[image:"))) {
        expect(classes).toContain("dark:bg-none");
      }
    },
  );
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

// CHG-2026-131: CIELAB (D65) of an HSL triplet, for the colour difference
// ΔE*ab (CIE76) between two shades.
function cielab(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.split(" ").map((v) => parseFloat(v));
  const sat = s! / 100;
  const light = l! / 100;
  const k = (n: number) => (n + h! / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const linear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [r, g, b] = [channel(0), channel(8), channel(4)].map(linear) as [
    number,
    number,
    number,
  ];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = cielab(a);
  const [l2, a2, b2] = cielab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// The rule for "visibly different": ΔE*ab of at least 3, above the commonly
// cited just-noticeable difference of about 2.3.
const VISIBLE_DELTA_E = 3;

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

// CHG-2026-130 (ADR-0026 slice 0): the prototype's dark palette in
// globals.css. Text must stay readable on its new surfaces.
const globalsCss = readFileSync(
  join(process.cwd(), "src", "styles", "globals.css"),
  "utf8",
);
const cssBlock = (opening: string) => {
  const start = globalsCss.indexOf(opening);
  if (start < 0) throw new Error(`${opening.trim()} not in globals.css`);
  return globalsCss.slice(start, globalsCss.indexOf("\n  }", start));
};
const tokenIn = (block: string, label: string) => (name: string) => {
  const m = new RegExp(String.raw`\n\s+${name}:\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`${name} not in the ${label} block`);
  return m[1]!.trim();
};

describe("dark-mode palette (CHG-2026-130)", () => {
  const token = tokenIn(cssBlock("  .dark {"), "dark");

  it.each([
    ["--foreground", "--background"],
    ["--foreground", "--card"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--card"],
    ["--secondary-foreground", "--secondary"],
    ["--accent-foreground", "--accent"],
    ["--sidebar-foreground", "--sidebar-background"],
    // CHG-2026-131: sidebar text on the hover shade, and the section labels.
    ["--sidebar-foreground", "--sidebar-hover"],
    ["--sidebar-hover-foreground", "--sidebar-hover"],
    ["--sidebar-label", "--sidebar-background"],
  ])("%s on %s meets WCAG AA", (text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the near-black surfaces in order: page, card, muted, popover", () => {
    const lightness = (name: string) => parseFloat(token(name).split(" ")[2]!);
    expect(lightness("--background")).toBeLessThan(lightness("--card"));
    expect(lightness("--card")).toBeLessThan(lightness("--muted"));
    expect(lightness("--muted")).toBeLessThan(lightness("--popover"));
  });
});

// CHG-2026-131 (ADR-0026 slice 1): a hovered sidebar row must not look like
// the active one, and must still be seen against the sidebar.
describe("sidebar hover in dark mode (CHG-2026-131)", () => {
  const token = tokenIn(cssBlock("  .dark {"), "dark");
  const hover = token("--sidebar-hover");

  it("is the prototype's hover shade, #0C1316", () => {
    expect(hover).toBe("198 29% 6.7%");
  });

  it("differs visibly from the sidebar background", () => {
    expect(deltaE(hover, token("--sidebar-background"))).toBeGreaterThanOrEqual(
      VISIBLE_DELTA_E,
    );
  });

  it("differs visibly from the default active shade", () => {
    expect(deltaE(hover, token("--sidebar-accent"))).toBeGreaterThanOrEqual(
      VISIBLE_DELTA_E,
    );
  });

  // The injector replaces --sidebar-accent with the chosen dark accent's
  // shade; the hover shade stays fixed, so it must differ from every one.
  it.each(ACME_DARK_ACCENT_KEYS)(
    "differs visibly from the %s accent's active shade",
    (key) => {
      expect(
        deltaE(hover, ACME_DARK_ACCENT_PRESETS[key].sidebarAccent),
      ).toBeGreaterThanOrEqual(VISIBLE_DELTA_E);
    },
  );

  it("card titles in ink-1 meet WCAG AA on cards", () => {
    const title = /^hsl\((.+)\)$/.exec(token("--card-title"))?.[1];
    expect(title).toBeDefined();
    expect(contrast(title!, token("--card"))).toBeGreaterThanOrEqual(4.5);
  });
});

// CHG-2026-131: light mode must look exactly as before. Each new light token
// holds the value light mode already showed.
describe("light mode unchanged (CHG-2026-131)", () => {
  const token = tokenIn(cssBlock("  :root {"), "light");

  it("the sidebar hover shade is today's light hover, sidebar-accent", () => {
    expect(token("--sidebar-hover")).toBe("210 45% 23%");
    expect(token("--sidebar-hover")).toBe(token("--sidebar-accent"));
  });

  it("the sidebar hover text is today's light hover text, sidebar-accent-foreground", () => {
    expect(token("--sidebar-hover-foreground")).toBe("173 85% 60%");
    expect(token("--sidebar-hover-foreground")).toBe(
      token("--sidebar-accent-foreground"),
    );
  });

  it("section labels stay white (they were text-white)", () => {
    expect(token("--sidebar-label")).toBe("0 0% 100%");
  });

  it("card titles keep inheriting their colour", () => {
    expect(token("--card-title")).toBe("currentColor");
  });
});
