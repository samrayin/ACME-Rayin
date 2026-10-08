import {
  Activity,
  FileChartColumn,
  FlaskConical,
  House,
  LifeBuoy,
  List,
  MessageSquareCode,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { RouteGroup } from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";

/**
 * ACME (CHG-2026-135, ADR-0026 §12.2): the EYEON navigation rail's model.
 *
 * The rail adds no navigation of its own. It sorts the sidebar's own items,
 * which routes.tsx defines and the layout has already filtered for this
 * person (project scopes, organization scope, entitlements, feature flags,
 * product modules, `show`), into the prototype's categories. Access is
 * therefore decided once, by the same filters as before; a category shows only
 * when the person can see at least one of its items; and a route added later
 * lands in its group's category without a change here.
 */

export type EyeonRailCategoryId =
  | "home"
  | "governance"
  | "observability"
  | "evaluation"
  | "prompts"
  | "reports"
  | "logs"
  | "settings"
  | "support";

type EyeonRailCategoryDefinition = {
  id: EyeonRailCategoryId;
  label: string;
  icon: LucideIcon;
  /** Below the gap, at the bottom of the rail. */
  bottom: boolean;
};

/** The prototype's SECTIONS, in its order (shell.js). */
const EYEON_RAIL_CATEGORIES: readonly EyeonRailCategoryDefinition[] = [
  { id: "home", label: "Home", icon: House, bottom: false },
  {
    id: "governance",
    label: "Governance Controls",
    icon: ShieldCheck,
    bottom: false,
  },
  {
    id: "observability",
    label: "Observability",
    icon: Activity,
    bottom: false,
  },
  { id: "evaluation", label: "Evaluation", icon: FlaskConical, bottom: false },
  {
    id: "prompts",
    label: "Prompt Management",
    icon: MessageSquareCode,
    bottom: false,
  },
  { id: "reports", label: "Reports", icon: FileChartColumn, bottom: false },
  { id: "logs", label: "Logs", icon: List, bottom: false },
  { id: "settings", label: "Settings", icon: SlidersHorizontal, bottom: true },
  { id: "support", label: "Support", icon: LifeBuoy, bottom: true },
];

/**
 * Each sidebar group's category. A Record, so a new group fails the type check
 * here until someone places it. "Reports / Logs" holds only Logs today, so it
 * maps to Logs; Reports holds Dashboards (placed below by pathname).
 */
const CATEGORY_OF_GROUP: Record<RouteGroup, EyeonRailCategoryId> = {
  [RouteGroup.GovernanceControls]: "governance",
  [RouteGroup.Observability]: "observability",
  [RouteGroup.Evaluation]: "evaluation",
  [RouteGroup.PromptManagement]: "prompts",
  [RouteGroup.ReportsLogs]: "logs",
  [RouteGroup.Settings]: "settings",
  [RouteGroup.Support]: "support",
};

/**
 * Routes the prototype places by its PAGES `section` rather than by their
 * sidebar group, matched on the route's pathname. Everything else follows its
 * group; an ungrouped route stays above every category's list.
 */
const CATEGORY_OF_PATHNAME: ReadonlyArray<{
  matches: (pathname: string) => boolean;
  category: EyeonRailCategoryId;
}> = [
  // Home is the project home alone. Dashboards are reports (owner's choice,
  // 2026-10-07: Reports holds Dashboards and, later, an executive summary).
  { matches: (p) => p === "/project/[projectId]", category: "home" },
  {
    matches: (p) => p === "/project/[projectId]/dashboards",
    category: "reports",
  },
  // Gateway health sits under Observability, as in the prototype.
  { matches: (p) => p.endsWith("/gateway-health"), category: "observability" },
];

/** The item's category, or null for an item shown above every category. */
export function eyeonRailCategoryOf(
  item: Pick<NavigationItem, "pathname" | "group">,
): EyeonRailCategoryId | null {
  const byPathname = CATEGORY_OF_PATHNAME.find((rule) =>
    rule.matches(item.pathname),
  );
  if (byPathname) return byPathname.category;
  return item.group ? CATEGORY_OF_GROUP[item.group] : null;
}

/** Identifies an item: titles repeat (two Settings), title and path do not. */
export function eyeonRailItemKey(
  item: Pick<NavigationItem, "title" | "pathname">,
): string {
  return `${item.title}|${item.pathname}`;
}

export type EyeonRailNavigation = {
  ungrouped: NavigationItem[];
  grouped: Partial<Record<RouteGroup, NavigationItem[]>> | null;
  flattened: NavigationItem[];
};

export type EyeonRailCategory = EyeonRailCategoryDefinition & {
  items: NavigationItem[];
  /**
   * Where the category goes when chosen: its first page this person can open,
   * as in the prototype. Undefined when the page on screen is already in the
   * category (choosing it then only shows its list), or when none of its
   * entries has a page of its own.
   */
  href: string | undefined;
  /** The page on screen is one of this category's items. */
  containsCurrentPage: boolean;
};

export type EyeonRailModel = {
  /** The categories this person can see, in the rail's order. */
  categories: EyeonRailCategory[];
  /** The category whose list the sidebar shows. */
  activeId: EyeonRailCategoryId | undefined;
  /** The sidebar's items: the active category's, under its name. */
  sidebarNavigation: EyeonRailNavigation;
  /**
   * Items whose own component decides, at render time, whether it shows
   * (a menuNode, such as an entry behind a server-only flag). The rail
   * measures them before counting them as seen.
   */
  probes: NavigationItem[];
};

/**
 * @param navigation the sidebar's main navigation, already filtered for the
 *   person (useFilteredNavigation).
 * @param presence for each menuNode item (by eyeonRailItemKey), whether its
 *   component rendered anything. Unknown counts as not seen.
 * @param selected the category the person chose on this page, if any.
 */
export function buildEyeonRailModel({
  navigation,
  presence,
  selected,
}: {
  navigation: EyeonRailNavigation;
  presence: Readonly<Record<string, boolean>>;
  selected: EyeonRailCategoryId | undefined;
}): EyeonRailModel {
  const aboveEveryList: NavigationItem[] = [];
  const itemsOf = new Map<EyeonRailCategoryId, NavigationItem[]>();
  for (const item of navigation.flattened) {
    const category = eyeonRailCategoryOf(item);
    if (category === null) {
      aboveEveryList.push(item);
    } else {
      itemsOf.set(category, [...(itemsOf.get(category) ?? []), item]);
    }
  }

  const isSeen = (item: NavigationItem) =>
    !item.menuNode || presence[eyeonRailItemKey(item)] === true;

  const categories = EYEON_RAIL_CATEGORIES.flatMap(
    (definition): EyeonRailCategory[] => {
      const items = itemsOf.get(definition.id) ?? [];
      if (!items.some(isSeen)) return [];
      const containsCurrentPage = items.some((item) => item.isActive);
      return [
        {
          ...definition,
          items,
          href: containsCurrentPage
            ? undefined
            : items.find((item) => isSeen(item) && item.url)?.url,
          containsCurrentPage,
        },
      ];
    },
  );

  const active =
    categories.find((category) => category.id === selected) ??
    categories.find((category) => category.containsCurrentPage) ??
    categories.find((category) => category.id === "home") ??
    categories[0];

  // NavMain shows each key of `grouped` as a section name. The category's
  // name is not a RouteGroup value (Reports, Logs, Home), so the key is cast;
  // NavMain only displays it, and Settings keeps its version label because
  // the names match.
  const grouped = active
    ? ({ [active.label]: active.items } as Partial<
        Record<RouteGroup, NavigationItem[]>
      >)
    : null;

  return {
    categories,
    activeId: active?.id,
    sidebarNavigation: {
      ungrouped: aboveEveryList,
      grouped,
      flattened: [...aboveEveryList, ...(active?.items ?? [])],
    },
    probes: [...itemsOf.values()].flat().filter((item) => item.menuNode),
  };
}
