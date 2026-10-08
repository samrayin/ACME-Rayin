/**
 * ACME (CHG-2026-142, ADR-0026 §12.4): the width a person gives the docked
 * sidebar by dragging its inner edge, in rem.
 *
 * Kept in this browser only, per signed-in person, like the EYEON Home
 * arrangement (CHG-2026-136): never sent to the server. Until a person
 * resizes, nothing is stored and the sidebar keeps sidebar.tsx's own width
 * (`SIDEBAR_WIDTH`, 11.5rem). On a narrow window the sidebar shows at most a
 * quarter of it; the width kept is not changed by that.
 *
 * Pure functions, tested without a browser. The storage helpers take the
 * storage as an argument, guard every read and write, and never throw.
 */

/** sidebar.tsx's `SIDEBAR_WIDTH`; a test fails if the two drift apart. */
export const SIDEBAR_WIDTH_DEFAULT_REM = 11.5;
/** Narrower than today's width is what the collapsed (icon) mode is for. */
export const SIDEBAR_WIDTH_MIN_REM = 11.5;
/** About twice the default: long names fit, the page keeps most of the screen. */
export const SIDEBAR_WIDTH_MAX_REM = 24;
/** One arrow key press: 8px at the default root font size. */
export const SIDEBAR_WIDTH_STEP_REM = 0.5;
/** The share of the window the sidebar may take at most (owner, 2026-10-08). */
const WINDOW_SHARE = 0.25;

/** Widths are kept to 1/16 rem: one pixel at the default root font size. */
function roundToPixel(rem: number): number {
  return Math.round(rem * 16) / 16;
}

/** The root font size, or 16px when it is unknown. */
function pxPerRem(remPx: number): number {
  return remPx > 0 && Number.isFinite(remPx) ? remPx : 16;
}

/** A maximum kept within the fixed limits; anything else gives the fixed one. */
function upperLimit(maxRem: number): number {
  if (!Number.isFinite(maxRem)) return SIDEBAR_WIDTH_MAX_REM;
  return Math.min(
    SIDEBAR_WIDTH_MAX_REM,
    Math.max(SIDEBAR_WIDTH_MIN_REM, maxRem),
  );
}

/**
 * The widest the sidebar may be in a window `innerWidthPx` wide: a quarter of
 * the window, never below the default and never above 24rem, rounded down to
 * 1/16 rem. With the default root font size that is 11.5rem up to a 736px
 * window and 24rem from a 1536px one. A window that cannot be measured
 * allows the full 24rem, as before this limit.
 */
export function sidebarMaxForWindow(
  innerWidthPx: number,
  remPx: number,
): number {
  if (!Number.isFinite(innerWidthPx) || innerWidthPx <= 0) {
    return SIDEBAR_WIDTH_MAX_REM;
  }
  const quarter = (innerWidthPx * WINDOW_SHARE) / pxPerRem(remPx);
  return upperLimit(Math.floor(quarter * 16) / 16);
}

/**
 * Any number to a width within the limits (the widest being `maxRem`, the
 * window's own maximum, when given); anything else to the default.
 */
export function clampSidebarWidth(
  rem: number,
  maxRem: number = SIDEBAR_WIDTH_MAX_REM,
): number {
  if (!Number.isFinite(rem)) return SIDEBAR_WIDTH_DEFAULT_REM;
  return Math.min(
    upperLimit(maxRem),
    Math.max(SIDEBAR_WIDTH_MIN_REM, roundToPixel(rem)),
  );
}

/**
 * What was read from storage, made safe: a number within the limits is kept,
 * anything else (missing, text, out of range, hand-edited) gives the default.
 */
export function sanitiseSidebarWidth(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < SIDEBAR_WIDTH_MIN_REM ||
    value > SIDEBAR_WIDTH_MAX_REM
  ) {
    return SIDEBAR_WIDTH_DEFAULT_REM;
  }
  return roundToPixel(value);
}

/** One keyboard step narrower or wider, within the limits. */
export function stepSidebarWidth(
  rem: number,
  direction: "narrower" | "wider",
  maxRem: number = SIDEBAR_WIDTH_MAX_REM,
): number {
  return clampSidebarWidth(
    rem +
      (direction === "wider"
        ? SIDEBAR_WIDTH_STEP_REM
        : -SIDEBAR_WIDTH_STEP_REM),
    maxRem,
  );
}

export type SidebarSide = "left" | "right";

/**
 * The width a key gives the handle of a sidebar on `side`, or null when the
 * key does nothing. Arrow keys move the edge (right widens a left sidebar),
 * Home and End go to the narrowest and widest (`maxRem`, the window's own
 * maximum, when given), Enter resets to the default.
 */
