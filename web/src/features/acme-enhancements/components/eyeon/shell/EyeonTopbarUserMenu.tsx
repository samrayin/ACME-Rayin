/* eslint-disable @repo/no-abstracted-overlay-trigger */
"use client";

import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import { Avatar } from "@/src/components/design-system/Avatar/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { assertUnreachable } from "@/src/utils/types";
import {
  type EyeonUserMenuItem,
  type EyeonUserMenuValue,
} from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonUserMenuContext";

type EyeonTopbarUserMenuProps = EyeonUserMenuValue & {
  /** Avatar only, for the mobile top bar. */
  compact?: boolean;
};

function renderMenuItem(item: EyeonUserMenuItem) {
  if (item.type === "submenu") {
    return (
      <DropdownMenuSub key={item.name}>
        <DropdownMenuSubTrigger>
          {item.content ?? item.name}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {item.subItems.map(renderMenuItem)}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  if (item.type === "link") {
    return (
      <DropdownMenuItem key={item.name} asChild>
        <Link href={item.href}>{item.content ?? item.name}</Link>
      </DropdownMenuItem>
    );
  }

  if (item.type === "action") {
    return (
      <DropdownMenuItem key={item.name} onClick={item.onClick}>
        {item.content ?? item.name}
      </DropdownMenuItem>
    );
  }

  return assertUnreachable(item);
}

/**
 * ACME (CHG-2026-134): the user menu in the top bar, at its right edge, where
 * the ACME AI launcher was. It is the block the sidebar footer showed: the
 * person's avatar, name and email, and the same items (account settings, the
 * theme, feature preview, instances, sign out, and so on), built once by the
 * authenticated layout and rendered here as the footer rendered them.
 */
export function EyeonTopbarUserMenu({
  user,
  items,
  compact = false,
}: EyeonTopbarUserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // The name holds the visible text, so the trigger can be named by it.
        aria-label={["User menu", user.name, user.email]
          .filter(Boolean)
          .join(", ")}
        className="hover:bg-accent data-[state=open]:bg-accent focus-visible:ring-ring flex min-w-0 shrink-0 items-center gap-2 rounded-md p-0.5 text-left focus-visible:ring-2 focus-visible:outline-hidden"
      >
        <Avatar
          aria-hidden
          size="lg"
          shape="rounded"
          src={user.avatar}
          displayName={user.name}
        />
        {!compact && (
          <span className="hidden max-w-48 min-w-0 flex-col text-sm leading-tight lg:flex">
            <span className="truncate font-bold" title={user.name}>
              {user.name}
            </span>
            <span
              className="text-muted-foreground truncate text-xs"
              title={user.email}
            >
              {user.email}
            </span>
          </span>
        )}
        {!compact && (
          <ChevronsUpDown className="text-muted-foreground hidden size-4 shrink-0 lg:block" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56 rounded-lg"
        side="bottom"
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar
              size="lg"
              shape="rounded"
              src={user.avatar}
              displayName={user.name}
            />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-bold" title={user.name}>
                {user.name}
              </span>
              <span className="truncate text-xs" title={user.email}>
                {user.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>{items.map(renderMenuItem)}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
