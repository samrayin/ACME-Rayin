/**
 * ACME (CHG-2026-136, ADR-0028): how each person arranges EYEON Home, the
 * overview: the order of its KPI tiles, the order of its cards, and which of
 * them are hidden. Tiles move among the tiles and cards among the cards.
 *
 * Kept in this browser only, per person and per project, like the personal
 * theme (CHG-2026-074): never sent to the server, so nobody can change what
 * someone else sees. An arrangement only orders and hides what the page
 * already shows; it reads nothing and widens no role.
 *
 * Pure functions, tested without a browser. The storage helpers take the
 * storage as an argument, guard every read and write, and never throw.
 */

export const EYEON_HOME_TILES = [
  "checks",
  "promptsRefused",
  "answersWithheld",
  "redactions",
  "noVerdict",
  "applicationsNeedingAction",
] as const;

export const EYEON_HOME_CARDS = [
  "decisions",
  "enforcement",
  "applications",
  "spend",
  "notRecorded",
] as const;

export type EyeonHomeTileId = (typeof EYEON_HOME_TILES)[number];
export type EyeonHomeCardId = (typeof EYEON_HOME_CARDS)[number];

/** A group of widgets that move among themselves. */
export type ArrangeZone<Id extends string> = {
  /** Every widget of the group, hidden ones included, in the person's order. */
  order: readonly Id[];
  hidden: readonly Id[];
};

export type EyeonHomeLayout = {
  tiles: ArrangeZone<EyeonHomeTileId>;
  cards: ArrangeZone<EyeonHomeCardId>;
};

/** The names the arrange controls use: fixed, whatever the figures say. */
export const EYEON_HOME_TILE_NAMES: Record<EyeonHomeTileId, string> = {
  checks: "Guardrail checks",
  promptsRefused: "Prompts refused",
  answersWithheld: "Answers withheld",
  redactions: "Personal data redacted",
  noVerdict: "No verdict",
  applicationsNeedingAction: "Applications needing action",
};

export const EYEON_HOME_CARD_NAMES: Record<EyeonHomeCardId, string> = {
  decisions: "Guardrail decisions",
  enforcement: "Enforcement",
  applications: "Applications",
  spend: "Spend against budget",
  notRecorded: "Not on this page",
};

export function defaultEyeonHomeLayout(): EyeonHomeLayout {
  return {
    tiles: { order: [...EYEON_HOME_TILES], hidden: [] },
    cards: { order: [...EYEON_HOME_CARDS], hidden: [] },
  };
}

const always = () => true;

/**
 * The widgets on screen, in order: not hidden, and available to this viewer
 * (the spend card, for one, exists only for roles that may see spend).
 */
export function shownWidgets<Id extends string>(
  zone: ArrangeZone<Id>,
  isAvailable: (id: Id) => boolean = always,
): Id[] {
  return zone.order.filter(
    (id) => !zone.hidden.includes(id) && isAvailable(id),
  );
}

/** The hidden widgets this viewer could show again, in their place's order. */
export function hiddenWidgets<Id extends string>(
  zone: ArrangeZone<Id>,
  isAvailable: (id: Id) => boolean = always,
): Id[] {
  return zone.order.filter((id) => zone.hidden.includes(id) && isAvailable(id));
}

/**
 * Moves `id` to `target`'s place: after it when moving forward, before it
 * when moving back, as a drop onto a widget does. Unknown ids, or a widget
 * dropped on itself, leave the group unchanged.
 */
export function moveWidgetTo<Id extends string>(
  zone: ArrangeZone<Id>,
  id: Id,
  target: Id,
): ArrangeZone<Id> {
  const from = zone.order.indexOf(id);
  const to = zone.order.indexOf(target);
  if (id === target || from === -1 || to === -1) return zone;
  const order = zone.order.filter((x) => x !== id);
  const at = order.indexOf(target);
  order.splice(from < to ? at + 1 : at, 0, id);
  return { ...zone, order };
}

/**
 * Moves `id` one place earlier or later among the widgets on screen,
 * stepping over hidden and unavailable ones, so every press visibly moves
 * it. At either end the group is returned unchanged.
 */
export function moveWidget<Id extends string>(
  zone: ArrangeZone<Id>,
  id: Id,
  direction: "earlier" | "later",
  isAvailable: (id: Id) => boolean = always,
): ArrangeZone<Id> {
  const shown = shownWidgets(zone, isAvailable);
  const at = shown.indexOf(id);
  if (at === -1) return zone;
  const neighbour = shown[direction === "earlier" ? at - 1 : at + 1];
  return neighbour === undefined ? zone : moveWidgetTo(zone, id, neighbour);
}

