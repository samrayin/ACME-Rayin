/**
 * ACME (CHG-2026-147, ADR-0030): how each person arranges the EYEON command
 * centre, the project Home: which widgets show, in which order, at which
 * width, and which view (lens) the arrangement started from.
 *
 * Kept in this browser only, per person and per project, like ADR-0028's
 * arrangement and the personal theme (CHG-2026-074): never sent to the
 * server, so nobody can change what someone else sees. An arrangement only
 * orders, sizes and hides what the page already shows; it reads nothing and
 * widens no role.
 *
 * Pure functions, tested without a browser. The storage helpers take the
 * storage as an argument, guard every read and write, and never throw.
 */
import {
  type ArrangeZone,
  type CardSpan,
  sanitiseZone,
} from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";

export const COMMAND_WIDGETS = [
  "attention",
  "posture",
  "stopped",
  "spend",
  "adoption",
  "gateway",
  "threats",
  "integrity",
  "topApps",
  "appRisk",
  "modelMix",
  "budgets",
  "notRecorded",
] as const;

export type CommandWidgetId = (typeof COMMAND_WIDGETS)[number];

/** The names every arrange control uses: fixed, whatever the figures say. */
export const COMMAND_WIDGET_NAMES: Record<CommandWidgetId, string> = {
  attention: "Needs your attention",
  posture: "Guardrail posture",
  stopped: "Risks stopped and let through",
  spend: "Spend this month",
  adoption: "AI adoption",
  gateway: "Gateway and models",
  threats: "What the guardrails caught",
  integrity: "Control integrity",
  topApps: "Top applications",
  appRisk: "Applications at risk",
  modelMix: "Model mix",
  budgets: "Closest to budget",
  notRecorded: "What EYEON cannot see",
};

/** Each widget's width by default, in the three-column grid of large screens. */
const DEFAULT_SIZE: Record<CommandWidgetId, CardSpan> = {
  attention: 2,
  posture: 1,
  stopped: 2,
  spend: 1,
  adoption: 1,
  gateway: 1,
  threats: 2,
  integrity: 1,
  topApps: 2,
  appRisk: 1,
  modelMix: 1,
  budgets: 1,
  notRecorded: 2,
};

/**
 * The views a person can start from. Everything shows every widget; the
 * executive view leads with money and adoption; the security view with
 * posture, what was caught and whether the controls hold.
 */
export const COMMAND_LENSES = ["everything", "executive", "security"] as const;
export type CommandLens = (typeof COMMAND_LENSES)[number];

export const COMMAND_LENS_NAMES: Record<CommandLens | "custom", string> = {
  everything: "Everything",
  executive: "Executive",
  security: "Security",
  custom: "Your arrangement",
};

type LensPreset = { order: CommandWidgetId[]; hidden: CommandWidgetId[] };

/** Widgets a preset does not name keep their default place, after it. */
const LENS_PRESETS: Record<CommandLens, LensPreset> = {
  everything: { order: [...COMMAND_WIDGETS], hidden: [] },
  executive: {
    order: [
      "attention",
      "spend",
      "adoption",
      "topApps",
      "posture",
      "stopped",
      "appRisk",
      "budgets",
      "modelMix",
      "gateway",
    ],
    hidden: ["threats", "integrity", "notRecorded"],
  },
  security: {
    order: [
      "attention",
      "posture",
      "stopped",
      "integrity",
      "threats",
      "gateway",
      "appRisk",
      "notRecorded",
    ],
    hidden: ["spend", "adoption", "topApps", "modelMix", "budgets"],
  },
};

export type CommandLayout = {
  /** The view the arrangement came from; "custom" once the person changes it. */
  lens: CommandLens | "custom";
  widgets: ArrangeZone<CommandWidgetId>;
  /** Widths the person chose; a widget not named here has its default. */
  sizes: Partial<Record<CommandWidgetId, CardSpan>>;
};

