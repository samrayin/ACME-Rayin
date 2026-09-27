/* eslint-disable @repo/no-margin-on-root-elements */
"use client";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/components/ui/collapsible";
import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";
import { type RouteGroup } from "@/src/components/layouts/routes";
import useLocalStorage from "@/src/components/useLocalStorage";

const COLLAPSED_GROUPS_STORAGE_KEY = "sidebarCollapsedGroups";

export type NavMainItem = {
  title: string;
  menuNode?: ReactNode;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  label?: string | ReactNode;
  newTab?: boolean;
  items?: {
    title: string;
    url: string;
    isActive?: boolean;
    newTab?: boolean;
  }[];
};

function NavItemContent({ item }: { item: NavMainItem }) {
  return (
    <>
      {item.icon && <item.icon />}
      <span>{item.title}</span>
      {item.label &&
        (typeof item.label === "string" ? (
          <span className="-my-0.5 self-center rounded-sm border px-1 py-0.5 text-xs leading-none break-keep whitespace-nowrap">
            {item.label}
          </span>
        ) : (
          // ReactNode
          item.label
        ))}
    </>
  );
}

export function NavMain({
  items,
  groupExtraContent,
}: {
  items: {
    grouped: Partial<Record<RouteGroup, NavMainItem[]>> | null;
    ungrouped: NavMainItem[];
  };
  /** Extra content rendered at the end of a specific group's menu, inside
      its collapsible body (e.g. the version label under Settings). */
  groupExtraContent?: Partial<Record<RouteGroup, ReactNode>>;
}) {
  // Keyed by group name; a group missing from the map is expanded by default.
  // Persisted so the layout a user settles on survives navigation and reloads.
  const [collapsedGroups, setCollapsedGroups] = useLocalStorage<
    Record<string, boolean>
  >(COLLAPSED_GROUPS_STORAGE_KEY, {});

  // ACME (CHG-2026-081): the group holding the current page opens once when
  // the user arrives in it, so its entry is visible, but the user's own
  // toggle always wins after that. It used to be forced open, which meant it
  // could never be collapsed.
  const activeGroup = items.grouped
    ? Object.entries(items.grouped).find(([, groupItems]) =>
        groupItems.some((item) => item.isActive),
      )?.[0]
    : undefined;
  const openedOnArrival = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (activeGroup === openedOnArrival.current) return;
    openedOnArrival.current = activeGroup;
    if (!activeGroup) return;
    setCollapsedGroups((prev) =>
      prev[activeGroup] ? { ...prev, [activeGroup]: false } : prev,
    );
  }, [activeGroup, setCollapsedGroups]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.ungrouped.map((item) => (
              <SidebarMenuItem key={item.title}>
                {item.menuNode || (
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={item.isActive}
                  >
                    <Link
                      href={item.url}
                      target={item.newTab ? "_blank" : undefined}
                    >
                      <NavItemContent item={item} />
                    </Link>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {items.grouped &&
        Object.entries(items.grouped).map(([group, items]) => {
          const isOpen = !collapsedGroups[group];

          return (
            <Collapsible
              key={group}
              open={isOpen}
              onOpenChange={(open) =>
                setCollapsedGroups((prev) => ({ ...prev, [group]: !open }))
              }
              className="group/collapsible"
            >
              <SidebarGroup>
                <CollapsibleTrigger asChild>
                  {/* A real button (not the label's default div), so the
                      section toggles from the keyboard too. */}
                  <SidebarGroupLabel asChild className="w-full cursor-pointer">
                    <button type="button">
                      {group}
                      <ChevronRight className="ml-auto size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </button>
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((item) => (
                        <SidebarMenuItem key={item.title}>
                          {item.menuNode || (
                            <SidebarMenuButton
                              asChild
                              tooltip={item.title}
                              isActive={item.isActive}
                            >
                              <Link
                                href={item.url}
                                target={item.newTab ? "_blank" : undefined}
                              >
                                <NavItemContent item={item} />
                              </Link>
                            </SidebarMenuButton>
                          )}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                    {groupExtraContent?.[group as RouteGroup]}
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
    </>
  );
}
