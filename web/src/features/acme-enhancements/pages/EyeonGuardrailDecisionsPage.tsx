import { useState } from "react";
import Link from "next/link";
import Page from "@/src/components/layouts/page";
import { Card, CardContent } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
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
import {
  EyeonDecisionChip,
  EyeonModeChip,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import { EyeonNotRecorded } from "@/src/features/acme-enhancements/components/eyeon/EyeonHonestLabels";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import {
  formatRate,
  formatShare,
  interventionLabel,
  modeSplitNote,
} from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";
import {
  decisionsHeadline,
  perHundred,
  splitText,
} from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";
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
      "decisions by verdict over time, prompts against answers, what the " +
      "gateway applied and what it only recorded, refusals by policy " +
      "label, the busiest applications and the judge's no-verdict rate. " +
      "Metadata only; each decision is in the decision log.",
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
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const summary = api.eyeonGuardrailDecisions.summary.useQuery(
    { projectId, windowDays },
    // Keep the previous figures on screen while a new period loads.
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
      windowDays={windowDays}
      onWindowDaysChange={setWindowDays}
    />
  );
}

function total(s: Split): number {
  return s.enforced + s.notEnforced;
}

function DecisionsContent({
  data,
  projectId,
  windowDays,
  onWindowDaysChange,
}: {
  data: Summary;
  projectId: string;
  windowDays: 7 | 30;
  onWindowDaysChange: (days: 7 | 30) => void;
}) {
  const base = `/project/${projectId}/acme-enhancements`;
  const logHref = `${base}/security-logs?tab=guardrails`;
  const period = `last ${data.windowDays} days`;
  const t = data.totals;
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-bold">
            {decisionsHeadline({
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
              title="This page reads no prompt or answer text, redacted text or personal-data findings."
            >
              Metadata only
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={logHref} className="text-sm underline">
            Open the decision log
          </Link>
          <Select
            value={String(windowDays)}
            onValueChange={(v) => onWindowDaysChange(v === "30" ? 30 : 7)}
          >
            <SelectTrigger className="w-40" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <EyeonKpiTile
          label="Guardrail checks"
          figure={{ state: "measured", value: t.checks.toLocaleString() }}
          subtitle={`${t.promptChecks.toLocaleString()} prompts and ${t.answerChecks.toLocaleString()} answers, ${period}`}
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
          label="Decided in enforce mode"
          figure={{
            state: "measured",
            value:
              t.enforcedPct === null ? "No checks" : formatShare(t.enforcedPct),
          }}
          subtitle={
            t.enforcedPct === null
              ? `No guardrail checks, ${period}`
              : `${t.enforcedChecks.toLocaleString()} of ${t.checks.toLocaleString()} checks, ${period}`
          }
          href={`${base}/guardrails`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <OverTimeCard data={data} href={logHref} period={period} />
        </div>
        <EnforcementCard
          data={data}
          interventions={interventions}
          href={`${base}/guardrails`}
          period={period}
        />
        <DirectionCard data={data} href={logHref} period={period} />
        <PolicyCard data={data} href={logHref} period={period} />
        <BusiestCard data={data} base={base} period={period} />
        <div className="min-w-0 lg:col-span-3">
          <NotRecordedCard href={logHref} />
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
  const periodRate =
    t.checks > 0
      ? `; ${formatRate(t.noVerdict / t.checks)} over the ${period}`
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

/** The interventions, stacked per day: applied ones apart from recorded ones. */
const OVER_TIME_SERIES: (EyeonStackSeries & {
  key: "blocked" | "wouldBlock" | "redacted" | "wouldRedact" | "noVerdict";
})[] = [
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

function OverTimeCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  return (
    <EyeonCard
      title="Decisions over time"
      subtitle={`Refusals, redactions and checks without a verdict per UTC day, ${period}. Allowed checks are in the table.`}
      link={{ href, label: "Open the decision log" }}
      footnote="Blocked and Redacted only where the gateway enforced; otherwise Would block and Would redact."
    >
      <EyeonStackedBars
        label="Guardrail interventions per UTC day"
        series={OVER_TIME_SERIES}
        points={data.daily.map((p) => ({
          label: p.day,
          values: OVER_TIME_SERIES.map((s) => p[s.key]),
        }))}
      />
      <EyeonChartTable
        caption={`Guardrail decisions per UTC day, ${period}`}
        columns={[
          "Day",
          "Checks",
          "Allowed",
          ...OVER_TIME_SERIES.map((s) => s.name),
        ]}
        rows={data.daily.map((p) => ({
          key: p.day,
          cells: [
            p.day,
            p.checks,
            p.allowed,
            ...OVER_TIME_SERIES.map((s) => p[s.key]),
          ],
        }))}
      />
    </EyeonCard>
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
  href,
  period,
}: {
  data: Summary;
  interventions: Split;
  href: string;
  period: string;
}) {
  const t = data.totals;
  const pct = t.enforcedPct;
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
            ? `No guardrail checks ${period}, so no share decided in enforce mode.`
            : `${formatShare(pct)} of guardrail checks decided in enforce mode, ${period}.`
        }
        fraction={pct === null ? null : pct / 100}
        centerText={pct === null ? "No checks" : formatShare(pct)}
        caption={`of checks decided in enforce mode, ${period}`}
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
          ? "No refusals or redactions in this period."
          : `Refusals and redactions: ${modeSplitNote(interventions).toLowerCase()}.`}{" "}
        {MODE_NOTE[data.mode.mode ?? "none"]}
      </p>
    </EyeonCard>
  );
}

function DirectionCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const { prompts, answers } = data.byDirection;
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
      footnote="Per 100 checks in the same direction."
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
                  {perHundred(r.p, prompts.checks)}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.a.toLocaleString()}
                <span className="text-muted-foreground block text-xs">
                  {perHundred(r.a, answers.checks)}
                </span>
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1.5 text-left font-bold">
              Checks
            </th>
            <td className="py-1.5 text-right font-bold tabular-nums">
              {prompts.checks.toLocaleString()}
            </td>
            <td className="py-1.5 text-right font-bold tabular-nums">
              {answers.checks.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
    </EyeonCard>
  );
}

