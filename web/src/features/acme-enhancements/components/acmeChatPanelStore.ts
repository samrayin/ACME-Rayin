import { create } from "zustand";

/**
 * Whether the ACME AI panel is open. Shared by its launcher, which lives in
 * the page header and remounts on every navigation, and the panel host in the
 * persistent authenticated layout, which keeps the conversation across pages.
 */
export const useAcmeChatPanel = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
