"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { APP_SHELL_CHROME_ROW_CLASS } from "@/src/components/layouts/app-shell-chrome";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { useIsMac } from "@/src/hooks/useIsMac";
import { cn } from "@/src/utils/tailwind";
import { browserLayoutStorage } from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";
import {
  eyeonRailItemKey,
  type EyeonRailCategory,
  type EyeonRailModel,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";
import { useEyeonRailStore } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailStore";
import {
  isRailToggleShortcut,
  railAriaKeyShortcuts,
  railShortcutLabel,
  readRailExpanded,
  writeRailExpanded,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailExpanded";
import {
  EYEON_RAIL_SIDEBAR_OFFSET_CLASS,
  EYEON_RAIL_TRANSITION_CLASS,
  EYEON_RAIL_WIDTH_CLASS,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailLayout";

type RailMode = "compact" | "expanded";

const ITEM_CLASS =
  "group/rail text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground focus-visible:ring-sidebar-ring flex w-full rounded-md focus-visible:ring-2 focus-visible:outline-hidden";

// ACME (CHG-2026-153): in a short window the compact rail
// tightens (a smaller circle and gaps), so the list fits in most windows
// without scrolling. 800px is where the list at full size stops fitting.
const ITEM_LAYOUT_CLASS: Record<RailMode, string> = {
  compact:
    "flex-col items-center gap-1 py-1.5 [@media(max-height:800px)]:gap-0.5 [@media(max-height:800px)]:py-1",
  expanded: "flex-row items-center gap-2 px-1.5 py-1",
};

const CIRCLE_SIZE_CLASS: Record<RailMode, string> = {
  compact: "size-9 [@media(max-height:800px)]:size-8",
  expanded: "size-8",
};

const LABEL_LAYOUT_CLASS: Record<RailMode, string> = {
  // Under the icon, as wide as the rail allows. A name too long for one line
  // ("Observability" in a wide font) breaks inside its highlight rather than
  // running past it.
  // `text-balance` sets a two-line name as two even lines ("Governance" over
  // "Controls"), not a full line and a short one.
  compact:
    "max-w-full px-0.5 text-center text-xs text-balance [overflow-wrap:anywhere]",
  // Beside the icon, on one line.
  expanded: "min-w-0 truncate text-sm",
};

function EyeonRailItem({
  category,
  active,
  mode,
  onChoose,
}: {
  category: EyeonRailCategory;
  active: boolean;
  mode: RailMode;
  onChoose: () => void;
}) {
  const Icon = category.icon;
  const itemRef = useRef<HTMLLIElement>(null);
  // External system: the DOM. In a short window the list scrolls, so the
  // current category is brought into view rather than left below the fold. A
  // no-op where it is already on screen.
  useEffect(() => {
    const element = itemRef.current;
    if (active && element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [active]);
  // "page" when the page on screen belongs to the active category; "true"
  // when the person chose another category's list on this page.
  const ariaCurrent = active
    ? category.containsCurrentPage
      ? "page"
      : "true"
    : undefined;
  const itemClass = cn(ITEM_CLASS, ITEM_LAYOUT_CLASS[mode]);
  const content = (
    <>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          CIRCLE_SIZE_CLASS[mode],
          active &&
            "bg-sidebar-primary text-sidebar-primary-foreground dark:bg-primary dark:text-primary-foreground",
        )}
      >
        <Icon aria-hidden className="size-4.5" />
      </span>
      <span
        title={mode === "expanded" ? category.label : undefined}
        className={cn(
          "rounded-sm px-1 leading-tight",
          LABEL_LAYOUT_CLASS[mode],
          active &&
            "bg-sidebar-accent text-sidebar-accent-foreground dark:bg-primary dark:text-primary-foreground",
        )}
      >
        {category.label}
      </span>
    </>
  );

  return (
    <li ref={itemRef}>
      {category.href ? (
        <Link
          href={category.href}
          aria-current={ariaCurrent}
          className={itemClass}
          onClick={onChoose}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-current={ariaCurrent}
          className={itemClass}
          onClick={onChoose}
        >
          {content}
        </button>
      )}
    </li>
  );
}

/**
 * Renders an item whose own component decides whether it shows (a menuNode,
 * for example an entry behind a server-only flag), out of sight, and records
 * whether it rendered anything. The rail counts it as seen only then, so the
 * item's own gate stays the only gate.
 */
function EyeonRailProbe({
  itemKey,
  node,
}: {
  itemKey: string;
  node: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const setPresence = useEyeonRailStore((state) => state.setPresence);

  // External system: the DOM. The gate inside the node may render later (it
  // can wait for the server), so its output is observed, not read once.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => setPresence(itemKey, element.childElementCount > 0);
    report();
    const observer = new MutationObserver(report);
    observer.observe(element, { childList: true });
    return () => observer.disconnect();
  }, [itemKey, setPresence]);

  return <div ref={ref}>{node}</div>;
}

/**
 * The button at the foot of the rail that expands or collapses it, with the
 * keyboard shortcut named in its tooltip.
 */
function EyeonRailToggle({
  expanded,
  controls,
  onToggle,
}: {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const isMac = useIsMac();
  const label = expanded ? "Collapse navigation" : "Expand navigation";
  const Icon = expanded ? ChevronsLeft : ChevronsRight;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={controls}
          aria-keyshortcuts={railAriaKeyShortcuts(isMac)}
          className="text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground focus-visible:ring-sidebar-ring flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-hidden"
          onClick={onToggle}
        >
          <Icon aria-hidden className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label} ({railShortcutLabel(isMac)})
      </TooltipContent>
    </Tooltip>
  );
}

function loadExpanded(userId: string | undefined) {
  return { userId, expanded: readRailExpanded(browserLayoutStorage(), userId) };
}

/**
 * ACME (CHG-2026-135, ADR-0026 §12.2): the EYEON navigation rail, at the far
 * left beside the sidebar, following the prototype: each category an icon in
 * a circle with its name under it, Settings and Support at the bottom.
 * Choosing a category goes to its first page this person can open, as in the
 * prototype, and shows its own list in the sidebar; choosing the category of
 * the page on screen only shows the list. Desktop only; on a phone the
 * sidebar sheet is unchanged.
 *
 * ACME (CHG-2026-150, ADR-0026 §12.5): the rail can be expanded, each icon
 * with its name beside it on one line, and collapsed again, with the button
 * at its foot or Ctrl+\ (Cmd+\ on a Mac). The choice is kept per signed-in
 * person (`userId`) in this browser and read on the first render, so the
 * rail opens as it was left; compact is the default.
 *
 * The docked sidebar is fixed to the window's left edge, so the rail hands
 * it its width (eyeonRailLayout.ts): the sidebar's panel moves right by it,
 * and its header row, which holds the logo, reaches back over the rail's top
 * row. That row is empty and has no divider, so the logo row reads as one
 * header across the rail and the page list; below it, the rail's own edge
 * divides the two columns.
 */
export function EyeonRail({
  model,
  userId,
}: {
  model: EyeonRailModel;
  userId: string | undefined;
}) {
  const router = useRouter();
  const select = useEyeonRailStore((state) => state.select);
  const navId = useId();

  const [kept, setKept] = useState(() => loadExpanded(userId));
  let current = kept;
  if (kept.userId !== userId) {
    // Another person (or the person now known): their own choice.
    current = loadExpanded(userId);
    setKept(current);
  }
  const expanded = current.expanded;
  const mode: RailMode = expanded ? "expanded" : "compact";

  const toggle = useCallback(() => {
    const next = !expanded;
    setKept({ userId, expanded: next });
    // A refusal (private mode, full storage) or no person yet keeps the
    // choice while the rail stays on screen.
    writeRailExpanded(browserLayoutStorage(), userId, next);
  }, [expanded, userId]);

  // External system: the window's keyboard events, so the shortcut works
  // wherever focus is, except while typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isRailToggleShortcut(event)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Settings and Support are pinned above the button; only the rest scrolls.
  const scrolling = model.categories.filter((category) => !category.bottom);
  const pinned = model.categories.filter((category) => category.bottom);

  const renderCategory = (category: EyeonRailCategory) => (
    <EyeonRailItem
      key={category.id}
      category={category}
      active={category.id === model.activeId}
      mode={mode}
      onChoose={() => select(category.id, router.asPath)}
    />
  );

  return (
    <nav
      id={navId}
      aria-label="Categories"
      data-expanded={expanded}
      className={cn(
        "bg-sidebar h-screen-with-banner hidden shrink-0 flex-col md:flex",
        EYEON_RAIL_TRANSITION_CLASS,
        EYEON_RAIL_SIDEBAR_OFFSET_CLASS,
        EYEON_RAIL_WIDTH_CLASS[mode],
      )}
    >
      {/* The top row: empty, with no divider on its right. The sidebar's
          header row reaches over it, so the logo starts here. */}
      <div aria-hidden className={APP_SHELL_CHROME_ROW_CLASS} />
      <div className="flex min-h-0 flex-1 flex-col border-r">
        {/* ACME (CHG-2026-153): only this list scrolls, in the rail's own
            scrollbar (globals.css, `scrollbar-rail`): a wide grab area, in
            the sidebar's colours, beside the names rather than over them. */}
        <div className="scrollbar-rail flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-0.5 py-1.5">
          <ul className="flex flex-col gap-1">
            {scrolling.map(renderCategory)}
          </ul>
        </div>
        {pinned.length > 0 && (
          <ul className="flex shrink-0 flex-col gap-1 border-t px-0.5 py-1.5">
            {pinned.map(renderCategory)}
          </ul>
        )}
        <div
          className={cn(
            "flex shrink-0 px-1 pt-1 pb-2",
            expanded ? "justify-start pl-2.5" : "justify-center",
          )}
        >
          <EyeonRailToggle
            expanded={expanded}
            controls={navId}
            onToggle={toggle}
          />
        </div>
      </div>
      <div hidden>
        {model.probes.map((item) => (
          <EyeonRailProbe
            key={eyeonRailItemKey(item)}
            itemKey={eyeonRailItemKey(item)}
            node={item.menuNode}
          />
        ))}
      </div>
    </nav>
  );
}
