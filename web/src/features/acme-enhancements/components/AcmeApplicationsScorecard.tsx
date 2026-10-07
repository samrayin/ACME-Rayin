import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { api, type RouterOutputs } from "@/src/utils/api";
import { formatAgentsParam } from "@/src/features/acme-enhancements/utils/guardrailAgentLink";

// ACME (CHG-2026-122, ADR-0023): one scorecard per connected application (a
// gateway key lineage), plus a summary for the whole project. Metadata only.
// Second iteration: top risks and enforced traffic in the summary; refusals
// by type, a daily trend and a filtered evidence link on each card.
// CHG-2026-125 (ADR-0023 §3.5): each card links to its application's detail
// screen, which shows the same card (AcmeApplicationDetail.tsx).

type Scorecards = Extract<
  RouterOutputs["acmeApplications"]["scorecards"],
  { enabled: true }
>;
type Application = Scorecards["applications"][number];
type Band = Application["overall"];
type Dimension = Application["dimensions"][number]["dimension"];

/** CHG-2026-125: an application's detail screen. */
export function applicationDetailHref(projectId: string, lineageId: string) {
  return `/project/${projectId}/acme-enhancements/applications/${encodeURIComponent(lineageId)}`;
}

/** How many refusal types a card names on its threat row. */
const THREAT_TYPES_SHOWN = 3;

const BAND_LABEL: Record<Band, string> = {
  green: "On track",
  amber: "Watch",
  red: "Act now",
  none: "Not rated",
};

const BAND_VARIANT: Record<
  Band,
  "success" | "warning" | "error" | "secondary"
> = {
  green: "success",
  amber: "warning",
  red: "error",
  none: "secondary",
};

/** CHG-2026-132: also the EYEON overview's top risks. */
export const DIMENSION_LABEL: Record<Dimension, string> = {
  protection: "Protection",
  threats: "Threat activity",
  dataProtection: "Data protection",
  accessHygiene: "Access hygiene",
  spend: "Spend",
  reliability: "Reliability",
};

