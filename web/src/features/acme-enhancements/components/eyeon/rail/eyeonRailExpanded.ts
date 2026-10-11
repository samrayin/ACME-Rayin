import { isTypingTarget } from "@/src/features/scores/lib/keyboardShortcuts";

/**
 * ACME (CHG-2026-150, ADR-0026 §12.5): whether the EYEON rail is expanded
 * (each category's icon with its name beside it) or compact (the name under
 * the icon), and the keyboard shortcut that switches between the two.
 *
 * Kept in this browser only, per signed-in person, like the sidebar's width
 * (CHG-2026-142): never sent to the server. Compact is the default and is
 * kept as nothing at all, so nothing is stored until a person expands the
 * rail. The storage helpers take the storage as an argument, guard every read
 * and write, and never throw.
 */

// Versioned: a later shape gets a new key rather than misreading this one.
const STORAGE_PREFIX = "cairo.railExpanded.v1";
const EXPANDED = "true";

/** One choice per signed-in person, in this browser. */
export function railExpandedKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Whether this person keeps the rail expanded. Compact with no person yet,
 * with nothing kept, with anything other than the expanded value kept, or
 * when the browser refuses storage.
 */
export function readRailExpanded(
  storage: FlagStorage | null,
  userId: string | undefined,
): boolean {
  if (!storage || !userId) return false;
  try {
    return storage.getItem(railExpandedKey(userId)) === EXPANDED;
  } catch {
    return false;
  }
}

/**
 * Keeps this person's choice; compact is kept as nothing, so going back to
 * compact leaves no trace. False with no person (nothing is written) or when
 * the browser refused: the choice then lasts while the rail is on screen.
 */
export function writeRailExpanded(
  storage: FlagStorage | null,
  userId: string | undefined,
  expanded: boolean,
): boolean {
  if (!storage || !userId) return false;
  try {
    if (expanded) {
      storage.setItem(railExpandedKey(userId), EXPANDED);
    } else {
      storage.removeItem(railExpandedKey(userId));
    }
    return true;
  } catch {
    return false;
  }
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "defaultPrevented"
  | "target"
>;

/**
 * Ctrl+\ (Cmd+\ on a Mac) expands or collapses the rail. The console's other
 * shortcuts do not use it (Ctrl/Cmd+B collapses the sidebar, Ctrl/Cmd+K opens
 * the command palette, Ctrl/Cmd+I the assistant, Ctrl/Cmd+F searches a
 * list, Ctrl/Cmd+Enter submits), and Chrome, Edge, Firefox and Safari do not
 * bind it by default. The code editor binds it only with Shift or Alt held,
 * so those combinations are left alone.
 *
 * It never fires while typing (a text field, a select, an editor), on a held
 * key's repeats, or when something else has already handled the key. The key
 * is matched by its character, and by its position for keyboards that type
 * the backslash elsewhere.
 */
export function isRailToggleShortcut(event: ShortcutEvent): boolean {
  if (event.repeat || event.defaultPrevented) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.altKey || event.shiftKey) return false;
  if (event.key !== "\\" && event.code !== "Backslash") return false;
  return !isTypingTarget(event.target);
}

/** The shortcut as the tooltip names it. */
export function railShortcutLabel(isMac: boolean): string {
  return isMac ? "⌘\\" : "Ctrl+\\";
}

/** The shortcut for `aria-keyshortcuts`. */
export function railAriaKeyShortcuts(isMac: boolean): string {
  return isMac ? "Meta+\\" : "Control+\\";
}
