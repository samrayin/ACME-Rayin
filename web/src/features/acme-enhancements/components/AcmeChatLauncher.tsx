import { useRouter } from "next/router";
import { MessageCircle } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useHasProjectAccess } from "@/src/features/rbac";
import { cn } from "@/src/utils/tailwind";
import { useAcmeChatPanel } from "@/src/features/acme-enhancements/components/acmeChatPanelStore";

/**
 * Whether to show the ACME AI launcher: inside a project, to roles that may
 * use the assistant. UX only, as in AcmeChatWidget: the server checks the
 * same scope.
 */
export function useIsAcmeChatLauncherVisible(): boolean {
  const router = useRouter();
  const projectId =
    typeof router.query.projectId === "string" ? router.query.projectId : "";
  const canUse = useHasProjectAccess({
    projectId,
    scope: "projectAiAssistant:use",
  });
  return Boolean(projectId) && canUse;
}

/**
 * ACME AI launcher in the top bar (ADR-0015). The panel itself is rendered by
 * AcmeChatWidget in the persistent layout. A floating corner button used to
 * cover page controls (pagers, menus, row actions) in the bottom-right corner.
 * Render it only when useIsAcmeChatLauncherVisible() is true.
 *
 * `compact` is the icon-only variant for the mobile top bar.
 */
export function AcmeChatLauncher({ compact = false }: { compact?: boolean }) {
  const { open, setOpen } = useAcmeChatPanel();

  return (
    <Button
      type="button"
      variant="outline"
      aria-label={open ? "Close ACME AI" : "Open ACME AI"}
      aria-expanded={open}
      aria-controls="acme-ai-panel"
      data-ignore-outside-interaction
      onClick={() => setOpen(!open)}
      className={cn(
        "gap-2",
        compact && "size-9 shrink-0 px-0",
        open && "border-primary-accent bg-primary-accent/10",
      )}
    >
      <MessageCircle className="h-4 w-4" />
      {!compact && <span className="hidden sm:inline">ACME AI</span>}
    </Button>
  );
}
