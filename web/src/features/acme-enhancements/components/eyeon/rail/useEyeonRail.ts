import { useRouter } from "next/router";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { api } from "@/src/utils/api";
import {
  buildEyeonRailModel,
  type EyeonRailModel,
  type EyeonRailNavigation,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";
import { useEyeonRailStore } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailStore";

/**
 * Whether the server has the EYEON rail switched on. The flag is server-only
 * (no NEXT_PUBLIC_ form, on purpose), so the client asks, as the EYEON
 * pages' navigation entries do. Off until the answer arrives.
 */
function useEyeonRailFlag(): boolean {
  const status = api.eyeonShell.railStatus.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return status.data?.enabled === true;
}

/**
 * ACME (CHG-2026-135): the rail for the authenticated layout, from the
 * sidebar's own navigation. While CAIRO_EYEON_RAIL_ENABLED is off (the
 * default), on a phone or outside a project, `model` is null and the sidebar
 * gets its navigation unchanged.
 */
export function useEyeonRail(navigation: EyeonRailNavigation): {
  model: EyeonRailModel | null;
  sidebarNavigation: EyeonRailNavigation;
} {
  const router = useRouter();
  const isMobile = useIsMobile();
  const flagOn = useEyeonRailFlag();
  const selection = useEyeonRailStore((state) => state.selection);
  const presence = useEyeonRailStore((state) => state.presence);

  const inProject = typeof router.query.projectId === "string";
  if (!flagOn || isMobile || !inProject) {
    return { model: null, sidebarNavigation: navigation };
  }

  const model = buildEyeonRailModel({
    navigation,
    presence,
    selected:
      selection?.path === router.asPath ? selection.category : undefined,
  });
  return { model, sidebarNavigation: model.sidebarNavigation };
}
