import { type ReactNode } from "react";
import { api } from "@/src/utils/api";

/**
 * ACME (CHG-2026-141, ADR-0026 §12.3): whether ACME AI is switched on for
 * this deployment (CAIRO_ACME_AI_ENABLED, server-only, default off). The flag
 * has no NEXT_PUBLIC_ form, so the console asks acmeChat.status: sign-in
 * only, one boolean, no database read. Off until the server answers, and off
 * if it cannot.
 */
export function useAcmeAiSwitchedOn(): boolean {
  const status = api.acmeChat.status.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  return status.data?.enabled === true;
}

/**
 * Headless gate: passes its children through only while ACME AI is switched
 * on. It asks the server, so mount it only for people who may use ACME AI in
 * the current project (projectAiAssistant:use), as AcmeChatTopbarLauncher
 * and AcmeChatPanelHost do; nobody else sends the query.
 */
export function AcmeAiSwitchedOnGate({ children }: { children: ReactNode }) {
  return useAcmeAiSwitchedOn() ? children : null;
}
