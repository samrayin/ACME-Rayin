import { useState } from "react";
import { useSession } from "next-auth/react";
import Page from "@/src/components/layouts/page";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { api, type RouterOutputs } from "@/src/utils/api";
import { EyeonCommandCentre } from "@/src/features/acme-enhancements/components/home/EyeonCommandCentre";
import {
  type CommandCentreInput,
  type HomeSource,
  type HomeSpend,
} from "@/src/features/acme-enhancements/utils/eyeonCommandCentre";

// ACME (CHG-2026-147, ADR-0030): the project Home while
// CAIRO_EYEON_HOME_ENABLED is on (EyeonProjectHome decides who gets it).
// No reads of its own: it asks the EYEON pages' own summaries, each only for
// a viewer whose role opens that page, so every figure is the one the linked
// page shows and no role sees more here than there. A page switched off
// answers "not enabled" without reading anything, and its widgets say so.

type Query<T> = {
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
  data: T | undefined;
};

/** A summary query as a source of the page. */
function source<D extends { enabled: boolean }>(
  allowed: boolean,
  query: Query<D>,
): HomeSource<Extract<D, { enabled: true }>> {
  if (!allowed) return { state: "noAccess" };
  if (query.isError)
    return { state: "error", message: query.error?.message ?? "" };
  if (query.isPending || query.data === undefined) return { state: "loading" };
  return query.data.enabled
    ? { state: "ready", data: query.data as Extract<D, { enabled: true }> }
    : { state: "off" };
}

type SpendSummary = Extract<
  RouterOutputs["eyeonSpend"]["summary"],
  { enabled: true }
>;

/**
 * Spend answers without figures while the gateway's request log is off;
 * then its widgets say so instead of showing zeros.
 */
function spendSource(s: HomeSource<SpendSummary>): HomeSource<HomeSpend> {
  if (s.state !== "ready") return s;
  const { month, period, breakdown, budgets } = s.data;
  return month && period && breakdown && budgets
    ? {
        state: "ready",
        data: { ...s.data, month, period, breakdown, budgets },
      }
    : {
        state: "off",
        reason:
          "The gateway's request log is switched off, so calls and spend are not recorded.",
      };
}

export default function EyeonCommandCentrePage() {
  const projectId = useProjectIdFromURL();
  return (
    <Page headerProps={{ title: "Home" }} scrollable withPadding>
      {projectId ? <CommandCentre projectId={projectId} /> : null}
    </Page>
  );
}

function CommandCentre({ projectId }: { projectId: string }) {
  const session = useSession();
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const range = windowDays === 7 ? "7d" : "30d";
  const canSeeSpend = useHasProjectAccess({
    projectId,
    scope: "llmGatewaySpend:read",
  });
  const canSeeGuardrails = useHasProjectAccess({
    projectId,
    scope: "projectGuardrails:read",
  });
  // Keep the previous figures on screen while a new period loads.
  const options = (enabled: boolean) => ({
    enabled,
    staleTime: 60_000,
    placeholderData: <T,>(previous: T | undefined) => previous,
  });

  const overview = api.eyeonOverview.summary.useQuery(
    { projectId, windowDays },
    options(true),
  );
  const spend = api.eyeonSpend.summary.useQuery(
    { projectId, window: range },
    options(canSeeSpend),
  );
  const health = api.eyeonGatewayHealth.summary.useQuery(
    { projectId, window: range },
    options(true),
  );
  const decisions = api.eyeonGuardrailDecisions.summary.useQuery(
    { projectId, windowDays },
    options(canSeeGuardrails),
  );
  const enforcement = api.eyeonEnforcement.summary.useQuery(
    { projectId, windowDays },
    options(canSeeGuardrails),
  );

  const input: CommandCentreInput = {
    projectId,
    windowDays,
    overview: source(true, overview),
    spend: spendSource(source(canSeeSpend, spend)),
    health: source(true, health),
    decisions: source(canSeeGuardrails, decisions),
    enforcement: source(canSeeGuardrails, enforcement),
  };

  return (
    <EyeonCommandCentre
      input={input}
      userId={session.data?.user?.id}
      viewerName={session.data?.user?.name ?? null}
      onWindowDaysChange={setWindowDays}
    />
  );
}
