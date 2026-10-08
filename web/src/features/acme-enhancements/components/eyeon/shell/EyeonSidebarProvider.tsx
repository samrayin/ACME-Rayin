"use client";

import {
  useMemo,
  useState,
  type CSSProperties,
  type PropsWithChildren,
} from "react";
import { SidebarProvider } from "@/src/components/ui/sidebar";
import { useIsHandheld } from "@/src/hooks/use-mobile";
import { browserLayoutStorage } from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";
import {
  SIDEBAR_WIDTH_DEFAULT_REM,
  clampSidebarWidth,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";
import {
  EyeonSidebarWidthContext,
  type EyeonSidebarWidthControl,
} from "@/src/features/acme-enhancements/components/eyeon/shell/eyeonSidebarWidthContext";

// While the edge is dragged: the sidebar follows the pointer at once (its
// width transition would lag behind it), nothing is text-selected, and the
// resize cursor stays wherever the pointer goes.
const RESIZING_CLASS =
  "cursor-col-resize select-none **:cursor-col-resize [&_[data-side]>div]:transition-none";

/**
 * ACME (CHG-2026-142, ADR-0026 §12.4): upstream's SidebarProvider, with the
 * width this person gave the sidebar by dragging its edge. It sets
 * `--sidebar-width` on the provider's own wrapper (its `style` prop), which
 * both the sidebar's gap and its fixed panel use, so the page reflows with it.
 *
 * The width is read from this browser's storage synchronously on the first
 * render, so the sidebar opens at its width with no flash: the authenticated
 * layout only mounts in the browser (the server renders the loading layout).
 * Until a person resizes, no style is set and sidebar.tsx's own width stays.
 * On a phone the sheet keeps its own width, and the collapsed (icon) sidebar
 * its own; neither reads `--sidebar-width` from here.
 *
 * The state lives here rather than in the layout, so a drag re-renders only
 * the provider, not the page inside it.
 */
export function EyeonSidebarProvider({ children }: PropsWithChildren) {
  const [width, setWidth] = useState(() =>
    readStoredSidebarWidth(browserLayoutStorage()),
  );
  const [resizing, setResizing] = useState(false);
  const handheld = useIsHandheld();

  // Stable: they use only state setters, so a drag can hold on to them.
  const actions = useMemo(
    () => ({
      preview: (rem: number) => setWidth(clampSidebarWidth(rem)),
      commit: (rem: number) => {
        const next = clampSidebarWidth(rem);
        setWidth(next);
        // A refusal (private mode, full storage) keeps the width for this page.
        writeStoredSidebarWidth(browserLayoutStorage(), next);
      },
      setResizing,
    }),
    [],
  );

  const control = useMemo<EyeonSidebarWidthControl>(
    () => ({ width, resizable: !handheld, resizing, ...actions }),
    [width, handheld, resizing, actions],
  );

  return (
    <EyeonSidebarWidthContext.Provider value={control}>
      <SidebarProvider
        style={
          width === SIDEBAR_WIDTH_DEFAULT_REM
            ? undefined
            : ({ "--sidebar-width": `${width}rem` } as CSSProperties)
        }
        className={resizing ? RESIZING_CLASS : undefined}
      >
        {children}
      </SidebarProvider>
    </EyeonSidebarWidthContext.Provider>
  );
}