export function lensLayout(lens: CommandLens): CommandLayout {
  const preset = LENS_PRESETS[lens];
  return {
    lens,
    widgets: sanitiseZone(
      { order: preset.order, hidden: preset.hidden },
      COMMAND_WIDGETS,
    ),
    sizes: {},
  };
}

export function defaultCommandLayout(): CommandLayout {
  return lensLayout("everything");
}

export function widgetSize(
  layout: CommandLayout,
  id: CommandWidgetId,
): CardSpan {
  return layout.sizes[id] ?? DEFAULT_SIZE[id];
}

/**
 * One step wider or narrower: a third, two thirds, the full width. At either
 * end the layout is returned unchanged.
 */
export function resizeWidget(
  layout: CommandLayout,
  id: CommandWidgetId,
  direction: "wider" | "narrower",
): CommandLayout {
  const now = widgetSize(layout, id);
  const next = direction === "wider" ? now + 1 : now - 1;
  if (next < 1 || next > 3) return layout;
  return {
    ...layout,
    lens: "custom",
    sizes: { ...layout.sizes, [id]: next as CardSpan },
  };
}

/** A change to the order or the hidden list: the view becomes the person's own. */
export function withWidgets(
  layout: CommandLayout,
  widgets: ArrangeZone<CommandWidgetId>,
): CommandLayout {
  return { ...layout, lens: "custom", widgets };
}

const SIZE_WORDS: Record<CardSpan, string> = {
  1: "a third of the width",
  2: "two thirds of the width",
  3: "the full width",
};

export function sizeWords(size: CardSpan): string {
  return SIZE_WORDS[size];
}

const isLens = (value: unknown): value is CommandLens =>
  typeof value === "string" &&
  (COMMAND_LENSES as readonly string[]).includes(value);

/**
 * Keeps only what this page knows. Unknown widgets, duplicates and widths
 * outside one to three are dropped; widgets missing from a stored order come
 * back in their default place. Anything unreadable gives the default.
 */
export function sanitiseCommandLayout(value: unknown): CommandLayout {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawSizes =
    record.sizes && typeof record.sizes === "object"
      ? (record.sizes as Record<string, unknown>)
      : {};
  const sizes: Partial<Record<CommandWidgetId, CardSpan>> = {};
  for (const id of COMMAND_WIDGETS) {
    const size = rawSizes[id];
    if (size === 1 || size === 2 || size === 3) sizes[id] = size;
  }
  return {
    lens:
      record.lens === "custom" || isLens(record.lens) ? record.lens : "custom",
    widgets: sanitiseZone(record.widgets, COMMAND_WIDGETS),
    sizes,
  };
}

/** True while the layout is exactly the view it names, unchanged. */
export function isLensLayout(layout: CommandLayout, lens: CommandLens) {
  const preset = lensLayout(lens);
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  return (
    same(layout.widgets.order, preset.widgets.order) &&
    same(
      [...layout.widgets.hidden].sort(),
      [...preset.widgets.hidden].sort(),
    ) &&
    Object.keys(layout.sizes).length === 0
  );
}

// Versioned: a later shape gets a new key rather than misreading this one.
const STORAGE_PREFIX = "cairo.eyeonCommandCentre.v1";

/** One arrangement per person and per project, in this browser. */
export function commandLayoutKey(userId: string, projectId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${projectId}`;
}

type LayoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readCommandLayout(
  storage: LayoutStorage | null,
  key: string,
): CommandLayout {
  if (!storage) return defaultCommandLayout();
  try {
    const raw = storage.getItem(key);
    return raw === null
      ? defaultCommandLayout()
      : sanitiseCommandLayout(JSON.parse(raw));
  } catch {
    return defaultCommandLayout();
  }
}

/** False when the browser refused the write: the arrangement then lasts until the page is left. */
export function writeCommandLayout(
  storage: LayoutStorage | null,
  key: string,
  layout: CommandLayout,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function clearCommandLayout(
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