/** A refusal count's two segments: applied, and recorded only. */
function refusalSegments(split: Split) {
  return [
    {
      name: guardrailVerdictLabel("block", "enforce").label,
      value: split.enforced,
      tone: "block" as const,
    },
    {
      name: guardrailVerdictLabel("block", null).label,
      value: split.notEnforced,
      tone: "block" as const,
      muted: true,
    },
  ];
}

function PolicyCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const types = data.refusalsByType;
  return (
    <EyeonCard
      title="Refusals by policy label"
      subtitle={`Why prompts were refused and answers withheld, ${period}, by the policy label the guardrail reported.`}
      link={{ href, label: "Open the decision log" }}
      footnote="One label per decision; no finer reason is recorded. An unknown label counts as Other."
    >
      {types.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No prompt was refused and no answer withheld in this period.
        </p>
      ) : (
        <EyeonBarList
          label={`Refusals by policy label, ${period}`}
          items={types.map((r) => ({
            key: r.type,
            name: r.label,
            title: r.label,
            valueText: `${r.count.toLocaleString()} · ${splitText("block", r.split)}`,
            segments: refusalSegments(r.split),
            note: (
              <span className="text-muted-foreground text-xs">
                {r.prompts.toLocaleString()} prompts refused,{" "}
                {r.answers.toLocaleString()} answers withheld
              </span>
            ),
          }))}
        />
      )}
    </EyeonCard>
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

function BusiestCard({
  data,
  base,
  period,
}: {
  data: Summary;
  base: string;
  period: string;
}) {
  const { shown, total: withRefusals, linksApplications } = data.busiest;
  const more = withRefusals - shown.length;
  return (
    <EyeonCard
      title="Busiest applications by refusals"
      subtitle={`The callers with the most refused prompts and withheld answers, ${period}. For gateway traffic, the caller is the application's key alias.`}
      link={
        linksApplications
          ? { href: `${base}/applications`, label: "Open Applications" }
          : undefined
      }
      footnote={
        linksApplications
          ? "An application is a gateway key lineage, across rotations."
          : "Shown by key alias. Application screens are linked for roles that can open Applications, while gateway management is on."
      }
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No caller had a refusal in this period.
        </p>
      ) : (
        <EyeonBarList
          label={`Callers with the most refusals, ${period}`}
          items={shown.map((b) => {
            const logHref = agentLogHref(base, b.alias);
            const name = b.application ? b.application.name : b.alias;
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
              valueText: `${total(b.refusals).toLocaleString()} · ${splitText("block", b.refusals)}`,
              segments: refusalSegments(b.refusals),
              note: (
                <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
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
                </span>
              ),
            };
          })}
        />
      )}
      {more > 0 ? (
        <p className="text-muted-foreground text-xs">
          {more === 1
            ? "1 more caller had a refusal."
            : `${more.toLocaleString()} more callers had a refusal.`}
        </p>
      ) : null}
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
    what: "Personal-data types behind redactions",
    reason:
      "The findings are stored with each event only, and this page reads no content, so no aggregate exists.",
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
