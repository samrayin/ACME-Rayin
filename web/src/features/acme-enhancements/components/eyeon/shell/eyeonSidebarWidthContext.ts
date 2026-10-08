import { createContext, useContext } from "react";

/**
 * ACME (CHG-2026-142, ADR-0026 §12.4): the person's sidebar width, from
 * EyeonSidebarProvider to the resize handle on the sidebar's inner edge and
 * to the top bar's user menu (its "Reset sidebar width" item).
 *
 * Its own module, free of sidebar.tsx, so sidebar.tsx can read it without
 * an import cycle (EyeonSidebarProvider imports sidebar.tsx).
 */
export type EyeonSidebarWidthControl = {
  /** The width on screen, in rem: the kept width, within `maxWidth`. */
  width: number;
  /**
   * The width this person keeps, in rem. Wider than `width` when the window
   * is too narrow for it; it shows again when the window is wide enough.
   */
  keptWidth: number;
  /** The widest the sidebar may be in this window, in rem. */
  maxWidth: number;
  /** False on a handheld screen, where a drag edge needs too fine a pointer. */
  resizable: boolean;
  /** True while the edge is being dragged. */
  resizing: boolean;
  /** Shows a width while dragging, without keeping it. */
  preview: (rem: number) => void;
  /** Ends a preview without keeping it: the kept width shows again. */
  cancelPreview: () => void;
  /** Shows and keeps a width (the default is kept as nothing). */
  commit: (rem: number) => void;
  setResizing: (resizing: boolean) => void;
};

export const EyeonSidebarWidthContext =
  createContext<EyeonSidebarWidthControl | null>(null);

/** Null outside EyeonSidebarProvider: there the sidebar stays as upstream has it. */
export function useEyeonSidebarWidth(): EyeonSidebarWidthControl | null {
  return useContext(EyeonSidebarWidthContext);
}
