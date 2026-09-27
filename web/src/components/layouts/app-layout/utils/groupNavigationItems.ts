import {
  ROUTE_GROUP_ORDER,
  type RouteGroup,
} from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";

/** Grouped navigation structure */
export type GroupedNavigation = {
  ungrouped: NavigationItem[];
  grouped: Partial<Record<RouteGroup, NavigationItem[]>> | null;
  flattened: NavigationItem[];
};

/**
 * Groups navigation items by RouteGroup.
 *
 * ACME (CHG-2026-081): the groups are built in ROUTE_GROUP_ORDER, so the
 * record's key order is the order the sidebar renders them in, and the
 * flattened list covers every group (it had left ACME's own group out).
 */
export function groupNavigationItems(
  items: NavigationItem[],
): GroupedNavigation {
  const ungrouped = items.filter((item) => !item.group);
  const grouped: Partial<Record<RouteGroup, NavigationItem[]>> = {};

  for (const group of ROUTE_GROUP_ORDER) {
    const groupItems = items.filter((item) => item.group === group);
    if (groupItems.length > 0) grouped[group] = groupItems;
  }

  const groupedResult = Object.keys(grouped).length > 0 ? grouped : null;
  const groupedItems = ROUTE_GROUP_ORDER.flatMap(
    (group) => grouped[group] ?? [],
  );

  return {
    ungrouped,
    grouped: groupedResult,
    flattened: [...ungrouped, ...groupedItems],
  };
}