export function sidebarWidthForKey(
  key: string,
  rem: number,
  side: SidebarSide,
  maxRem: number = SIDEBAR_WIDTH_MAX_REM,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return stepSidebarWidth(
        rem,
        side === "left" ? "narrower" : "wider",
        maxRem,
      );
    case "ArrowRight":
      return stepSidebarWidth(
        rem,
        side === "left" ? "wider" : "narrower",
        maxRem,
      );
    case "Home":
      return SIDEBAR_WIDTH_MIN_REM;
    case "End":
      return upperLimit(maxRem);
    case "Enter":
      return SIDEBAR_WIDTH_DEFAULT_REM;
    default:
      return null;
  }
}

/**
 * The width after dragging the edge `deltaPx` pixels from where it started
 * (positive is to the right). Independent of where the sidebar sits, so the
 * EYEON rail's left offset (CHG-2026-135) does not matter.
 */
export function sidebarWidthAfterDrag(
  startRem: number,
  deltaPx: number,
  remPx: number,
  side: SidebarSide,
  maxRem: number = SIDEBAR_WIDTH_MAX_REM,
): number {
  return clampSidebarWidth(
    startRem + (side === "left" ? deltaPx : -deltaPx) / pxPerRem(remPx),
    maxRem,
  );
}

/** What a screen reader says for a width. */
export function sidebarWidthText(rem: number): string {
  const shown = `${Math.round(rem * 100) / 100} rem`;
  return rem === SIDEBAR_WIDTH_DEFAULT_REM ? `${shown}, the default` : shown;
}

// Versioned: a later shape gets a new key rather than misreading this one.
const STORAGE_PREFIX = "cairo.sidebarWidth.v1";
/**
 * The key CHG-2026-142 first kept the width under, one per browser. It is
 * moved, once, to the first person whose own key is absent (loadSidebarWidth).
 */
const LEGACY_STORAGE_KEY = STORAGE_PREFIX;

/** One width per signed-in person, in this browser. */
export function sidebarWidthKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A kept value, made safe; text that is not JSON gives the default. */
function parseStoredWidth(raw: string): number {
  try {
    return sanitiseSidebarWidth(JSON.parse(raw));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT_REM;
  }
}

/** This person's kept width; the default with no person or nothing kept. */
export function readStoredSidebarWidth(
  storage: WidthStorage | null,
  userId: string | undefined,
): number {
  if (!storage || !userId) return SIDEBAR_WIDTH_DEFAULT_REM;
  try {
    const raw = storage.getItem(sidebarWidthKey(userId));
    return raw === null ? SIDEBAR_WIDTH_DEFAULT_REM : parseStoredWidth(raw);
  } catch {
    return SIDEBAR_WIDTH_DEFAULT_REM;
  }
}

/**
 * Keeps this person's width; the default is kept as nothing at all, so a
 * reset leaves no trace. False with no person (nothing is written) or when
 * the browser refused: the width then lasts until the page is reloaded.
 * Always within the fixed limits: the window's maximum is never kept.
 */
export function writeStoredSidebarWidth(
  storage: WidthStorage | null,
  userId: string | undefined,
  rem: number,
): boolean {
  if (!storage || !userId) return false;
  const width = clampSidebarWidth(rem);
  try {
    if (width === SIDEBAR_WIDTH_DEFAULT_REM) {
      storage.removeItem(sidebarWidthKey(userId));
    } else {
      storage.setItem(sidebarWidthKey(userId), JSON.stringify(width));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The width to open with for this person. Their own key when it is there.
 * Otherwise, once: the width this browser kept before widths were per person
 * becomes theirs, written under their key, and the old key is removed (only
 * after their key is written, so a refusal loses nothing). With no person
 * yet, the default, and nothing is read or written.
 *
 * It may write, so it runs when the person is first known; a second run
 * finds their key (or no old key) and only reads.
 */
export function loadSidebarWidth(
  storage: WidthStorage | null,
  userId: string | undefined,
): number {
  if (!storage || !userId) return SIDEBAR_WIDTH_DEFAULT_REM;
  let own: string | null;
  let legacy: string | null;
  try {
    own = storage.getItem(sidebarWidthKey(userId));
    legacy = own === null ? storage.getItem(LEGACY_STORAGE_KEY) : null;
  } catch {
    return SIDEBAR_WIDTH_DEFAULT_REM;
  }
  if (own !== null) return parseStoredWidth(own);
  if (legacy === null) return SIDEBAR_WIDTH_DEFAULT_REM;

  const width = parseStoredWidth(legacy);
  if (writeStoredSidebarWidth(storage, userId, width)) {
    try {
      storage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Left behind: harmless, as it holds the width this person now has.
    }
  }
  return width;
}
