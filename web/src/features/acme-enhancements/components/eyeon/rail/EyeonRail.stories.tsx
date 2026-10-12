import preview from "@/.storybook/preview";
import { RouteGroup } from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { EyeonRail } from "@/src/features/acme-enhancements/components/eyeon/rail/EyeonRail";
import { buildEyeonRailModel } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";
import { railExpandedKey } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailExpanded";

/**
 * CHG-2026-150 (ADR-0026 §12.5): the EYEON navigation rail, compact (today's
 * rail: each icon in a circle with its name under it) and expanded (each
 * icon with its name beside it on one line). The button at its foot, or
 * Ctrl+\ (Cmd+\ on a Mac), switches between them; the choice is kept for the
 * story's person in this browser's storage, as in the console. Observability
 * is the current page's category, so its long name shows in its highlight.
 * Use the toolbar's theme switch for dark mode.
 *
 * CHG-2026-153 (ADR-0026 §12.6): in a window 800 pixels tall or less the
 * compact rail tightens, and in one 700 pixels tall or less it is a rem
 * wider, its list scrolls in its own scrollbar and Settings and Support stay
 * pinned above the button. Both follow the window, not the story's frame: set
 * the Storybook viewport to a short height to see them.
 *
 * Story-only data: one page per category, every category visible.
 */

const STORY_USER = "storybook-person";

const page = (
  title: string,
  pathname: string,
  group?: RouteGroup,
  isActive = false,
): NavigationItem => ({
  title,
  pathname,
  url: pathname.replace("[projectId]", "demo"),
  isActive,
  group,
});

const ITEMS: NavigationItem[] = [
  page("Home", "/project/[projectId]"),
  page(
    "Guardrails",
    "/project/[projectId]/guardrails",
    RouteGroup.GovernanceControls,
  ),
  page(
    "Tracing",
    "/project/[projectId]/traces",
    RouteGroup.Observability,
    true,
  ),
  page("Datasets", "/project/[projectId]/datasets", RouteGroup.Evaluation),
  page("Prompts", "/project/[projectId]/prompts", RouteGroup.PromptManagement),
  page("Dashboards", "/project/[projectId]/dashboards"),
  page("Logs", "/project/[projectId]/logs", RouteGroup.ReportsLogs),
  page("Settings", "/project/[projectId]/settings", RouteGroup.Settings),
  page("Support", "/project/[projectId]/support", RouteGroup.Support),
];

const MODEL = buildEyeonRailModel({
  navigation: { ungrouped: [], grouped: null, flattened: ITEMS },
  presence: {},
  selected: undefined,
});

/** Keeps (or clears) the story person's choice, and clears it afterwards. */
const keepExpanded = (expanded: boolean) => () => {
  if (expanded) {
    window.localStorage.setItem(railExpandedKey(STORY_USER), "true");
  } else {
    window.localStorage.removeItem(railExpandedKey(STORY_USER));
  }
  return () => window.localStorage.removeItem(railExpandedKey(STORY_USER));
};

const meta = preview.meta({
  component: EyeonRail,
  // Full height and no padding, as beside the sidebar.
  parameters: { layout: "fullscreen" },
});

export const Compact = meta.story({
  beforeEach: keepExpanded(false),
  args: { model: MODEL, userId: STORY_USER },
});

export const Expanded = meta.story({
  beforeEach: keepExpanded(true),
  args: { model: MODEL, userId: STORY_USER },
});
