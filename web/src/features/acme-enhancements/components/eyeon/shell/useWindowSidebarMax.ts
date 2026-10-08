"use client";

import { useEffect, useState } from "react";
import {
  SIDEBAR_WIDTH_MAX_REM,
  sidebarMaxForWindow,
} from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";

/** The root font size in pixels (NaN when unknown; the callers assume 16). */
export function rootFontPx(): number {
  return Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
}

/** The widest the sidebar may be in this window now. */
export function windowSidebarMax(): number {
  if (typeof window === "undefined") return SIDEBAR_WIDTH_MAX_REM;
  return sidebarMaxForWindow(window.innerWidth, rootFontPx());
}

/**
 * ACME (CHG-2026-142 follow-up, owner, 2026-10-08): the widest the sidebar
 * may be in this window, a quarter of it between 11.5rem and 24rem, kept
 * current as the window is resized. Read on the first render, so the sidebar
 * opens within it with no flash.
 */
export function useWindowSidebarMax(): number {
  const [max, setMax] = useState(windowSidebarMax);

  // External system: the window's size. Measured at most once a frame while
  // the window is being resized; the listener and any pending frame are
  // removed when the sidebar goes away.
  useEffect(() => {
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setMax(windowSidebarMax());
    };
    const onResize = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return max;
}
