import { create } from "zustand";
import { type EyeonRailCategoryId } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";

/**
 * ACME (CHG-2026-135): the rail's state, shared by the rail and the sidebar
 * beside it, which are siblings in the authenticated layout.
 *
 * - `selection`: the category the person chose, and the page they chose it
 *   on. It lapses when the page changes, so the rail follows navigation.
 * - `presence`: for each item whose own component decides whether it shows
 *   (a menuNode), whether it rendered anything, as the rail measured it.
 */
export const useEyeonRailStore = create<{
  selection: { category: EyeonRailCategoryId; path: string } | null;
  presence: Readonly<Record<string, boolean>>;
  select: (category: EyeonRailCategoryId, path: string) => void;
  setPresence: (itemKey: string, present: boolean) => void;
}>((set) => ({
  selection: null,
  presence: {},
  select: (category, path) => set({ selection: { category, path } }),
  setPresence: (itemKey, present) =>
    set((state) =>
      state.presence[itemKey] === present
        ? state
        : { presence: { ...state.presence, [itemKey]: present } },
    ),
}));
