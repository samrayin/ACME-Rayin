"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  SIDEBAR_WIDTH_MAX_REM,
  SIDEBAR_WIDTH_MIN_REM,
  sidebarWidthAfterDrag,
  sidebarWidthForKey,
  sidebarWidthText,
  type SidebarSide,
} from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";
import type { EyeonSidebarWidthControl } from "@/src/features/acme-enhancements/components/eyeon/shell/eyeonSidebarWidthContext";

/** A press that moves less than this is a click, which toggles the sidebar. */
const DRAG_THRESHOLD_PX = 3;

const HANDLE_CLASS = [
  // Where upstream's rail sits: a 16px strip centred on the inner edge.
  "absolute inset-y-0 z-50 hidden w-4 -translate-x-1/2 group-data-[side=left]:-right-4 group-data-[side=right]:left-0 md:flex",
  "cursor-col-resize touch-none select-none outline-hidden",
  // The line on the edge: on hover, on keyboard focus (wider) and while dragging.
  "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2",
  "hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring focus-visible:after:w-1 data-[resizing=true]:after:bg-sidebar-ring",
].join(" ");

/** Which side the sidebar holding `element` is docked on. */
function sideOf(element: Element): SidebarSide {
  return element.closest("[data-side]")?.getAttribute("data-side") === "right"
    ? "right"
    : "left";
}

function rootFontPx(): number {
  return Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
}

/**
 * ACME (CHG-2026-142, ADR-0026 §12.4): the docked sidebar's inner edge, where
 * upstream's rail was. Dragging it resizes the sidebar; a click (a press that
 * does not move) still collapses it, as the rail did. From the keyboard it is
 * a window splitter: Left and Right arrows step the width, Home and End go to
 * the limits, Enter resets to the default.
 *
 * Rendered by sidebar.tsx's SidebarRail only on desktop while the sidebar is
 * expanded; collapsed, the rail is upstream's own (a click expands it).
 */
export function EyeonSidebarResizeHandle({
  control,
  onToggle,
}: {
  control: EyeonSidebarWidthControl;
  onToggle: () => void;
}) {
  const descriptionId = useId();
  // Set by a drag, so the click that may end it does not also toggle.
  const draggedRef = useRef(false);
  // Removes the window listeners of a drag in progress.
  const stopDragRef = useRef<(() => void) | null>(null);

  // External system: the window listeners a drag adds. If the handle goes
  // away mid-drag (the sidebar collapsed by its shortcut), remove them.
  useEffect(() => () => stopDragRef.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stopDragRef.current?.();
    draggedRef.current = false;
    const side = sideOf(event.currentTarget);
    const startX = event.clientX;
    const startWidth = control.width;
    const remPx = rootFontPx();
    let moved = false;
    let latest = startWidth;

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onEscape);
      stopDragRef.current = null;
      control.setResizing(false);
    };
    function onMove(move: PointerEvent) {
      const delta = move.clientX - startX;
      if (!moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      moved = true;
      draggedRef.current = true;
      latest = sidebarWidthAfterDrag(startWidth, delta, remPx, side);
      control.preview(latest);
    }
    function onUp() {
      stop();
      if (!moved) return;
      control.commit(latest);
      // The click that follows this release, if any, is part of the drag.
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    }
    function onCancel() {
      stop();
      control.preview(startWidth);
    }
    function onEscape(key: KeyboardEvent) {
      if (key.key !== "Escape") return;
      key.preventDefault();
      onCancel();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onEscape);
    stopDragRef.current = stop;
    control.setResizing(true);
  };

  const onClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onToggle();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = sidebarWidthForKey(
      event.key,
      control.width,
      sideOf(event.currentTarget),
    );
    if (next === null) return;
    event.preventDefault();
    control.commit(next);
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={control.width}
        aria-valuemin={SIDEBAR_WIDTH_MIN_REM}
        aria-valuemax={SIDEBAR_WIDTH_MAX_REM}
        aria-valuetext={sidebarWidthText(control.width)}
        aria-describedby={descriptionId}
        tabIndex={0}
        title="Drag to resize, click to collapse"
        data-sidebar="rail"
        data-resizing={control.resizing ? "true" : undefined}
        className={HANDLE_CLASS}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
      <span id={descriptionId} hidden>
        Drag, or press the Left and Right arrow keys, to change the width. Home
        and End go to the narrowest and the widest, and Enter resets it. A click
        collapses the sidebar.
      </span>
    </>
  );
}
