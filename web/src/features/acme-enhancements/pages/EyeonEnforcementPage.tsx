import { type ReactNode, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  EyeOff,
  Lock,
  MinusCircle,
  type LucideIcon,
} from "lucide-react";
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
import { cn } from "@/src/utils/tailwind";
import { EyeonCard } from "@/src/features/acme-enhancements/components/eyeon/EyeonCard";
import {
  EyeonChartTable,
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
import { EyeonModeScale } from "@/src/features/acme-enhancements/components/eyeon/EyeonModeScale";
import {
  changedByText,
  formatRate,
  formatShare,
} from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";
import { splitText } from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";
import {
  changeTitle,
  enforcementHeadline,
  formatMinutes,
  gatewaysHeadline,
  gatewaysStatus,
  modeMeaning,
  modeName,
  podsHeadline,
  podsStatus,
} from "@/src/features/acme-enhancements/utils/eyeonEnforcementLabels";
import {
  type GatewayMode,
  type GuardrailAction,
} from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";

// ACME (CHG-2026-138, ADR-0027): the EYEON Enforcement and policy page,
// composed from the EYEON kit (components/eyeon). It follows the prototype's
// enforcement page as far as the data truthfully allows: the mode EYEON
// serves against its ceiling, when and to what it changed, who changed it
// and why, whether the guardrail pods and gateway replicas agree, and the
// policies in force. Display only: there is no switch here; the mode is
// changed on the Guardrails page. Metadata only.
//
// Owner decisions of 2026-10-07: who changed the mode is shown as on the
// Guardrails page (changedByText), and the reason as plain text, never as
// HTML; the guardrail pods are counted, never named.

type Summary = Extract<
  RouterOutputs["eyeonEnforcement"]["summary"],
  { enabled: true }
>;

type Split = { enforced: number; notEnforced: number };

const headerProps = {
  title: "Enforcement & policy",
  help: {
    description:
      "Whether EYEON records or enforces on gateway traffic: the mode it " +
      "serves against the deployment ceiling, when the mode changed, to " +
      "what, by whom and why, an enforce trial's switch-back, whether the " +
      "guardrail pods and gateway replicas agree, and the guardrail policies " +
      "in force. Display only: the mode is changed on the Guardrails page. " +
      "Metadata only.",
  },
};

export default function EyeonEnforcementPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <EyeonEnforcement projectId={projectId} /> : null}
    </Page>
  );
}

function EyeonEnforcement({ projectId }: { projectId: string }) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const summary = api.eyeonEnforcement.summary.useQuery(
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
        Could not load enforcement and policy: {summary.error.message}
      </div>
    );
  }
  if (!summary.data.enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <p className="text-muted-foreground">
            The EYEON Enforcement and policy page is switched off on this
            deployment.
          </p>
          <Link
            href={`/project/${projectId}/acme-enhancements/guardrails`}
            className="underline"
          >
            Open Guardrails
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <EnforcementContent
      data={summary.data}
      projectId={projectId}
      windowDays={windowDays}
      onWindowDaysChange={setWindowDays}
    />
  );
}

/** A date and time in the viewer's locale. */
function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function total(s: Split): number {
  return s.enforced + s.notEnforced;
}

const STATUS_BADGE = {
  good: { variant: "success", icon: CheckCircle2 },
  bad: { variant: "error", icon: AlertTriangle },
  neutral: { variant: "secondary", icon: MinusCircle },
} as const;

/** A status in words, with its icon: colour never stands alone. */
function StatusBadge({
  status,
}: {
  status: { text: string; tone: keyof typeof STATUS_BADGE };
}) {
  const { variant, icon: Icon } = STATUS_BADGE[status.tone];
  return (
    <Badge variant={variant} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {status.text}
    </Badge>
  );
}

