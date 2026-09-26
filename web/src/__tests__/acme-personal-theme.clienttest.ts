import { describe, it, expect } from "vitest";
import {
  effectiveTheme,
  sanitizePersonalTheme,
} from "@/src/features/acme-enhancements/theme/usePersonalTheme";
import {
  ACME_ACCENT_COLOR_KEYS,
  ACME_HEADER_BACKGROUND_KEYS,
  type AcmeTheme,
} from "@/src/features/acme-enhancements/theme/acmeThemePresets";

// CHG-2026-074: a personal theme overrides the project default for one user.
const PROJECT: AcmeTheme = {
  accentColor: ACME_ACCENT_COLOR_KEYS[0],
  headerBackground: ACME_HEADER_BACKGROUND_KEYS[0],
};
const OTHER_ACCENT = ACME_ACCENT_COLOR_KEYS[1];
const OTHER_HEADER = ACME_HEADER_BACKGROUND_KEYS[1];

describe("personal theme (CHG-2026-074)", () => {
  it("no personal choice: the project theme applies", () => {
    expect(effectiveTheme(PROJECT, {})).toEqual(PROJECT);
  });

  it("a personal choice overrides only what it sets", () => {
    expect(effectiveTheme(PROJECT, { accentColor: OTHER_ACCENT })).toEqual({
      accentColor: OTHER_ACCENT,
      headerBackground: PROJECT.headerBackground,
    });
    expect(effectiveTheme(PROJECT, { headerBackground: OTHER_HEADER })).toEqual(
      {
        accentColor: PROJECT.accentColor,
        headerBackground: OTHER_HEADER,
      },
    );
  });

  it("nothing to apply while the project theme loads and there is no choice", () => {
    expect(effectiveTheme(undefined, {})).toBeUndefined();
  });

  it("unknown or hand-edited stored values are ignored", () => {
    expect(
      sanitizePersonalTheme({
        accentColor: "red; } body { display:none",
        headerBackground: "nope",
      }),
    ).toEqual({});
    expect(sanitizePersonalTheme("garbage")).toEqual({});
    expect(sanitizePersonalTheme({ accentColor: OTHER_ACCENT })).toEqual({
      accentColor: OTHER_ACCENT,
    });
  });
});