export function hideWidget<Id extends string>(
  zone: ArrangeZone<Id>,
  id: Id,
): ArrangeZone<Id> {
  if (!zone.order.includes(id) || zone.hidden.includes(id)) return zone;
  return { ...zone, hidden: [...zone.hidden, id] };
}

export function showWidget<Id extends string>(
  zone: ArrangeZone<Id>,
  id: Id,
): ArrangeZone<Id> {
  if (!zone.hidden.includes(id)) return zone;
  return { ...zone, hidden: zone.hidden.filter((x) => x !== id) };
}

function sanitiseZone<Id extends string>(
  value: unknown,
  defaults: readonly Id[],
): ArrangeZone<Id> {
  const known = (x: unknown): x is Id =>
    typeof x === "string" && (defaults as readonly string[]).includes(x);
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const uniqueKnown = (list: unknown): Id[] =>
    Array.isArray(list)
      ? list.filter(known).filter((id, index, all) => all.indexOf(id) === index)
      : [];
  const order = uniqueKnown(record.order);
  // A widget the stored order does not name (one added since it was saved)
  // goes back in its default place: right after the nearest widget that
  // comes before it by default, or first if none of those is there.
  defaults.forEach((id, index) => {
    if (order.includes(id)) return;
    const before = defaults
      .slice(0, index)
      .reverse()
      .find((d) => order.includes(d));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id);
  });
  return { order, hidden: uniqueKnown(record.hidden) };
}

/**
 * Keeps only what this page knows: unknown ids and duplicates are dropped,
 * and widgets missing from a stored order come back in their default place.
 * Anything unreadable gives the default arrangement.
 */
export function sanitiseEyeonHomeLayout(value: unknown): EyeonHomeLayout {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    tiles: sanitiseZone(record.tiles, EYEON_HOME_TILES),
    cards: sanitiseZone(record.cards, EYEON_HOME_CARDS),
  };
}

export function isDefaultEyeonHomeLayout(layout: EyeonHomeLayout): boolean {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  return (
    same(layout.tiles.order, EYEON_HOME_TILES) &&
    same(layout.cards.order, EYEON_HOME_CARDS) &&
    layout.tiles.hidden.length === 0 &&
    layout.cards.hidden.length === 0
  );
}

export type CardSpan = 1 | 2 | 3;

/** Each card's preferred width, in the three-column grid of large screens. */
export const EYEON_HOME_CARD_WIDTH: Record<EyeonHomeCardId, CardSpan> = {
  decisions: 2,
  enforcement: 1,
  applications: 2,
  spend: 1,
  notRecorded: 3,
};

function toSpan(n: number): CardSpan {
  if (n >= 3) return 3;
  return n <= 1 ? 1 : 2;
}

/**
 * Lays the cards on screen out in rows of three columns, in order: a card
 * that does not fit the rest of a row starts the next one, and the last card
 * of each row widens to fill it, so no row ends in a gap. The default order
 * gives the overview's own layout: decisions and enforcement; applications
 * and spend (applications full width when spend is not shown); then "Not on
 * this page".
 */
export function cardSpans<Id extends string>(
  shown: readonly Id[],
  preferred: (id: Id) => CardSpan,
): Map<Id, CardSpan> {
  const spans = new Map<Id, CardSpan>();
  let used = 0;
  let last: Id | undefined;
  const closeRow = () => {
    if (last !== undefined)
      spans.set(last, toSpan((spans.get(last) ?? 1) + 3 - used));
    used = 0;
    last = undefined;
  };
  for (const id of shown) {
    const want = preferred(id);
    if (used + want > 3) closeRow();
    spans.set(id, want);
    used += want;
    last = id;
  }
  closeRow();
  return spans;
}

// Versioned: a later shape gets a new key rather than misreading this one.
const STORAGE_PREFIX = "cairo.eyeonHomeLayout.v1";

/** One arrangement per person and per project, in this browser. */
export function eyeonHomeLayoutKey(userId: string, projectId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${projectId}`;
}

type LayoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's localStorage, or null where there is none or it is refused. */
export function browserLayoutStorage(): LayoutStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readEyeonHomeLayout(
  storage: LayoutStorage | null,
  key: string,
): EyeonHomeLayout {
  if (!storage) return defaultEyeonHomeLayout();
  try {
    const raw = storage.getItem(key);
    return raw === null
      ? defaultEyeonHomeLayout()
      : sanitiseEyeonHomeLayout(JSON.parse(raw));
  } catch {
    return defaultEyeonHomeLayout();
  }
}

/** False when the browser refused the write: the arrangement then lasts until the page is left. */
export function writeEyeonHomeLayout(
  storage: LayoutStorage | null,
  key: string,
  layout: EyeonHomeLayout,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function clearEyeonHomeLayout(
  storage: LayoutStorage | null,
  key: string,
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to undo: the page already shows the default arrangement.
  }
}