function EnforcementContent({
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
  const links = {
    guardrails: `${base}/guardrails`,
    audit: `${base}/security-logs?tab=audit`,
    decisions: `${base}/security-logs?tab=guardrails`,
  };
  const period = `last ${data.windowDays} days`;
  const m = data.mode;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-bold">{enforcementHeadline(m.mode)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <EyeonModeChip mode={m.mode} ceiling={m.ceiling} />
            <Badge
              variant="outline"
              title="Only traffic through the EYEON gateway is checked. Traffic that bypasses it is not."
            >
              Gateway traffic only
            </Badge>
            <Badge
              variant="outline"
              title="This page changes nothing. The mode and the policies are changed on the Guardrails page."
            >
              Display only
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={links.guardrails} className="text-sm underline">
            {data.viewerCanSwitch
              ? "Change the mode on Guardrails"
              : "Open Guardrails"}
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

      <p className="text-muted-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        {data.viewerCanSwitch
          ? "Display only. You are one of this deployment's guardrail administrators: the mode and the policies are changed on the Guardrails page."
          : "Display only. The mode and the policies are changed on the Guardrails page, by the deployment's guardrail administrators."}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EyeonKpiTile
          label="Decided in enforce mode"
          figure={{
            state: "measured",
            value:
              data.decisions.enforcedPct === null
                ? "No checks"
                : formatShare(data.decisions.enforcedPct),
          }}
          subtitle={
            data.decisions.enforcedPct === null
              ? `No guardrail checks, ${period}`
              : `${data.decisions.enforcedChecks.toLocaleString()} of ${data.decisions.checks.toLocaleString()} checks, ${period}`
          }
          href={links.decisions}
          trend={
            <EyeonSparkline
              label="Checks decided in enforce mode per UTC day"
              points={data.daily.map((p) => ({
                label: p.day,
                value: p.enforceMode,
              }))}
              tone="allow"
            />
          }
        />
        <EyeonKpiTile
          label="Guardrail pods on the version in force"
          figure={{
            state: "measured",
            value:
              data.pods.reporting === 0
                ? "None reporting"
                : `${data.pods.onCurrent.toLocaleString()} of ${data.pods.reporting.toLocaleString()}`,
          }}
          subtitle={
            data.pods.currentVersion === null
              ? "No settings are stored yet"
              : `Settings v${data.pods.currentVersion}${data.pods.stale > 0 ? `; ${data.pods.stale.toLocaleString()} stale, not counted` : ""}`
          }
          delta={podsStatus(data.pods)}
          href={links.guardrails}
        />
        <EyeonKpiTile
          label="Gateway replicas, last 24 hours"
          figure={{
            state: "measured",
            value: data.gateways.replicas.toLocaleString(),
          }}
          subtitle="Seen with a decision in this project, with the mode each reported"
          delta={gatewaysStatus(data.gateways)}
        />
        <EyeonKpiTile
          label={`No verdict, last ${data.judge.windowHours} hours`}
          figure={{
            state: "measured",
            value:
              data.judge.rate === null
                ? "No checks"
                : formatRate(data.judge.rate),
          }}
          subtitle={
            data.judge.rate === null
              ? `No guardrail checks in the last ${data.judge.windowHours} hours`
              : `${data.judge.noVerdict.toLocaleString()} of ${data.judge.checks.toLocaleString()} checks without a judge answer; refused in enforce mode`
          }
          delta={
            data.judge.rate === null
              ? undefined
              : data.judge.alert
                ? {
                    text: `At or above the ${formatRate(data.judge.alertRate)} alert`,
                    tone: "bad",
                  }
                : {
                    text: `Below the ${formatRate(data.judge.alertRate)} alert`,
                    tone: "good",
                  }
          }
          href={links.guardrails}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModeCard data={data} href={links.guardrails} />
        <div className="min-w-0 lg:col-span-2">
          <HistoryCard data={data} href={links.audit} period={period} />
        </div>
        <TrialCard data={data} href={links.guardrails} />
        <div className="min-w-0 lg:col-span-2">
          <PodsCard data={data} href={links.guardrails} />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <PoliciesCard data={data} href={links.guardrails} period={period} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <MeaningCard mode={m.mode} />
        </div>
        <HowCard data={data} href={links.guardrails} />
        <div className="min-w-0 lg:col-span-3">
          <NotOnPageCard href={links.audit} />
        </div>
      </div>
    </div>
  );
}

