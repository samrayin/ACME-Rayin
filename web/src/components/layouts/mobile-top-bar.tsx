import { type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { Menu } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useSidebar } from "@/src/components/ui/sidebar";
import { TopbarBrand } from "@/src/components/nav/topbar-brand";
import { useHasAppSidebar } from "@/src/components/nav/sidebar-presence";
import { TopbarAccount } from "@/src/components/nav/topbar-account";
import { EnvLabelBadge } from "@/src/components/EnvLabelBadge";
import { useEnvLabel } from "@/src/hooks/useEnvLabel";
import { useEyeonUserMenu } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonUserMenuContext";
import { EyeonTopbarUserMenu } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonTopbarUserMenu";

/**
 * Slim mobile top chrome for the minimal-chrome shell: hamburger · centered
 * Langfuse wordmark · account. Everything page-specific (title, actions,
 * controls, tabs) lives below in the scrollable content (see MobilePageTitle),
 * so this stays a thin, sticky brand bar.
 *
 * Rendered only below `md` (the caller hides it on desktop, where PageHeader
 * takes over). On the sidebar-less MinimalLayout (public shares) there is no
 * hamburger to show — the page's own leadingControl takes the left slot.
 */
export const MobileTopBar = ({
  showSidebarTrigger = true,
  leadingControl,
}: {
  showSidebarTrigger?: boolean;
  leadingControl?: ReactNode;
}) => {
  const { toggleSidebar } = useSidebar();
  const session = useSession();
  const hasAppSidebar = useHasAppSidebar();
  const envLabel = useEnvLabel();
  // ACME (CHG-2026-134): the user menu, from the authenticated layout.
  const eyeonUserMenu = useEyeonUserMenu();
  const showHamburger = showSidebarTrigger && hasAppSidebar;

  return (
    // ACME (CHG-2026-131, ADR-0026): the chrome surface in dark mode.
    <div className="bg-background dark:bg-header flex h-12 items-center gap-2 border-b px-2">
      {/* Left: hamburger (opens the nav sheet) or the page's leading control. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showHamburger ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label="Open menu"
            onClick={() => toggleSidebar()}
          >
            <Menu className="size-5" />
          </Button>
        ) : (
          leadingControl
        )}
        {envLabel.visible && (
          <EnvLabelBadge region={envLabel.region} onClick={envLabel.dismiss} />
        )}
      </div>

      {/* Center: the Langfuse wordmark. */}
      {hasAppSidebar && <TopbarBrand variant="wordmark" />}

      {/* Right: the account. Balances the left slot so the brand stays
          centered. ACME (CHG-2026-134): the ACME AI and assistant launchers
          are removed from EYEON; the full user menu (every item the sidebar
          footer had) replaces the short account menu wherever the
          authenticated layout provides it. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {eyeonUserMenu ? (
          <EyeonTopbarUserMenu {...eyeonUserMenu} compact />
        ) : (
          session.data?.user && <TopbarAccount user={session.data.user} />
        )}
      </div>
    </div>
  );
};
