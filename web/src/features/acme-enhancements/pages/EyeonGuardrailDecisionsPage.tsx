import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Page from "@/src/components/layouts/page";
import { Card, CardContent } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api, type RouterOutputs } from "@/src/utils/api";
import { EyeonCard } from "@/src/features/acme-enhancements/components/eyeon/EyeonCard";
import {
  EyeonBarList,
  EyeonChartTable,
  EyeonRing,
  EyeonSparkline,
  EyeonStackedBars,
  type EyeonStackSeries,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import { EyeonFlow } from "@/src/features/acme-enhancements/components/eyeon/EyeonFlow";
import {
  EyeonDecisionChip,
  EyeonModeChip,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import { EyeonNotRecorded } from "@/src/features/acme-enhancements/components/eyeon/EyeonHonestLabels";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import { EyeonDecisionFilterBar } from "@/src/features/acme-enhancements/components/EyeonDecisionFilterBar";
import {
  formatRate,
  formatShare,
  interventionLabel,
  modeSplitNote,
} from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";
import {
  BUSIEST_WORDS,
  DAY_MODE_LABEL,
  type DayMode,
  dayMode,
  decisionsHeadline,
  entityTypeLabel,
  filteredHeadline,
  moreCallersText,
  perHundred,
  policyCellCount,
  policyCellText,
  splitText,
} from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";
import {
  type DecisionFilters,
  type DecisionView,
  decisionViewQuery,
  hasKindFilter,
  parseDecisionView,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";
import {
  DECISION_FLOW_COLUMNS,
  type FlowNodeId,
  decisionFlow,
  filtersForStep,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFlow";
import {
  GUARDRAIL_AGENT_MAX_LENGTH,
  formatAgentsParam,
} from "@/src/features/acme-enhancements/utils/guardrailAgentLink";
import { guardrailVerdictLabel } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";

// ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page, the
// Security Analyst's landing page, composed from the EYEON kit
// (components/eyeon). It follows the prototype's decisions page as far as
// the data truthfully allows: what the guardrails decided on gateway
// traffic, where and why. Metadata only; what EYEON does not record says so,
// and nothing is estimated. Individual decisions stay in the decision log.
// CHG-2026-137: page filters kept in the URL (every card follows them), the
// decision flow, decisions over time with a measure toggle and the gateway's
// mode per day, policy type by direction, and the personal-data types.

type Summary = Extract<
  RouterOutputs["eyeonGuardrailDecisions"]["summary"],
  { enabled: true }
>;

type Split = { enforced: number; notEnforced: number };

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

/** The decision log, filtered to one agent; null when the id cannot be linked. */
function agentLogHref(base: string, alias: string): string | null {
  // The log's exact filter splits on commas and drops over-long ids.
  if (alias.includes(",") || alias.length > GUARDRAIL_AGENT_MAX_LENGTH)
    return null;
  const agents = encodeURIComponent(formatAgentsParam([alias]));
  return `${base}/security-logs?tab=guardrails&agents=${agents}`;
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
    <DecisionsContent
      data={summary.data}
      projectId={projectId}
      view={view}
      onViewChange={setView}
    />
  );
}

function total(s: Split): number {
  return s.enforced + s.notEnforced;
}

function DecisionsContent({
  data,
  projectId,
  view,
  onViewChange,
}: {
  data: Summary;
  projectId: string;
  view: DecisionView;
  onViewChange: (view: DecisionView) => void;
}) {
  const base = `/project/${projectId}/acme-enhancements`;
  const f = view.filters;
  const allLogHref = `${base}/security-logs?tab=guardrails`;
  // With a caller chosen, the log opens on that caller's decisions.
  const logHref = (f.caller && agentLogHref(base, f.caller)) || allLogHref;
  const period = `last ${data.windowDays} days`;
  const t = data.totals;
  const kindFiltered = hasKindFilter(f);
  const interventions = {
    enforced:
      t.promptsRefused.enforced +
      t.answersWithheld.enforced +
      t.redactions.enforced,
    notEnforced:
      t.promptsRefused.notEnforced +
      t.answersWithheld.notEnforced +
      t.redactions.notEnforced,
  };
  const setFilters = (filters: DecisionFilters) =>
    onViewChange({ ...view, filters });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-bold">
            {kindFiltered
              ? filteredHeadline({
                  matching: t.checks,
                  checks: data.scope.checks,
                  windowDays: data.windowDays,
                })
              : decisionsHeadline({
                  checks: t.checks,
                  interventions,
                  windowDays: data.windowDays,
                })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <EyeonModeChip mode={data.mode.mode} ceiling={data.mode.ceiling} />
            <Badge
              variant="outline"
              title="Only traffic through the EYEON gateway is checked. Traffic that bypasses it is not."
            >
              Gateway traffic only
            </Badge>
            <Badge
              variant="outline"
              title="This page reads no prompt or answer text and no redacted text. Of the personal-data findings, the database counts only how many redactions found each type."
            >
              Metadata only
            </Badge>
          </div>
        </div>
        <Link href={logHref} className="text-sm underline">
          Open the decision log
        </Link>
      </div>

      <EyeonDecisionFilterBar
        view={view}
        callers={data.callers.listed}
        callersCapped={data.callers.listed.length >= data.callers.limit}
        onChange={onViewChange}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <EyeonKpiTile
          label="Guardrail checks"
          figure={{
            state: "measured",
            value: data.scope.checks.toLocaleString(),
          }}
          subtitle={
            kindFiltered
              ? `${t.checks.toLocaleString()} match the filters, ${period}`
              : `${data.scope.promptChecks.toLocaleString()} prompts and ${data.scope.answerChecks.toLocaleString()} answers, ${period}`
          }
          href={logHref}
          trend={
            <EyeonSparkline
              label="Guardrail checks per UTC day"
              points={data.daily.map((p) => ({
                label: p.day,
                value: p.checks,
              }))}
            />
          }
        />
        <EyeonKpiTile
          label={interventionLabel("promptsRefused", t.promptsRefused)}
          figure={{
            state: "measured",
            value: total(t.promptsRefused).toLocaleString(),
          }}
          subtitle={modeSplitNote(t.promptsRefused)}
          href={logHref}
        />
        <EyeonKpiTile
          label={interventionLabel("answersWithheld", t.answersWithheld)}
          figure={{
            state: "measured",
            value: total(t.answersWithheld).toLocaleString(),
          }}
          subtitle={modeSplitNote(t.answersWithheld)}
          href={logHref}
        />
        <EyeonKpiTile
          label={interventionLabel("redactions", t.redactions)}
          figure={{
            state: "measured",
            value: total(t.redactions).toLocaleString(),
          }}
          subtitle={modeSplitNote(t.redactions)}
          href={logHref}
          trend={
            <EyeonSparkline
              label="Redactions per UTC day"
              points={data.daily.map((p) => ({
                label: p.day,
                value: p.redacted + p.wouldRedact,
              }))}
              tone="redact"
            />
          }
        />
        <JudgeTile data={data} href={`${base}/guardrails`} period={period} />
        <EyeonKpiTile
          label={
            kindFiltered
              ? "Matching decisions in enforce mode"
              : "Decided in enforce mode"
          }
          figure={{
            state: "measured",
            value:
              t.enforcedPct === null
                ? kindFiltered
                  ? "None match"
                  : "No checks"
                : formatShare(t.enforcedPct),
          }}
          subtitle={
            t.enforcedPct === null
              ? `No ${kindFiltered ? "matching decisions" : "guardrail checks"}, ${period}`
              : `${t.enforcedChecks.toLocaleString()} of ${t.checks.toLocaleString()} ${kindFiltered ? "matching decisions" : "checks"}, ${period}`
          }
          href={`${base}/guardrails`}
        />
      </div>

      <FlowCard
        data={data}
        filters={f}
        period={period}
        href={logHref}
        onFilters={setFilters}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <OverTimeCard data={data} href={logHref} period={period} />
        </div>
        <EnforcementCard
          data={data}
          interventions={interventions}
          kindFiltered={kindFiltered}
          href={`${base}/guardrails`}
          period={period}
        />
        <DirectionCard
          data={data}
          kindFiltered={kindFiltered}
          href={logHref}
          period={period}
        />
        <WhyCard data={data} href={logHref} period={period} />
        <BusiestCard
          data={data}
          base={base}
          period={period}
          filters={f}
          onFilters={setFilters}
        />
        <EntityTypesCard
          data={data}
          filters={f}
          href={logHref}
          period={period}
        />
        <div className="min-w-0 lg:col-span-2">
          <NotRecordedCard href={allLogHref} />
        </div>
      </div>
    </div>
  );
}

function JudgeTile({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const j = data.judge;
  const t = data.totals;
  const checks = data.scope.checks;
  // The period's figure follows the filters, against every check in scope;
  // the 24-hour alert figure is the Guardrails page's, for all traffic.
  const periodRate =
    checks > 0
      ? `; ${formatRate(t.noVerdict / checks)} over the ${period}`
      : "";
  return (
    <EyeonKpiTile
      label={`No verdict, last ${j.windowHours} hours`}
      figure={{
        state: "measured",
        value: j.rate === null ? "No checks" : formatRate(j.rate),
      }}
      subtitle={
        j.rate === null
          ? `No guardrail checks in the last ${j.windowHours} hours${periodRate}`
          : `${j.noVerdict.toLocaleString()} of ${j.checks.toLocaleString()} checks without a judge answer${periodRate}`
      }
      delta={
        j.rate === null
          ? undefined
          : j.alert
            ? {
                text: `At or above the ${formatRate(j.alertRate)} alert`,
                tone: "bad",
              }
            : {
                text: `Below the ${formatRate(j.alertRate)} alert`,
                tone: "good",
              }
      }
      href={href}
    />
  );
}

function FlowCard({
  data,
  filters,
  period,
  href,
  onFilters,
}: {
  data: Summary;
  filters: DecisionFilters;
  period: string;
  href: string;
  onFilters: (filters: DecisionFilters) => void;
}) {
  const flow = decisionFlow({
    prompts: data.byDirection.prompts,
    answers: data.byDirection.answers,
    filters,
    period,
  });
  return (
    <EyeonCard
      title="Decision flow"
      subtitle={`Checks flow into prompts and answers, then the guardrail's verdict, then whether the gateway applied it, ${period}. Small steps are magnified so they stay readable; select a step to filter the page.`}
      link={{ href, label: "Open the decision log" }}
      footnote="Blocked and Redacted only where the gateway enforced; otherwise Would block and Would redact."
    >
      {flow.total === 0 ? (
        <p className="text-muted-foreground text-sm">
          {hasKindFilter(filters)
            ? "No decision matches these filters in this period."
            : "No guardrail checks in this period."}
        </p>
      ) : (
        <EyeonFlow
          label={flow.label}
          columns={DECISION_FLOW_COLUMNS}
          nodes={flow.nodes}
          links={flow.links}
          total={flow.total}
          totalName={hasKindFilter(filters) ? "matching decisions" : "checks"}
          tableCaption={`Decision flow, ${period}`}
          onSelect={(id) =>
            onFilters(filtersForStep(id as FlowNodeId, filters))
          }
        />
      )}
    </EyeonCard>
  );
}

type DailyPoint = Summary["daily"][number];
type VerdictKey =
  | "allowed"
  | "blocked"
  | "wouldBlock"
  | "redacted"
  | "wouldRedact"
  | "noVerdict";

/** The interventions, stacked per day: applied ones apart from recorded ones. */
const OVER_TIME_SERIES: (EyeonStackSeries & { key: VerdictKey })[] = [
  {
    key: "blocked",
    name: guardrailVerdictLabel("block", "enforce").label,
    tone: "block",
  },
  {
    key: "wouldBlock",
    name: guardrailVerdictLabel("block", null).label,
    tone: "block",
    muted: true,
  },
  {
    key: "redacted",
    name: guardrailVerdictLabel("redact", "enforce").label,
    tone: "redact",
  },
  {
    key: "wouldRedact",
    name: guardrailVerdictLabel("redact", null).label,
    tone: "redact",
    muted: true,
  },
  {
    key: "noVerdict",
    name: guardrailVerdictLabel("unavailable", null).label,
    tone: "neutral",
  },
];

const ALLOWED_SERIES: EyeonStackSeries & { key: VerdictKey } = {
  key: "allowed",
  name: guardrailVerdictLabel("allow", null).label,
  tone: "allow",
};

type OverTimeMeasure = "interventions" | "all" | "per100";

const MEASURES: { id: OverTimeMeasure; name: string }[] = [
  { id: "interventions", name: "Interventions" },
  { id: "all", name: "All decisions" },
  { id: "per100", name: "Per 100 checks" },
];

/** Per 100 checks of the same day, one decimal; 0 on a day without checks. */
function dayRate(n: number, checks: number): number {
  return checks > 0 ? Math.round((1000 * n) / checks) / 10 : 0;
}

function OverTimeCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const [measure, setMeasure] = useState<OverTimeMeasure>("interventions");
  const series =
    measure === "all"
      ? [ALLOWED_SERIES, ...OVER_TIME_SERIES]
      : OVER_TIME_SERIES;
  const checks = data.daily.reduce((sum, p) => sum + p.checks, 0);
  const value = (p: DailyPoint, key: VerdictKey) =>
    measure === "per100" ? dayRate(p[key], p.checks) : p[key];
  const legendValues =
    measure === "per100"
      ? series.map(
          (s) =>
            `${perHundred(
              data.daily.reduce((sum, p) => sum + p[s.key], 0),
              checks,
            )} per 100 over the period`,
        )
      : undefined;
  const what =
    measure === "all"
      ? "Guardrail decisions"
      : measure === "per100"
        ? "Guardrail interventions per 100 checks"
        : "Guardrail interventions";
  return (
    <EyeonCard
      title="Decisions over time"
      subtitle={`${measure === "all" ? "Every decision" : "Refusals, redactions and checks without a verdict"} per UTC day${measure === "per100" ? ", per 100 checks of the day" : ""}, ${period}, with the gateway's mode underneath.`}
      link={{ href, label: "Open the decision log" }}
      footnote="Blocked and Redacted only where the gateway enforced; otherwise Would block and Would redact. Labels follow each decision's reported mode."
    >
      <div className="flex flex-wrap gap-1" role="group" aria-label="Measure">
        {MEASURES.map((m) => (
          <Button
            key={m.id}
            variant={measure === m.id ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={measure === m.id}
            onClick={() => setMeasure(m.id)}
          >
            {m.name}
          </Button>
        ))}
      </div>
      <EyeonStackedBars
        label={`${what} per UTC day`}
        series={series}
        points={data.daily.map((p) => ({
          label: p.day,
          values: series.map((s) => value(p, s.key)),
        }))}
        legendValues={legendValues}
      />
      <ModeStrip daily={data.daily} />
      <EyeonChartTable
        caption={`${what} per UTC day, ${period}`}
        columns={[
          "Day",
          "Checks",
          "In enforce mode",
          ...series.map((s) =>
            measure === "per100" ? `${s.name} per 100` : s.name,
          ),
        ]}
        rows={data.daily.map((p) => ({
          key: p.day,
          cells: [
            p.day,
            p.checks,
            p.enforcedChecks,
            ...series.map((s) =>
              measure === "per100" ? perHundred(p[s.key], p.checks) : p[s.key],
            ),
          ],
        }))}
      />
    </EyeonCard>
  );
}

const DAY_MODE_TONE: Record<DayMode, string> = {
  enforce: "text-primary-accent",
  mixed: "text-primary-accent",
  record: "text-muted-foreground",
  none: "text-muted-foreground",
};

const DAY_MODE_OPACITY: Record<DayMode, number> = {
  enforce: 1,
  mixed: 0.5,
  record: 0.45,
  none: 0,
};

/**
 * The gateway's mode on each day, under the bars: decided in enforce mode,
 * in record mode (or with no mode reported), both, or no checks. In words in
 * the legend, the accessible name and each day's hover title.
 */
function ModeStrip({ daily }: { daily: DailyPoint[] }) {
  const width = 300;
  const band = daily.length > 0 ? width / daily.length : width;
  const modes = daily.map((p) => dayMode(p.checks, p.enforcedChecks));
  const counts = (Object.keys(DAY_MODE_LABEL) as DayMode[])
    .map((m) => ({ m, n: modes.filter((x) => x === m).length }))
    .filter((c) => c.n > 0);
  const summary = `Gateway mode per UTC day: ${counts
    .map(
      (c) => `${DAY_MODE_LABEL[c.m]} on ${c.n} ${c.n === 1 ? "day" : "days"}`,
    )
    .join(", ")}.`;
  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${width} 6`}
        preserveAspectRatio="none"
        className="h-1.5 w-full"
        aria-hidden
      >
        <rect width={width} height={6} rx={3} className="fill-muted" />
        {daily.map((p, i) => {
          const mode = modes[i]!;
          return (
            <rect
              key={p.day}
              x={i * band + 0.5}
              width={Math.max(0, band - 1)}
              height={6}
              className={DAY_MODE_TONE[mode]}
              fill="currentColor"
              fillOpacity={DAY_MODE_OPACITY[mode]}
            >
              <title>{`${p.day}: ${DAY_MODE_LABEL[mode]}${
                mode === "mixed"
                  ? `, ${p.enforcedChecks.toLocaleString()} of ${p.checks.toLocaleString()} checks in enforce mode`
                  : ""
              }`}</title>
            </rect>
          );
        })}
      </svg>
      <p className="text-muted-foreground text-xs">{summary}</p>
    </div>
  );
}

const MODE_NOTE = {
  enforce:
    "Enforce mode now: a refused prompt stops the request, and a redaction sends redacted text to the model.",
  record:
    "Record mode now: decisions are recorded, and every request still reaches the model unchanged.",
  none: "No guardrail settings are stored in EYEON yet: treat every decision as not applied.",
} as const;

function EnforcementCard({
  data,
  interventions,
  kindFiltered,
  href,
  period,
}: {
  data: Summary;
  interventions: Split;
  kindFiltered: boolean;
  href: string;
  period: string;
}) {
  const t = data.totals;
  const pct = t.enforcedPct;
  const what = kindFiltered ? "matching decisions" : "guardrail checks";
  const blocks = {
    enforced: t.promptsRefused.enforced + t.answersWithheld.enforced,
    notEnforced: t.promptsRefused.notEnforced + t.answersWithheld.notEnforced,
  };
  const rows = [
    {
      key: "block-applied",
      action: "block",
      mode: "enforce",
      n: blocks.enforced,
    },
    {
      key: "block-recorded",
      action: "block",
      mode: null,
      n: blocks.notEnforced,
    },
    {
      key: "redact-applied",
      action: "redact",
      mode: "enforce",
      n: t.redactions.enforced,
    },
    {
      key: "redact-recorded",
      action: "redact",
      mode: null,
      n: t.redactions.notEnforced,
    },
  ] as const;
  return (
    <EyeonCard
      title="Enforced or recorded only"
      subtitle="What the gateway applied, and what it only recorded and let through, by the mode it reported with each decision."
      link={{ href, label: "Open Guardrails" }}
      footnote="Would block and Would redact: record mode, or no mode reported."
    >
      <EyeonModeChip mode={data.mode.mode} ceiling={data.mode.ceiling} />
      <EyeonRing
        label={
          pct === null
            ? `No ${what} ${period}, so no share decided in enforce mode.`
            : `${formatShare(pct)} of ${what} decided in enforce mode, ${period}.`
        }
        fraction={pct === null ? null : pct / 100}
        centerText={pct === null ? "None" : formatShare(pct)}
        caption={`of ${what} decided in enforce mode, ${period}`}
      />
      <table className="w-full text-sm">
        <caption className="sr-only">
          Refusals and redactions, applied or recorded only, {period}
        </caption>
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th scope="col" className="py-1 text-left font-bold">
              Decision
            </th>
            <th scope="col" className="py-1 text-right font-bold">
              Checks
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="py-1.5">
                <EyeonDecisionChip action={r.action} mode={r.mode} />
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.n.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground text-xs">
        {total(interventions) === 0
          ? "No refusals or redactions in this view."
          : `Refusals and redactions: ${modeSplitNote(interventions).toLowerCase()}.`}{" "}
        {MODE_NOTE[data.mode.mode ?? "none"]}
      </p>
    </EyeonCard>
  );
}

function DirectionCard({
  data,
  kindFiltered,
  href,
  period,
}: {
  data: Summary;
  kindFiltered: boolean;
  href: string;
  period: string;
}) {
  const { prompts, answers } = data.byDirection;
  const { promptChecks, answerChecks } = data.scope;
  const rows = [
    {
      key: "allow",
      action: "allow",
      mode: null,
      p: prompts.allowed,
      a: answers.allowed,
    },
    {
      key: "block-applied",
      action: "block",
      mode: "enforce",
      p: prompts.blocked.enforced,
      a: answers.blocked.enforced,
    },
    {
      key: "block-recorded",
      action: "block",
      mode: null,
      p: prompts.blocked.notEnforced,
      a: answers.blocked.notEnforced,
    },
    {
      key: "redact-applied",
      action: "redact",
      mode: "enforce",
      p: prompts.redacted.enforced,
      a: answers.redacted.enforced,
    },
    {
      key: "redact-recorded",
      action: "redact",
      mode: null,
      p: prompts.redacted.notEnforced,
      a: answers.redacted.notEnforced,
    },
    {
      key: "unavailable",
      action: "unavailable",
      mode: null,
      p: prompts.noVerdict,
      a: answers.noVerdict,
    },
  ] as const;
  return (
    <EyeonCard
      title="Prompts and answers"
      subtitle={`Prompts are checked on the way in, answers on the way out, ${period}. A blocked prompt is refused; a blocked answer is withheld.`}
      link={{ href, label: "Open the decision log" }}
      footnote={
        kindFiltered
          ? "Decisions that match the filters, per 100 of every check in the same direction."
          : "Per 100 checks in the same direction."
      }
    >
      <table className="w-full text-sm">
        <caption className="sr-only">
          Guardrail decisions on prompts and on answers, {period}
        </caption>
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th scope="col" className="py-1 text-left font-bold">
              Decision
            </th>
            <th scope="col" className="py-1 text-right font-bold">
              Prompts
            </th>
            <th scope="col" className="py-1 text-right font-bold">
              Answers
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b">
              <td className="py-1.5">
                <EyeonDecisionChip action={r.action} mode={r.mode} />
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.p.toLocaleString()}
                <span className="text-muted-foreground block text-xs">
                  {perHundred(r.p, promptChecks)}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.a.toLocaleString()}
                <span className="text-muted-foreground block text-xs">
                  {perHundred(r.a, answerChecks)}
                </span>
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1.5 text-left font-bold">
              Checks
            </th>
            <td className="py-1.5 text-right font-bold tabular-nums">
              {promptChecks.toLocaleString()}
            </td>
            <td className="py-1.5 text-right font-bold tabular-nums">
              {answerChecks.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
    </EyeonCard>
  );
}

function WhyCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const rows = data.policyByDirection;
  const { promptChecks, answerChecks } = data.scope;
  const onPrompts = rows.reduce(
    (sum, r) => sum + policyCellCount(r.prompts),
    0,
  );
  const onAnswers = rows.reduce(
    (sum, r) => sum + policyCellCount(r.answers),
    0,
  );
  const all = onPrompts + onAnswers;
  return (
    <EyeonCard
      title="Why: policy and direction"
      subtitle={`Which policy types drew refusals and redactions, on prompts and on answers, ${period}, by the policy label the guardrail reported.`}
      link={{ href, label: "Open the decision log" }}
      footnote="Per 100 checks in the same direction. One label per decision; no finer reason is recorded. An unknown label counts as Other."
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No refusal or redaction in this view.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            On prompts {onPrompts.toLocaleString()} (
            {formatShare((100 * onPrompts) / all)}), on answers{" "}
            {onAnswers.toLocaleString()} ({formatShare((100 * onAnswers) / all)}
            ).
          </p>
          <table className="w-full text-sm">
            <caption className="sr-only">
              Refusals and redactions by policy type and direction, with the
              rate per 100 checks in that direction, {period}
            </caption>
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th scope="col" className="py-1 text-left font-bold">
                  Policy type
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  Prompts
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  Answers
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.type} className="border-b align-top last:border-0">
                  <th scope="row" className="py-1.5 text-left">
                    {r.label}
                  </th>
                  {(
                    [
                      [r.prompts, promptChecks],
                      [r.answers, answerChecks],
                    ] as const
                  ).map(([cell, checks], i) => {
                    const n = policyCellCount(cell);
                    return (
                      <td
                        key={i === 0 ? "prompts" : "answers"}
                        className="py-1.5 text-right tabular-nums"
                      >
                        {n.toLocaleString()}
                        <span className="text-muted-foreground block text-xs">
                          {perHundred(n, checks)} per 100
                        </span>
                        {n > 0 ? (
                          <span className="text-muted-foreground block text-xs">
                            {policyCellText(cell)}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </EyeonCard>
  );
}

/** A count's segments: applied, and recorded only, in the log's words. */
function verdictSegments(
  verdict: Summary["busiest"]["verdict"],
  split: Split,
): (EyeonStackSeries & { value: number })[] {
  if (verdict === "allow" || verdict === "unavailable")
    return [
      {
        name: guardrailVerdictLabel(verdict, null).label,
        value: total(split),
        tone: verdict === "allow" ? "allow" : "neutral",
      },
    ];
  const tone = verdict === "block" ? ("block" as const) : ("redact" as const);
  return [
    {
      name: guardrailVerdictLabel(verdict, "enforce").label,
      value: split.enforced,
      tone,
    },
    {
      name: guardrailVerdictLabel(verdict, null).label,
      value: split.notEnforced,
      tone,
      muted: true,
    },
  ];
}

function BusiestCard({
  data,
  base,
  period,
  filters,
  onFilters,
}: {
  data: Summary;
  base: string;
  period: string;
  filters: DecisionFilters;
  onFilters: (filters: DecisionFilters) => void;
}) {
  const {
    shown,
    total: withMatches,
    linksApplications,
    verdict,
  } = data.busiest;
  const words = BUSIEST_WORDS[verdict];
  const more = withMatches - shown.length;
  return (
    <EyeonCard
      title={words.title}
      subtitle={`The callers with the most ${words.counted}, ${period}. For gateway traffic, the caller is the application's key alias.`}
      link={
        linksApplications
          ? { href: `${base}/applications`, label: "Open Applications" }
          : undefined
      }
      footnote={
        linksApplications
          ? "An application is a gateway key lineage, across rotations. Rates are per 100 of the caller's checks."
          : "Shown by key alias. Application screens are linked for roles that can open Applications, while gateway management is on."
      }
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{words.none}</p>
      ) : (
        <EyeonBarList
          label={`${words.title}, ${period}`}
          items={shown.map((b) => {
            const logHref = agentLogHref(base, b.alias);
            const name = b.application ? b.application.name : b.alias;
            const n = total(b.matched);
            return {
              key: b.alias,
              name: b.application ? (
                <Link
                  href={`${base}/applications/${encodeURIComponent(b.application.lineageId)}`}
                  className="font-bold underline"
                >
                  {b.application.name}
                </Link>
              ) : (
                <span className="font-mono">{b.alias}</span>
              ),
              title: b.application ? `${name} (${b.alias})` : b.alias,
              valueText:
                verdict === "block" || verdict === "redact"
                  ? `${n.toLocaleString()} · ${splitText(verdict, b.matched)}`
                  : n.toLocaleString(),
              segments: verdictSegments(verdict, b.matched),
              note: (
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                  {b.application ? (
                    <span className="font-mono">{b.alias}</span>
                  ) : null}
                  <span>
                    {b.per100 === null
                      ? `${b.checks.toLocaleString()} checks, too few to rate`
                      : `${(Math.round(b.per100 * 10) / 10).toFixed(1)} per 100 of ${b.checks.toLocaleString()} checks`}
                  </span>
                  {logHref ? (
                    <Link href={logHref} className="underline">
                      Decisions
                    </Link>
                  ) : null}
                  {filters.caller !== b.alias ? (
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => onFilters({ ...filters, caller: b.alias })}
                    >
                      Filter the page
                    </Button>
                  ) : null}
                </span>
              ),
            };
          })}
        />
      )}
      {more > 0 ? (
        <p className="text-muted-foreground text-xs">
          {moreCallersText(more, verdict)}
        </p>
      ) : null}
    </EyeonCard>
  );
}