function ModeCard({ data, href }: { data: Summary; href: string }) {
  const m = data.mode;
  return (
    <EyeonCard
      title="Mode against ceiling"
      subtitle="The mode EYEON serves to gateway traffic now, against the highest mode this deployment allows."
      link={{ href, label: "Open Guardrails" }}
      footnote="The ceiling is set by the deployment; the mode never exceeds it."
    >
      <EyeonModeScale mode={m.mode} ceiling={m.ceiling} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Served now</dt>
        <dd>{modeName(m.mode)}</dd>
        <dt className="text-muted-foreground">Ceiling</dt>
        <dd>{m.ceiling === "enforce" ? "Enforce" : "Record"}</dd>
        {m.version !== null ? (
          <>
            <dt className="text-muted-foreground">Settings</dt>
            <dd>
              v{m.version}, stored as {modeName(m.storedMode)}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Trial</dt>
        <dd>
          {m.trialEndsAt
            ? `Switches back to Record at ${when(m.trialEndsAt)}`
            : "None running"}
        </dd>
        <dt className="text-muted-foreground">Last change</dt>
        <dd>
          {m.lastChange
            ? `To ${m.lastChange.to === "enforce" ? "Enforce" : "Record"}, ${when(m.lastChange.at)}, by ${changedByText(m.lastChange)}`
            : "No change of mode recorded"}
        </dd>
        {m.lastChange ? (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="min-w-0 break-words">“{m.lastChange.reason}”</dd>
          </>
        ) : null}
      </dl>
      {m.cappedByCeiling ? (
        <p className="text-xs">
          The version in force is stored as Enforce and served as Record,
          because the ceiling is Record. The next pod pull records the
          switch-back.
        </p>
      ) : null}
      {m.switchBackDue ? (
        <p className="text-xs">
          The trial&apos;s switch-back time has passed: it is served as Record
          now, and the next pod pull records the switch-back.
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">{modeMeaning(m.mode)}</p>
    </EyeonCard>
  );
}

/** Checks per day by the mode the gateway reported: status tones only. */
const MODE_SERIES: (EyeonStackSeries & {
  key: "enforceMode" | "recordMode" | "notReported";
})[] = [
  { key: "enforceMode", name: "Enforce mode", tone: "allow" },
  { key: "recordMode", name: "Record mode", tone: "redact" },
  { key: "notReported", name: "Mode not reported", tone: "neutral" },
];

function HistoryCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const { shown, inPeriod, total: recorded } = data.history;
  return (
    <EyeonCard
      title="Mode over time"
      subtitle={`The mode the gateway reported with each check, per UTC day, ${period}, and each recorded change of mode: when, to what, by whom and why.`}
      link={{ href, label: "Open the audit log" }}
      footnote="Changes are recorded in the settings history and the audit log. As on the Guardrails page, a person's email shows only to the deployment's guardrail administrators."
    >
      <EyeonStackedBars
        label="Guardrail checks per UTC day, by the mode the gateway reported"
        series={MODE_SERIES}
        points={data.daily.map((p) => ({
          label: p.day,
          values: MODE_SERIES.map((s) => p[s.key]),
        }))}
      />
      <EyeonChartTable
        caption={`Guardrail checks per UTC day by reported mode, ${period}`}
        columns={["Day", "Checks", ...MODE_SERIES.map((s) => s.name)]}
        rows={data.daily.map((p) => ({
          key: p.day,
          cells: [p.day, p.checks, ...MODE_SERIES.map((s) => p[s.key])],
        }))}
      />
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-xs font-bold">
            Recorded changes, newest first
          </span>
          <span className="text-muted-foreground text-xs">
            {inPeriod === 1
              ? "1 in this period"
              : `${inPeriod.toLocaleString()} in this period`}
            {recorded > shown.length
              ? `; the newest ${shown.length.toLocaleString()} of ${recorded.toLocaleString()} shown`
              : ""}
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No change of mode is recorded.
          </p>
        ) : (
          <ol aria-label="Recorded changes of mode">
            {shown.map((c) => (
              <li
                key={c.version}
                className="flex items-start justify-between gap-3 border-b py-1.5 text-sm last:border-0"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        c.to === "enforce" ? "bg-dark-green" : "bg-dark-yellow",
                      )}
                    />
                    <span className="font-bold">
                      {changeTitle(c.from, c.to)}
                    </span>
                    {c.switchBackAt ? (
                      <Badge variant="outline">
                        Trial, switches back {when(c.switchBackAt)}
                      </Badge>
                    ) : null}
                    {c.automatic ? (
                      <Badge variant="outline">Automatic switch-back</Badge>
                    ) : null}
                    {c.inPeriod ? null : (
                      <Badge variant="secondary">Before this period</Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Settings v{c.version}, by {changedByText(c)}
                  </span>
                  <span className="text-xs break-words">
                    Reason: “{c.reason}”
                  </span>
                </span>
                <time
                  dateTime={c.at}
                  className="text-muted-foreground shrink-0 text-xs"
                >
                  {when(c.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </EyeonCard>
  );
}

function trialOutcomeText(last: NonNullable<Summary["trial"]["last"]>): string {
  if (last.outcome === "running") return "Running now";
  if (last.outcome === "servedAsRecord")
    return "Served as Record now; no later change is recorded yet";
  const at = last.endedAt ? when(last.endedAt) : "";
  if (last.outcome === "automatic") return `Switched back automatically, ${at}`;
  if (last.endedTo === "enforce")
    return `Replaced by a later Enforce version, ${at}`;
  const early =
    last.endedAt !== null &&
    new Date(last.endedAt).getTime() < new Date(last.switchBackAt).getTime();
  return early
    ? `Ended early: switched to Record, ${at}`
    : `Switched to Record, ${at}`;
}

function TrialCard({ data, href }: { data: Summary; href: string }) {
  const { last, defaultMinutes, options } = data.trial;
  const running = data.mode.trialEndsAt;
  return (
    <EyeonCard
      title="Trial window"
      subtitle="An enforce trial switches back to Record on its own, at the time set when it starts."
      link={{ href, label: "Open Guardrails" }}
      footnote={`Default switch-back: ${formatMinutes(defaultMinutes)}. Choices: ${options.map(formatMinutes).join(", ")}, or none.`}
    >
      <p className="flex items-center gap-2 text-sm">
        <Clock aria-hidden className="size-4 shrink-0" />
        {running
          ? `A trial is running: it switches back to Record at ${when(running)}.`
          : "No trial is running."}
      </p>
      {last ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Last trial</dt>
          <dd>{when(last.startedAt)}</dd>
          <dt className="text-muted-foreground">Planned</dt>
          <dd>
            {formatMinutes(last.minutes)}, until {when(last.switchBackAt)}
          </dd>
          <dt className="text-muted-foreground">Outcome</dt>
          <dd>{trialOutcomeText(last)}</dd>
        </dl>
      ) : (
        <p className="text-muted-foreground text-sm">
          No enforce trial is recorded.
        </p>
      )}
    </EyeonCard>
  );
}

/** The pods' agreement in counts: the pods are counted, never named. */
const POD_COUNTS: {
  key: "onCurrent" | "older" | "unknown" | "stale";
  label: string;
  variant: "success" | "warning" | "secondary" | "outline";
  icon: LucideIcon;
}[] = [
  {
    key: "onCurrent",
    label: "On the version in force",
    variant: "success",
    icon: CheckCircle2,
  },
  {
    key: "older",
    label: "Older version",
    variant: "warning",
    icon: AlertTriangle,
  },
  {
    key: "unknown",
    label: "Settings unknown",
    variant: "secondary",
    icon: MinusCircle,
  },
  {
    key: "stale",
    label: "Stale, not counted",
    variant: "outline",
    icon: Clock,
  },
];

function PodsCard({ data, href }: { data: Summary; href: string }) {
  const { pods, gateways } = data;
  return (
    <EyeonCard
      title="Pod agreement"
      subtitle={`Each guardrail pod reports the settings version it applied; a pod is stale after ${pods.staleAfterSeconds} seconds without a report. Each gateway replica reports its mode with every decision. Pods and replicas are counted, not named.`}
      link={{ href, label: "Open Guardrails" }}
      footnote="A pod reports a version, not a mode: a pod on the version in force serves its mode."
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{podsHeadline(pods)}</span>
        <StatusBadge status={podsStatus(pods)} />
      </div>
      {pods.reporting + pods.stale === 0 ? (
        <p className="text-muted-foreground text-sm">
          No guardrail pod reported in the last 24 hours.
        </p>
      ) : (
        <ul
          aria-label="Guardrail pods by settings version"
          className="flex flex-wrap gap-2"
        >
          {POD_COUNTS.map(({ key, label, variant, icon: Icon }) => (
            <li key={key}>
              <Badge variant={variant} className="gap-1 tabular-nums">
                <Icon aria-hidden className="size-3" />
                {label}: {pods[key].toLocaleString()}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-bold">
            Gateway replicas, last 24 hours
          </span>
          <StatusBadge status={gatewaysStatus(gateways)} />
        </div>
        <p className="text-sm">{gatewaysHeadline(gateways, data.mode.mode)}</p>
        {gateways.replicas > 0 ? (
          <p className="text-muted-foreground text-xs">
            {gateways.versions.length === 0
              ? "No settings version reported."
              : `Settings versions reported: ${gateways.versions.map((v) => `v${v}`).join(", ")}.`}
            {gateways.beforeLastChange > 0
              ? ` ${gateways.beforeLastChange.toLocaleString()} last seen before the last change of mode, so not compared.`
              : ""}
          </p>
        ) : null}
      </div>
    </EyeonCard>
  );
}

function PolicyTile({
  name,
  status,
  what,
  children,
}: {
  name: string;
  /** "On" or "Off" in words, or why the console cannot say. */
  status: { on: boolean; title?: string } | { notRecorded: string };
  what: string;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{name}</span>
        {"notRecorded" in status ? (
          <EyeonNotRecorded reason={status.notRecorded} />
        ) : status.on ? (
          <Badge variant="success" className="gap-1" title={status.title}>
            <CheckCircle2 aria-hidden className="size-3" />
            On
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1" title={status.title}>
            <MinusCircle aria-hidden className="size-3" />
            Off
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{what}</p>
      {children}
    </li>
  );
}

function RefusalCount({
  refusals,
  period,
}: {
  refusals: Split & { prompts: number; answers: number };
  period: string;
}) {
  return (
    <div className="mt-auto flex flex-col gap-0.5 text-sm">
      <span className="tabular-nums">
        <span className="font-bold">{total(refusals).toLocaleString()}</span>{" "}
        refused, {period}
      </span>
      <span className="text-muted-foreground text-xs">
        {splitText("block", refusals)} · {refusals.prompts.toLocaleString()}{" "}
        prompts, {refusals.answers.toLocaleString()} answers
      </span>
    </div>
  );
}

function PoliciesCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const p = data.policies;
  return (
    <EyeonCard
      title="Policies in force"
      subtitle={`What EYEON stores about the guardrail policies (each check on or off, and the personal-data types), with what each flagged on gateway traffic, ${period}.`}
      link={{ href, label: "Open Guardrails" }}
      footnote="Counts follow each decision's policy label and the mode the gateway reported: Blocked and Redacted only where it enforced."
    >
      {p === null ? (
        <p className="text-muted-foreground text-sm">
          No guardrail settings are stored in EYEON yet.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Settings v{p.version}, saved {when(p.savedAt)}. They apply to every
            project and every gateway caller on this deployment.
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PolicyTile
              name="Jailbreak Detection"
              status={{ on: p.jailbreak.enabled }}
              what="Looks for jailbreak and prompt-injection attempts."
            >
              <RefusalCount refusals={p.jailbreak.refusals} period={period} />
            </PolicyTile>
            <PolicyTile
              name="Topical Rail"
              status={{ on: p.topical.enabled }}
              what="Checks that the conversation stays on the application's topic."
            >
              <RefusalCount refusals={p.topical.refusals} period={period} />
            </PolicyTile>
            <PolicyTile
              name="PII Redaction"
              status={{
                on: p.personalData.entities.length > 0,
                title:
                  p.personalData.entities.length > 0
                    ? undefined
                    : "No personal-data type is selected.",
              }}
              what="Finds the personal-data types selected here and replaces them with entity tags."
            >
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {p.personalData.entities.length.toLocaleString()} of{" "}
                  {p.personalData.available.toLocaleString()} types selected
                  (configuration, not findings)
                </span>
                {p.personalData.entities.length > 0 ? (
                  <ul
                    className="flex flex-wrap gap-1"
                    aria-label="Personal-data types selected"
                  >
                    {p.personalData.entities.map((e) => (
                      <li key={e}>
                        <Badge variant="outline" className="font-mono">
                          {e}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="mt-auto flex flex-col gap-0.5 text-sm">
                <span className="tabular-nums">
                  <span className="font-bold">
                    {total(p.personalData.redactions).toLocaleString()}
                  </span>{" "}
                  redactions, {period}
                </span>
                <span className="text-muted-foreground text-xs">
                  {splitText("redact", p.personalData.redactions)}
                </span>
              </div>
            </PolicyTile>
            <PolicyTile
              name="Input too large"
              status={{
                notRecorded:
                  "The size limit is set in the guardrails service; EYEON does not store it.",
              }}
              what="Refuses text too large for the guardrail to check."
            >
              <RefusalCount refusals={p.oversized.refusals} period={period} />
            </PolicyTile>
          </ul>
          {total(p.other.refusals) > 0 ? (
            <p className="text-muted-foreground text-xs">
              Under other policy labels ({p.other.types.join(", ")}):{" "}
              {total(p.other.refusals).toLocaleString()} refused,{" "}
              {splitText("block", p.other.refusals)}.
            </p>
          ) : null}
        </>
      )}
    </EyeonCard>
  );
}

/** How each mode treats a flagged request: the prototype's four cases. */
const CASES: {
  key: string;
  title: string;
  action: GuardrailAction;
  enforce: string;
  record: string;
}[] = [
  {
    key: "jailbreak",
    title: "Jailbreak attempt in a prompt",
    action: "block",
    enforce: "The gateway refuses the request; the model never sees it.",
    record: "The prompt still reaches the model; the check is recorded.",
  },
  {
    key: "personal-data",
    title: "Personal data in a prompt",
    action: "redact",
    enforce: "The model receives the redacted text.",
    record: "The original text reaches the model; the finding is recorded.",
  },
  {
    key: "off-topic",
    title: "Off-topic answer",
    action: "block",
    enforce: "The gateway withholds the answer.",
    record: "The answer is returned; the check is recorded.",
  },
  {
    key: "no-verdict",
    title: "The judge cannot answer",
    action: "unavailable",
    enforce: "The gateway refuses the request, because there is no verdict.",
    record: "The request goes through without a verdict.",
  },
];

function MeaningCard({ mode }: { mode: GatewayMode | null }) {
  const enforcing = mode === "enforce";
  return (
    <EyeonCard
      title="What the mode means now"
      subtitle="How the mode served now treats a flagged request, against the other mode."
      footnote="Gateway traffic only: a request that bypasses the gateway is not checked in either mode."
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CASES.map((c) => (
          <li
            key={c.key}
            className="flex min-w-0 flex-col gap-1.5 rounded-md border p-3 text-sm"
          >
            <span className="font-bold">{c.title}</span>
            <span className="text-muted-foreground text-xs">
              {mode === null
                ? "Now: no mode stored, treat as not enforced"
                : `Now: ${modeName(mode)}`}
            </span>
            <div>
              <EyeonDecisionChip action={c.action} mode={mode} long />
            </div>
            <span>{enforcing ? c.enforce : c.record}</span>
            <span className="text-muted-foreground text-xs">
              {enforcing
                ? `In Record mode: ${c.record}`
                : `In Enforce mode: ${c.enforce}`}
            </span>
          </li>
        ))}
      </ul>
    </EyeonCard>
  );
}

function HowCard({ data, href }: { data: Summary; href: string }) {
  const { confirmationWord, podStaleAfterSeconds } = data.howItChanges;
  const { defaultMinutes, options } = data.trial;
  const steps = [
    {
      title: "A guardrail administrator",
      text: "Only the deployment's named guardrail administrators switch the mode, on the Guardrails page. A project role alone is not enough.",
    },
    {
      title: "A reason",
      text: "Required, and recorded with the change in the audit log.",
    },
    {
      title: "Typed confirmation",
      text: `To switch to Enforce, the administrator types ${confirmationWord}. Switching back to Record needs no confirmation.`,
    },
    {
      title: "An optional trial",
      text: `Enforce can switch back to Record on its own after ${options.map(formatMinutes).join(", ")}; ${formatMinutes(defaultMinutes)} by default.`,
    },
    {
      title: "The ceiling",
      text: "Enforce can be chosen only where the deployment ceiling allows it, and a lower ceiling is served at once.",
    },
    {
      title: "The pods apply it",
      text: `Each guardrail pod pulls the settings about every 30 seconds and reports the version it applied; it is stale after ${podStaleAfterSeconds} seconds without a report.`,
    },
  ];
  return (
    <EyeonCard
      title="How a mode change works"
      subtitle="The safeguards on every switch between Record and Enforce, and who may make one."
      link={{ href, label: "Open Guardrails" }}
      footnote="Nothing on this page changes the mode."
    >
      <ol className="flex flex-col gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-2">
            <span
              aria-hidden
              className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            >
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-bold">{s.title}</span>
              <span className="text-muted-foreground text-xs">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </EyeonCard>
  );
}

const NOT_RECORDED = [
  {
    what: "The policy definitions: the topic list, the jailbreak threshold, the input size limit",
    reason:
      "They live in the guardrails service, not in EYEON's database. Showing them needs that service to report them with its settings pull, or EYEON to store them as versioned settings.",
  },
  {
    what: "The mode each guardrail pod applies",
    reason:
      "A pod reports the settings version it applied, not a mode. The version in force and its mode are shown above.",
  },
  {
    what: "Earlier values of the ceiling",
    reason:
      "The ceiling is a deployment setting; its earlier values are not stored.",
  },
  {
    what: "Added latency of the guardrail",
    reason:
      "EYEON does not store how long a guardrail check takes; the gateway logs it only in its own health lines.",
  },
  {
    what: "Traffic that bypasses the gateway",
    reason: "Only traffic through the EYEON gateway is checked and recorded.",
  },
] as const;

const NOT_SHOWN_REASON =
  "This page counts the guardrail pods and the gateway replicas; it does not name them. The Guardrails page shows them under its own rules.";

function NotOnPageCard({ href }: { href: string }) {
  return (
    <EyeonCard
      title="Not on this page"
      subtitle="What EYEON does not record, so this page cannot show it, and what it records but this page leaves out."
      link={{ href, label: "Open the audit log" }}
      footnote="The switch itself stays on the Guardrails page."
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
        <li className="flex flex-wrap items-baseline justify-between gap-2">
          <span>The names of the guardrail pods and gateway replicas</span>
          <span
            className="text-muted-foreground inline-flex items-center gap-1 font-bold"
            title={NOT_SHOWN_REASON}
          >
            <EyeOff aria-hidden className="size-3.5" />
            Not shown here
            <span className="sr-only">: {NOT_SHOWN_REASON}</span>
          </span>
        </li>
      </ul>
    </EyeonCard>
  );
}
