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
  loadSidebarWidth,
  writeStoredSidebarWidth,
} from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";
import { useWindowSidebarMax } from "@/src/features/acme-enhancements/components/eyeon/shell/useWindowSidebarMax";
import {
  EyeonSidebarWidthContext,
  type EyeonSidebarWidthControl,
} from "@/src/features/acme-enhancements/components/eyeon/shell/eyeonSidebarWidthContext";

// While the edge is dragged: the sidebar follows the pointer at once (its
// width transition would lag behind it), nothing is text-selected, and the
// resize cursor stays wherever the pointer goes.
const RESIZING_CLASS =
  "cursor-col-resize select-none **:cursor-col-resize [&_[data-side]>div]:transition-none";

function load(userId: string | undefined) {
  return { userId, width: loadSidebarWidth(browserLayoutStorage(), userId) };
}

/**
 * ACME (CHG-2026-142, ADR-0026 §12.4): upstream's SidebarProvider, with the
 * width this person gave the sidebar by dragging its edge. It sets
 * `--sidebar-width` on the provider's own wrapper (its `style` prop), which
 * both the sidebar's gap and its fixed panel use, so the page reflows with it.
 *
 * The width is kept per signed-in person (`userId`), in this browser's
 * storage, and read synchronously on the first render, so the sidebar opens
 * at its width with no flash: the authenticated layout only mounts in the
 * browser (the server renders the loading layout). With no person yet it is
 * the default and nothing is written. On a narrow window the sidebar shows
 * at most a quarter of it; the kept width is unchanged and shows again when
 * the window is wide enough.
 *
 * Until a person resizes, no style is set and sidebar.tsx's own width stays.
 * On a phone the sheet keeps its own width, and the collapsed (icon) sidebar
 * its own; neither reads `--sidebar-width` from here.
 *
 * The state lives here rather than in the layout, so a drag re-renders only
 * the provider, not the page inside it.
 */
export function EyeonSidebarProvider({
  userId,
  children,
}: PropsWithChildren<{ userId: string | undefined }>) {
  const [kept, setKept] = useState(() => load(userId));
  // The width shown while dragging, before it is kept.
  const [draft, setDraft] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const maxWidth = useWindowSidebarMax();
  const handheld = useIsHandheld();

  let current = kept;
  if (kept.userId !== userId) {
    // Another person (or the person now known): their own width.
    current = load(userId);
    setKept(current);
  }
  const keptWidth = current.width;
  const width = draft ?? clampSidebarWidth(keptWidth, maxWidth);

  // Stable for a person: they use only state setters and the person, so a
  // drag can hold on to them.
  const actions = useMemo(
    () => ({
      preview: (rem: number) => setDraft(clampSidebarWidth(rem)),
      cancelPreview: () => setDraft(null),
      commit: (rem: number) => {
        const next = clampSidebarWidth(rem);
        setDraft(null);
        setKept({ userId, width: next });
        // A refusal (private mode, full storage) or no person yet keeps the
        // width for this page only.
        writeStoredSidebarWidth(browserLayoutStorage(), userId, next);
      },
      setResizing,
    }),
    [userId],
  );

  const control = useMemo<EyeonSidebarWidthControl>(
    () => ({
      width,
      keptWidth,
      maxWidth,
      resizable: !handheld,
      resizing,
      ...actions,
    }),
    [width, keptWidth, maxWidth, handheld, resizing, actions],
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
