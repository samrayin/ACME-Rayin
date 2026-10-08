/**
 * ACME (CHG-2026-142, ADR-0026 §12.4): the width a person gives the docked
 * sidebar by dragging its inner edge, in rem.
 *
 * Kept in this browser only, like the personal theme (CHG-2026-074): never
 * sent to the server. Until a person resizes, nothing is stored and the
 * sidebar keeps sidebar.tsx's own width (`SIDEBAR_WIDTH`, 11.5rem).
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

// Versioned: a later shape gets a new key rather than misreading this one.
const STORAGE_KEY = "cairo.sidebarWidth.v1";

/** Widths are kept to 1/16 rem: one pixel at the default root font size. */
function roundToPixel(rem: number): number {
  return Math.round(rem * 16) / 16;
}

/** Any number to a width within the limits; anything else to the default. */
export function clampSidebarWidth(rem: number): number {
  if (!Number.isFinite(rem)) return SIDEBAR_WIDTH_DEFAULT_REM;
  return Math.min(
    SIDEBAR_WIDTH_MAX_REM,
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
): number {
  return clampSidebarWidth(
    rem +
      (direction === "wider"
        ? SIDEBAR_WIDTH_STEP_REM
        : -SIDEBAR_WIDTH_STEP_REM),
  );
}

export type SidebarSide = "left" | "right";

/**
 * The width a key gives the handle of a sidebar on `side`, or null when the
 * key does nothing. Arrow keys move the edge (right widens a left sidebar),
 * Home and End go to the narrowest and widest, Enter resets to the default.
 */
export function sidebarWidthForKey(
  key: string,
  rem: number,
  side: SidebarSide,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return stepSidebarWidth(rem, side === "left" ? "narrower" : "wider");
    case "ArrowRight":
      return stepSidebarWidth(rem, side === "left" ? "wider" : "narrower");
    case "Home":
      return SIDEBAR_WIDTH_MIN_REM;
    case "End":
      return SIDEBAR_WIDTH_MAX_REM;
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
): number {
  const px = remPx > 0 && Number.isFinite(remPx) ? remPx : 16;
  return clampSidebarWidth(
    startRem + (side === "left" ? deltaPx : -deltaPx) / px,
  );
}

/** What a screen reader says for a width. */
export function sidebarWidthText(rem: number): string {
  const shown = `${Math.round(rem * 100) / 100} rem`;
  return rem === SIDEBAR_WIDTH_DEFAULT_REM ? `${shown}, the default` : shown;
}

type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readStoredSidebarWidth(storage: WidthStorage | null): number {
  if (!storage) return SIDEBAR_WIDTH_DEFAULT_REM;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null
      ? SIDEBAR_WIDTH_DEFAULT_REM
      : sanitiseSidebarWidth(JSON.parse(raw));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT_REM;
  }
}

/**
 * Keeps a width; the default is kept as nothing at all, so a reset leaves no
 * trace. False when the browser refused: the width then lasts until the page
 * is reloaded.
 */
export function writeStoredSidebarWidth(
  storage: WidthStorage | null,
  rem: number,
): boolean {
  if (!storage) return false;
  const width = clampSidebarWidth(rem);
  try {
    if (width === SIDEBAR_WIDTH_DEFAULT_REM) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify(width));
    }
    return true;
  } catch {
    return false;
  }
}
