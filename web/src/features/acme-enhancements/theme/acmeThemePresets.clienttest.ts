import { describe, expect, it } from "vitest";
import {
  ACME_HEADER_BACKGROUND_KEYS,
  acmeHeaderBackgroundClass,
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
