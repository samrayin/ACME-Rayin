import Link from "next/link";
import { useRouter } from "next/router";
import Page from "@/src/components/layouts/page";
import { Card, CardContent } from "@/src/components/ui/card";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import { EyeonGuardrailDecisionsContent } from "@/src/features/acme-enhancements/components/EyeonGuardrailDecisionsContent";
import {
  type DecisionView,
  decisionViewQuery,
  parseDecisionView,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";

// ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page, the
// Security Analyst's landing page, composed from the EYEON kit
// (components/eyeon). It follows the prototype's decisions page as far as
// the data truthfully allows: what the guardrails decided on gateway
// traffic, where and why. Metadata only; what EYEON does not record says so,
// and nothing is estimated. Individual decisions stay in the decision log.
// CHG-2026-137: page filters kept in the URL (every card follows them), the
// decision flow, decisions over time with a measure toggle and the gateway's
// mode per day, policy type by direction, and the personal-data types.
// CHG-2026-137 follow-up: the content is drawn by
// components/EyeonGuardrailDecisionsContent.tsx from props, so Storybook can
// show it; this page reads the view from the URL and the figures from the
// server.

const headerProps = {
  title: "Guardrail decisions",
  help: {
    description:
      "What the guardrails decided on gateway traffic in this project: " +
      "the decision flow, decisions by verdict over time, prompts against " +
      "answers, what the gateway applied and what it only recorded, why " +
      "(policy type and direction), the busiest applications, the " +
      "personal-data types redactions found and the judge's no-verdict " +
      "rate. Filters apply to every card. Metadata only; each decision is " +
      "in the decision log.",
  },
};

export default function EyeonGuardrailDecisionsPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <EyeonGuardrailDecisions projectId={projectId} /> : null}
    </Page>
  );
}

function EyeonGuardrailDecisions({ projectId }: { projectId: string }) {
  const router = useRouter();
  // The period and the filters live in the URL, so a view can be shared.
  const view = parseDecisionView(router.query);
  const setView = (next: DecisionView) => {
    router
      .replace({ query: decisionViewQuery(router.query, next) }, undefined, {
        shallow: true,
      })
      .catch(() => {});
  };
  const summary = api.eyeonGuardrailDecisions.summary.useQuery(
    { projectId, windowDays: view.windowDays, filters: view.filters },
    // Keep the previous figures on screen while a new view loads.
    { placeholderData: (previous) => previous },
  );

  if (summary.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }
  if (summary.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load the guardrail decisions: {summary.error.message}
      </div>
    );
  }
  if (!summary.data.enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <p className="text-muted-foreground">
            The EYEON Guardrail decisions page is switched off on this
            deployment.
          </p>
          <Link
            href={`/project/${projectId}/acme-enhancements/security-logs?tab=guardrails`}
            className="underline"
          >
            Open the guardrail decision log
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <EyeonGuardrailDecisionsContent
      data={summary.data}
      projectId={projectId}
      view={view}
      onViewChange={setView}
    />
  );
}