function EntityTypesCard({
  data,
  filters,
  href,
  period,
}: {
  data: Summary;
  filters: DecisionFilters;
  href: string;
  period: string;
}) {
  const types = data.entityTypes;
  const redactions = total(data.totals.redactions);
  const otherVerdict = filters.verdict && filters.verdict !== "redact";
  // The owner dropped the prototype's Preview tag on 2026-10-07: these are
  // real counts from the stored findings (CHG-2026-137).
  return (
    <EyeonCard
      title="Personal-data types"
      subtitle={`Which kinds of personal data the redactions found, ${period}. Counts only, never text.`}
      link={{ href, label: "Open the decision log" }}
      footnote="A redaction can find more than one type. Findings are stored only with redactions captured by the audit push. Redacted text stays in the decision log."
    >
      <p className="text-muted-foreground text-xs">
        Counted in the database: only the type and how many redactions found it
        reach this page.
      </p>
      {otherVerdict ? (
        <p className="text-muted-foreground text-sm">
          Entity types come from redactions only. Choose All decisions or a
          redact verdict to see them.
        </p>
      ) : types.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {redactions === 0
            ? "No redaction matches these filters in this period."
            : "None of the matching redactions has stored findings."}
        </p>
      ) : (
        <>
          <EyeonBarList
            label={`Redactions per personal-data type, ${period}`}
            items={types.map((e) => {
              const label = entityTypeLabel(e.type);
              return {
                key: e.type,
                name: label,
                title: label,
                valueText: `${e.count.toLocaleString()} ${e.count === 1 ? "redaction" : "redactions"}`,
                segments: [
                  { name: "Redactions", value: e.count, tone: "redact" },
                ],
              };
            })}
          />
          <EyeonChartTable
            caption={`Redactions per personal-data type, ${period}`}
            columns={["Type", "Redactions", "Per 100 redactions"]}
            rows={types.map((e) => ({
              key: e.type,
              cells: [
                entityTypeLabel(e.type),
                e.count,
                perHundred(e.count, redactions),
              ],
            }))}
          />
        </>
      )}
    </EyeonCard>
  );
}

const NOT_RECORDED = [
  {
    what: "Added latency of the guardrail",
    reason:
      "EYEON does not store how long a guardrail check takes; the gateway logs it only in its own health lines.",
  },
  {
    what: "A finer reason than the policy label",
    reason:
      "The guardrail reports one policy label per decision; no finer subtype is stored.",
  },
  {
    what: "Traffic that bypasses the gateway",
    reason: "Only traffic through the EYEON gateway is checked and recorded.",
  },
] as const;

function NotRecordedCard({ href }: { href: string }) {
  return (
    <EyeonCard
      title="Not on this page"
      subtitle="What EYEON does not record, so this page cannot show it."
      link={{ href, label: "Open the decision log" }}
      footnote="Each decision, with the user and machine as reported by the calling application, is in the decision log."
    >
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        {NOT_RECORDED.map((n) => (
          <li
            key={n.what}
            className="flex flex-wrap items-baseline justify-between gap-2"
          >
            <span>{n.what}</span>
            <EyeonNotRecorded reason={n.reason} />
          </li>
        ))}
      </ul>
    </EyeonCard>
  );
}
