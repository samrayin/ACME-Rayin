import { Callout } from "@/src/components/design-system/Callout/Callout";
import { DismissController } from "@/src/components/DismissController";
import { Button } from "@/src/components/ui/button";
import { Bot } from "lucide-react";

// ACME (CHG-2026-064): CAIRO branding and an ACME contact link instead of the
// upstream docs link.
const CONTACT_HREF = "mailto:helpdesk@almoayyedcomputers.com";

/**
 * Informational, dismissible banner that highlights support for AI coding
 * agents via the Agent Skill, MCP server, and CLI. Rendered on the
 * organization overview page.
 */
export function AgentToolsBanner() {
  return (
    <DismissController id="agent-tools-banner:v1" family="callouts">
      {({ onDismiss }) => (
        <div className="mb-4">
          <Callout
            variant="info"
            align="middle"
            actions={
              <Button asChild size="sm" variant="secondary">
                <a href={CONTACT_HREF}>Connect with us</a>
              </Button>
            }
            onDismiss={onDismiss}
          >
            <div className="flex items-start gap-2 sm:items-center">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
              <span>
                <span className="font-bold">
                  ACME CAIRO works great with your AI coding agents.
                </span>{" "}
                Connect Claude Code, Codex, and other agents to your data with
                the Langfuse Agent Skill, MCP server, and CLI.
              </span>
            </div>
          </Callout>
        </div>
      )}
    </DismissController>
  );
}