function BandBadge({ band }: { band: Band }) {
  return <Badge variant={BAND_VARIANT[band]}>{BAND_LABEL[band]}</Badge>;
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold">{value}</div>
        {note ? (
          <div className="text-muted-foreground text-xs">{note}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A share in percent, never rounded up to 100% or down to 0%. */
function formatShare(p: number): string {
  if (p > 0 && p < 1) return "<1%";
  if (p > 99 && p < 100) return ">99%";
  return `${Math.round(p)}%`;
}

function Summary({ data }: { data: Scorecards }) {
  const s = data.summary;
  const modeLabel = data.mode === "enforce" ? "Enforce" : "Record";
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Stat
        label="Applications"
        value={s.applications}
        note={
          <span className="flex flex-wrap gap-1 pt-1">
            <Badge variant="error">{s.byOverall.red} act now</Badge>
            <Badge variant="warning">{s.byOverall.amber} watch</Badge>
            <Badge variant="success">{s.byOverall.green} on track</Badge>
          </span>
        }
      />
      <Stat
        label="Guardrail mode"
        value={modeLabel}
        note={
          data.mode === "enforce"
            ? "Refusals and redactions are applied."
            : "Decisions are recorded, not applied."
        }
      />
      <Stat
        label="Traffic EYEON enforced"
        value={s.enforcedPct === null ? "—" : formatShare(s.enforcedPct)}
        note={
          s.enforcedPct === null
            ? "No guardrail checks in this period"
            : `${s.enforcedChecks.toLocaleString()} of ${s.checks.toLocaleString()} checks decided in enforce mode. Mode now: ${modeLabel}.`
        }
      />
      <Stat
        label="Calls"
        value={s.calls.toLocaleString()}
        note={`Last ${data.windowDays} days`}
      />
      <Stat
        label="Prompts refused"
        value={s.promptBlocks.toLocaleString()}
        note={`${s.answerBlocks.toLocaleString()} answers withheld`}
      />
      <Stat
        label="Personal data redacted"
        value={s.redactions.toLocaleString()}
        note="Prompts and answers"
      />
      <Stat
        label="Spend"
        value={s.spendUsd === null ? "—" : `$${s.spendUsd.toFixed(2)}`}
        note={s.spendUsd === null ? "Not shown for your role" : undefined}
      />
      <Stat
        label="Keys without a budget"
        value={s.missingBudget}
        note="Set one when the key is created"
      />
    </div>
  );
}

/** The red and amber dimensions across applications, worst first. */
function TopRisks({ data }: { data: Scorecards }) {
  const { risks, total } = data.summary.topRisks;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top risks</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {risks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No dimension is rated Watch or Act now in this period.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {risks.map((r) => (
              <li
                key={`${r.alias}-${r.dimension}`}
                className="grid grid-cols-[6rem_1fr] items-start gap-2 text-sm"
              >
                <span>
                  <BandBadge band={r.band} />
                </span>
                <span>
                  <span className="font-bold">{r.name}</span> ·{" "}
                  {DIMENSION_LABEL[r.dimension]}
                  <span className="text-muted-foreground block text-xs">
                    {r.evidence}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {total > risks.length ? (
          <p className="text-muted-foreground text-xs">
            {total - risks.length} more on the cards below.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A daily series as a plain SVG line, its own scale, one point per UTC day.
 * Hover a day for its count; the label carries the peak, and the accessible
 * name the total, for readers who cannot see the line.
 */
export function Sparkline({
  label,
  unit,
  points,
}: {
  label: string;
  unit: string;
  points: { day: string; value: number }[];
}) {
  const width = 120;
  const height = 24;
  const pad = 2;
  const max = Math.max(0, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const x = (i: number) => i * step;
  const y = (v: number) =>
    height - pad - (max > 0 ? (v / max) * (height - 2 * pad) : 0);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {label} · peak {max.toLocaleString()}
      </span>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="text-primary h-6 w-full"
        role="img"
        aria-label={`${label}, one point per day over ${points.length} days: ${total} in total, at most ${max} in a day.`}
      >
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={x(i) - step / 2}
            y={0}
            width={step}
            height={height}
            fill="transparent"
          >
            <title>{`${p.day}: ${p.value.toLocaleString()} ${unit}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/** yyyy-mm-dd in the viewer's time zone, as a date input expects. */
export function localDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ApplicationCard({
  app,
  projectId,
  periodFrom,
  showDetailLink = true,
  evidenceAgents,
}: {
  app: Application;
  projectId: string;
  /** The period's first day, yyyy-mm-dd, for the evidence link. */
  periodFrom: string;
  /** CHG-2026-125: link to the application's detail screen. */
  showDetailLink?: boolean;
  /**
   * CHG-2026-125: every key alias the application has used, for an exact
   * evidence link that includes a rotated key's earlier generations. Without
   * it the link filters on the key in use now, as before.
   */
  evidenceAgents?: { agents: string[]; omitted: number };
}) {
  const threatTypes = app.threatTypes.slice(0, THREAT_TYPES_SHOWN);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base" title={app.name}>
              {app.name}
            </CardTitle>
            <div
              className="text-muted-foreground truncate font-mono text-xs"
              title={app.alias}
            >
              {app.alias}
            </div>
          </div>
          <BandBadge band={app.overall} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {app.dimensions.map((d) => (
          <div
            key={d.dimension}
            className="grid grid-cols-[8.5rem_6rem_1fr] items-start gap-2 text-sm"
          >
            <span>{DIMENSION_LABEL[d.dimension]}</span>
            <span>
              <BandBadge band={d.band} />
            </span>
            <span className="text-muted-foreground text-xs">
              {d.evidence}
              {d.dimension === "threats" && threatTypes.length > 0 ? (
                <span className="block pt-0.5">
                  By type:{" "}
                  {threatTypes.map((t) => `${t.label} (${t.count})`).join(", ")}
                  {app.threatTypes.length > threatTypes.length
                    ? `, and ${app.threatTypes.length - threatTypes.length} more`
                    : ""}
                  .
                </span>
              ) : null}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-4 border-t pt-2">
          <Sparkline
            label="Daily calls"
            unit="calls"
            points={app.trend.map((p) => ({ day: p.day, value: p.calls }))}
          />
          <Sparkline
            label="Daily prompts refused"
            unit="prompts refused"
            points={app.trend.map((p) => ({ day: p.day, value: p.refused }))}
          />
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
          <span>
            {app.calls.toLocaleString()} calls ·{" "}
            {app.models.length ? app.models.join(", ") : "all models"}
          </span>
          <span className="flex flex-wrap items-center gap-3">
            {showDetailLink ? (
              <Link
                href={applicationDetailHref(projectId, app.lineageId)}
                className="underline"
              >
                Details
              </Link>
            ) : null}
            <Link
              href={{
                pathname: `/project/${projectId}/acme-enhancements/security-logs`,
                query: evidenceAgents
                  ? {
                      tab: "guardrails",
                      agents: formatAgentsParam(evidenceAgents.agents),
                      from: periodFrom,
                    }
                  : { tab: "guardrails", agent: app.alias, from: periodFrom },
              }}
              className="underline"
              title={
                evidenceAgents
                  ? evidenceAgents.omitted > 0
                    ? `Shows the newest ${evidenceAgents.agents.length} keys of this application; ${evidenceAgents.omitted} older ones are listed under their own names.`
                    : "Shows every key this application has used."
                  : app.generation > 1
                    ? "Shows the key in use now. Earlier keys of this application are listed under their own names."
                    : undefined
              }
            >
              Guardrail decisions
            </Link>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function AcmeApplicationsScorecard({
  projectId,
}: {
  projectId: string;
}) {
  const [windowDays, setWindowDays] = useState<7 | 30>(30);
  const scorecards = api.acmeApplications.scorecards.useQuery({
    projectId,
    windowDays,
  });

  if (scorecards.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }
  if (scorecards.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load the scorecards: {scorecards.error.message}
      </div>
    );
  }
  if (!scorecards.data.enabled) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          Gateway management is switched off on this deployment, so there are no
          applications to score.
        </CardContent>
      </Card>
    );
  }
  const data = scorecards.data;
  const periodFrom = localDateInput(
    new Date(Date.parse(data.generatedAt) - data.windowDays * 86_400_000),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-3xl text-sm">
          One scorecard per connected application. Each dimension is rated on
          metadata only (guardrail decisions, gateway calls and the key&apos;s
          settings), never on prompt or answer text. Rates need at least 10
          calls in the period.
        </p>
        <Select
          value={String(windowDays)}
          onValueChange={(v) => setWindowDays(v === "7" ? 7 : 30)}
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

      <Summary data={data} />

      <TopRisks data={data} />

      {data.applications.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-4 text-sm">
            No applications yet. Create a key for an application under
            Governance Controls › LLM Gateway, and it appears here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {data.applications.map((app) => (
            <ApplicationCard
              key={`${app.alias}`}
              app={app}
              projectId={projectId}
              periodFrom={periodFrom}
            />
          ))}
        </div>
      )}
    </div>
  );
}
