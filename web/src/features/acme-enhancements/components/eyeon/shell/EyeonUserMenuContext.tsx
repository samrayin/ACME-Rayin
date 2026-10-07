import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { AppSidebar } from "@/src/components/nav/AppSidebar/AppSidebar";

export type EyeonUserMenuValue = {
  user: ComponentProps<typeof AppSidebar>["user"];
  items: ComponentProps<typeof AppSidebar>["userMenuItems"];
};

export type EyeonUserMenuItem = EyeonUserMenuValue["items"][number];

const EyeonUserMenuContext = createContext<EyeonUserMenuValue | null>(null);

/**
 * ACME (CHG-2026-134): the user menu's person and items, built once by the
 * authenticated layout (the list the sidebar footer used to show) and read by
 * the top bars, which pages render. Outside the authenticated layout there is
 * none, and the top bars keep their previous behaviour.
 */
export function EyeonUserMenuProvider({
  user,
  items,
  children,
}: EyeonUserMenuValue & { children: ReactNode }) {
  return (
    <EyeonUserMenuContext.Provider value={{ user, items }}>
      {children}
    </EyeonUserMenuContext.Provider>
  );
}

/** The user menu for the top bar, or null outside the authenticated layout. */
export function useEyeonUserMenu(): EyeonUserMenuValue | null {
  return useContext(EyeonUserMenuContext);
}
