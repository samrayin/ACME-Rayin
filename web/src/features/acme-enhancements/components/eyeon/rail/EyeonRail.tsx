"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { APP_SHELL_CHROME_ROW_CLASS } from "@/src/components/layouts/app-shell-chrome";
import { cn } from "@/src/utils/tailwind";
import {
  eyeonRailItemKey,
  type EyeonRailCategory,
  type EyeonRailModel,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailModel";
import { useEyeonRailStore } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailStore";

const ITEM_CLASS =
  "group/rail text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-hover-foreground focus-visible:ring-sidebar-ring flex w-full flex-col items-center gap-1 rounded-md px-0.5 py-1.5 focus-visible:ring-2 focus-visible:outline-hidden";

function EyeonRailItem({
  category,
  active,
  onChoose,
}: {
  category: EyeonRailCategory;
  active: boolean;
  onChoose: () => void;
}) {
  const Icon = category.icon;
  // "page" when the page on screen belongs to the active category; "true"
  // when the person chose another category's list on this page.
  const ariaCurrent = active
    ? category.containsCurrentPage
      ? "page"
      : "true"
    : undefined;
  const content = (
    <>
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-full",
          active &&
            "bg-sidebar-primary text-sidebar-primary-foreground dark:bg-primary dark:text-primary-foreground",
        )}
      >
        <Icon aria-hidden className="size-4.5" />
      </span>
      <span
        className={cn(
          "max-w-full rounded-sm px-1 text-center text-xs leading-tight",
          active &&
            "bg-sidebar-accent text-sidebar-accent-foreground dark:bg-primary dark:text-primary-foreground",
        )}
      >
        {category.label}
      </span>
    </>
  );

  return (
    <li>
      {category.href ? (
        <Link
          href={category.href}
          aria-current={ariaCurrent}
          className={ITEM_CLASS}
          onClick={onChoose}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-current={ariaCurrent}
          className={ITEM_CLASS}
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
 * ACME (CHG-2026-135, ADR-0026 §12.2): the EYEON navigation rail, at the far
 * left beside the sidebar, following the prototype: each category an icon in
 * a circle with its name under it, Settings and Support at the bottom.
 * Choosing a category goes to its first page this person can open, as in the
 * prototype, and shows its own list in the sidebar; choosing the category of
 * the page on screen only shows the list. Desktop only; on a phone the
 * sidebar sheet is unchanged.
 *
 * The docked sidebar is fixed to the window's left edge, so the rail moves it
 * right by its own width (the sibling selector below).
 */
export function EyeonRail({ model }: { model: EyeonRailModel }) {
  const router = useRouter();
  const select = useEyeonRailStore((state) => state.select);

  const renderCategory = (category: EyeonRailCategory) => (
    <EyeonRailItem
      key={category.id}
      category={category}
      active={category.id === model.activeId}
      onChoose={() => select(category.id, router.asPath)}
    />
  );

  return (
    <nav
      aria-label="Categories"
      className="bg-sidebar h-screen-with-banner hidden w-22 shrink-0 flex-col border-r md:flex [&~[data-side=left]>.fixed]:left-22"
    >
      <div aria-hidden className={APP_SHELL_CHROME_ROW_CLASS} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
        <ul className="flex flex-col gap-1">
          {model.categories
            .filter((category) => !category.bottom)
            .map(renderCategory)}
        </ul>
        <div className="min-h-4 flex-1" />
        <ul className="flex flex-col gap-1">
          {model.categories
            .filter((category) => category.bottom)
            .map(renderCategory)}
        </ul>
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
