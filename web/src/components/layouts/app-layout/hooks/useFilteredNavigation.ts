/**
 * Hook to filter and process navigation based on user permissions and context
 * Implements memoization to prevent unnecessary recalculations
 */

import { useRouter } from "next/router";
import { useMemo } from "react";
import type { Session } from "next-auth";
import { useEntitlements } from "@/src/features/entitlements/hooks";
import { useUiCustomization } from "@/src/ee/features/ui-customization/useUiCustomization";
import { useLangfuseCloudRegion } from "@/src/features/organizations/hooks";
import { useForceV3Experience } from "@/src/features/v4-migration/useForceV3Experience";
import {
  ROUTES,
  RouteSection,
  type Route,
} from "@/src/components/layouts/routes";
import type { NavigationItem } from "@/src/components/layouts/utilities/routes";
import { applyNavigationFilters } from "../utils/navigationFilters";
import { groupNavigationItems } from "../utils/groupNavigationItems";
import type { NavigationFilterContext } from "../utils/navigationFilters.types";
import { isPathActive } from "../utils/pathClassification";
import { resolveRoutePathname } from "../utils/routePathname";
import { api } from "@/src/utils/api";

/** Organization type from user session (can be null when not in project/org context) */
type Organization =
  | NonNullable<Session["user"]>["organizations"][number]
  | null
  | undefined;

/**
 * Filters and processes navigation items based on:
 * - Project/organization context
 * - User permissions (RBAC)
 * - Plan entitlements
 * - Feature flags
 * - UI customization settings
 *
 * Returns navigation split into main/secondary sections with active states
 *
 * @param session - Current user session
 * @param organization - Current organization object
 * @returns Processed navigation with main, secondary, and flattened arrays
 */
export function useFilteredNavigation(
  session: Session | null,
  organization: Organization,
) {
  const router = useRouter();
  const entitlements = useEntitlements();
  const uiCustomization = useUiCustomization();
  const { isLangfuseCloud } = useLangfuseCloudRegion();
  const { data: cloudStatus } = api.cloudStatus.getStatus.useQuery(undefined, {
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    // Refresh status data every 5 minutes, keep response cached for 5 minutes.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    enabled: isLangfuseCloud,
  });
  const hasActiveCloudIncident =
    cloudStatus?.status === "degraded" || cloudStatus?.status === "downtime";

  const routerProjectId = router.query.projectId as string | undefined;
  const forceV3Experience = useForceV3Experience(routerProjectId);
  const routerOrganizationId = router.query.organizationId as
    | string
    | undefined;

  // Memoize filter context to prevent unnecessary recalculations
  const filterContext = useMemo<NavigationFilterContext>(
    () => ({
      routerProjectId,
      routerOrganizationId,
      session,
      enableExperimentalFeatures:
        session?.environment?.enableExperimentalFeatures ?? false,
      cloudAdmin: Boolean(session?.user?.admin && isLangfuseCloud),
      entitlements,
      uiCustomization,
      isLangfuseCloud,
      hasActiveCloudIncident,
      forceV3Experience,
      currentPath: router.asPath,
    }),
    [
      routerProjectId,
      routerOrganizationId,
      session,
      entitlements,
      uiCustomization,
      router.asPath,
      isLangfuseCloud,
      hasActiveCloudIncident,
      forceV3Experience,
    ],
  );

  // Memoize filtered routes
  const filteredRoutes = useMemo(() => {
    return applyNavigationFilters(ROUTES, filterContext, organization);
  }, [filterContext, organization]);

  // Map filtered routes to NavigationItems with url and isActive
  // This is O(n) - we map directly over filteredRoutes instead of re-iterating ROUTES
  return useMemo(() => {
    const mapRouteToNavigationItem = (route: Route): NavigationItem => {
      const pathname = resolveRoutePathname({
        pathname: route.pathname,
        legacyPathname: route.legacyPathname,
        v4Enabled: session?.user?.v4BetaEnabled === true,
        forceV3Experience,
      });
      const url = pathname
        .replace("[projectId]", routerProjectId ?? "")
        .replace("[organizationId]", routerOrganizationId ?? "");

      // Recursively map nested items (already filtered by applyNavigationFilters)
      const items: NavigationItem[] | undefined = route.items
        ?.map(mapRouteToNavigationItem)
        .filter((item): item is NavigationItem => item !== null);

      return {
        ...route,
        url,
        isActive:
          isPathActive(route.pathname, router.pathname) ||
          Boolean(
            route.legacyPathname &&
            isPathActive(route.legacyPathname, router.pathname),
          ),
        items: items && items.length > 0 ? items : undefined,
      };
    };

    // Map filtered routes to navigation items
    const allItems = filteredRoutes.map(mapRouteToNavigationItem);

    // Split by section and group
    const mainItems = allItems.filter(
      (item) => item.section === RouteSection.Main,
    );
    const secondaryItems = allItems.filter(
      (item) => item.section === RouteSection.Secondary,
    );

    const mainNavigation = groupNavigationItems(mainItems);
    const secondaryNavigation = groupNavigationItems(secondaryItems);

    return {
      mainNavigation,
      secondaryNavigation,
      navigation: [
        ...mainNavigation.flattened,
        ...secondaryNavigation.flattened,
      ],
    };
  }, [
    filteredRoutes,
    routerProjectId,
    routerOrganizationId,
    router.pathname,
    session?.user?.v4BetaEnabled,
    forceV3Experience,
  ]);
}
