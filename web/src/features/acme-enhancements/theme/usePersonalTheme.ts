import useLocalStorage from "@/src/components/useLocalStorage";
import {
  ACME_ACCENT_COLOR_KEYS,
  ACME_HEADER_BACKGROUND_KEYS,
  ACME_THEME_DEFAULT,
  type AcmeTheme,
} from "@/src/features/acme-enhancements/theme/acmeThemePresets";

/**
 * ACME (CHG-2026-074): a personal theme. Each user may override the
 * project's theme for themselves only; it is kept in this browser and never
 * sent to the server, so nobody can change what someone else sees. An empty
 * object means "use the project default".
 */
export const PERSONAL_THEME_STORAGE_KEY = "cairo.personalTheme.v1";

export type PersonalTheme = Partial<AcmeTheme>;

/** Keep only known preset keys: a stale or hand-edited value is ignored. */
export function sanitizePersonalTheme(value: unknown): PersonalTheme {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: PersonalTheme = {};
  if (
    typeof v.accentColor === "string" &&
    (ACME_ACCENT_COLOR_KEYS as readonly string[]).includes(v.accentColor)
  )
    out.accentColor = v.accentColor as AcmeTheme["accentColor"];
  if (
    typeof v.headerBackground === "string" &&
    (ACME_HEADER_BACKGROUND_KEYS as readonly string[]).includes(
      v.headerBackground,
    )
  )
    out.headerBackground = v.headerBackground as AcmeTheme["headerBackground"];
  return out;
}

/**
 * The theme a user actually sees: their personal choice where they made
 * one, otherwise the project's. Undefined while the project theme is still
 * loading and the user has no personal choice.
 */
export function effectiveTheme(
  project: AcmeTheme | undefined,
  personal: PersonalTheme,
): AcmeTheme | undefined {
  if (!project && !personal.accentColor && !personal.headerBackground)
    return undefined;
  const base = project ?? ACME_THEME_DEFAULT;
  return {
    accentColor: personal.accentColor ?? base.accentColor,
    headerBackground: personal.headerBackground ?? base.headerBackground,
  };
}

export function usePersonalTheme() {
  const [stored, setStored, clear] = useLocalStorage<PersonalTheme>(
    PERSONAL_THEME_STORAGE_KEY,
    {},
  );
  const personal = sanitizePersonalTheme(stored);
  return {
    personal,
    hasPersonal: Boolean(personal.accentColor || personal.headerBackground),
    setPersonal: (next: PersonalTheme) =>
      setStored(sanitizePersonalTheme(next)),
    clearPersonal: clear,
  };
}
