import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, Lock } from "lucide-react";
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
  EyeonSparkline,
  EyeonStackedBars,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import {
  EyeonRatingChip,
  ratingFromBand,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import {
  EyeonMirrorChip,
  EyeonModelHealthChip,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonHealthChips";
import { EyeonNotRecorded } from "@/src/features/acme-enhancements/components/eyeon/EyeonHonestLabels";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import {
  ERROR_CLASS,
  GATEWAY_HEALTH_WINDOWS,
  type GatewayHealthWindow,
  HEALTH_CAUSE,
  MIRROR_STATE,
  WINDOW_WORDS,
  ageText,
  failedDelta,
  formatCallShare,
  formatDurationMs,
  healthHeadline,
  utcTime,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";

// ACME (CHG-2026-139, ADR-0027): the EYEON Gateway health page, composed from
// the EYEON kit (components/eyeon). It follows the prototype's Gateway health
// page as far as the console's data truthfully allows: which models answered
// their last health check (point in time; no history is kept), and what is
// failing, from the gateway request log. Metadata only; what EYEON does not
// record says so, and nothing is estimated.

type Summary = Extract<
  RouterOutputs["eyeonGatewayHealth"]["summary"],
  { enabled: true }
>;
type Health = NonNullable<Summary["health"]>;
type Failures = NonNullable<Summary["failures"]>;
type Mirror = NonNullable<Summary["mirror"]>;

const headerProps = {
  title: "Gateway health",
  help: {
    description:
      "Which models answer right now, and what is failing. Model health is " +
      "a point-in-time check: EYEON keeps only the latest one, so no health " +
      "history is drawn. The failure analysis comes from the gateway " +
      "request log. Metadata only.",
  },
};

export default function EyeonGatewayHealthPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <EyeonGatewayHealth projectId={projectId} /> : null}
    </Page>
  );
}

function EyeonGatewayHealth({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState<GatewayHealthWindow>("7d");
  const summary = api.eyeonGatewayHealth.summary.useQuery(
    { projectId, window: period },
    // Keep the previous figures on screen while a new period loads.
    { placeholderData: (previous) => previous },
  );

  if (summary.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }
  if (summary.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load gateway health: {summary.error.message}
      </div>
    );
  }
  if (!summary.data.enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <p className="text-muted-foreground">
            The EYEON Gateway health page is switched off on this deployment.
          </p>
          <Link
            href={`/project/${projectId}/acme-enhancements/llm-gateway`}
            className="underline"
          >
            Open the LLM Gateway
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <GatewayHealthContent
      data={summary.data}
      projectId={projectId}
      period={period}
      onPeriodChange={setPeriod}
    />
  );
}

function GatewayHealthContent({
  data,
  projectId,
  period,
  onPeriodChange,
}: {
  data: Summary;
  projectId: string;
  period: GatewayHealthWindow;
  onPeriodChange: (window: GatewayHealthWindow) => void;
}) {
  const base = `/project/${projectId}/acme-enhancements`;
  const links = {
    gateway: `${base}/llm-gateway`,
    requests: `${base}/security-logs?tab=gateway-requests`,
    applications: `${base}/applications`,
    audit: `${base}/security-logs?tab=audit`,
  };
  return (
    <div className="flex flex-col gap-6">
      <HealthHero data={data} links={links} />
      {data.health?.checkedAt ? (
        <WhatToDo health={data.health} data={data} links={links} />
      ) : null}
      <section
        aria-labelledby="gateway-health-analysis"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="gateway-health-analysis" className="text-base font-bold">
              Failure analysis
            </h2>
            <p className="text-muted-foreground text-sm">
              Failed gateway calls in this project, from the request-log mirror,
              by model and error class. The period applies here only; model
              health above is point in time.
            </p>
          </div>
          <Select
            value={period}
            onValueChange={(v) =>
              onPeriodChange(
                GATEWAY_HEALTH_WINDOWS.find((w) => w === v) ?? "7d",
              )
            }
          >
            <SelectTrigger className="w-40" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GATEWAY_HEALTH_WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>
                  {WINDOW_WORDS[w].option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data.failures && data.mirror ? (
          <FailureAnalysis
            failures={data.failures}
            mirror={data.mirror}
            data={data}
            links={links}
          />
        ) : (
          <Card>
            <CardContent className="text-muted-foreground p-4 text-sm">
              {data.gatewayManagement
                ? "The gateway request log is switched off on this deployment, so EYEON holds no record of gateway calls to analyse."
                : "Gateway management is switched off on this deployment, so EYEON holds no models, keys or gateway calls to report."}
            </CardContent>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ScopeCard data={data} links={links} />
          <NotRecordedCard links={links} />
        </div>
      </section>
    </div>
  );
}

type Links = {
  gateway: string;
  requests: string;
  applications: string;
  audit: string;
};

/** When the last health check ran, and whether its result has expired. */
function checkedText(health: Health, now: string): string {
  if (!health.checkedAt) return "No health check recorded";
  const when = `${utcTime(health.checkedAt)}, ${ageText(health.checkedAt, now)}`;
  return health.fresh
    ? `Checked ${when}`
    : `Stale as of ${when}: the ${health.cacheMinutes}-minute result has expired`;
}

function HealthHero({ data, links }: { data: Summary; links: Links }) {
  const health = data.health;
  const now = data.generatedAt;
  const facts = [
    {
      key: "Last health check",
      value: health ? checkedText(health, now) : "Not available",
    },
    {
      key: "Models answering",
      value:
        health?.checkedAt && health.counts.total > 0
          ? `${health.counts.healthy.toLocaleString()} of ${health.counts.total.toLocaleString()}`
          : "Not available",
    },
    {
      key: "Applications via gateway keys",
      value:
        data.applications === null
          ? "Not available"
          : data.applications.toLocaleString(),
    },
    {
      key: "Request-log mirror",
      value: data.mirror
        ? MIRROR_STATE[data.mirror.state].label
        : "Switched off",
    },
  ];
  return (
    <section aria-labelledby="gateway-health-now">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-muted-foreground text-xs">
                Right now · point in time
              </span>
              <h2 id="gateway-health-now" className="text-lg font-bold">
                {healthHeadline(health)}
              </h2>
              {health?.checkedAt ? (
                <p className="text-muted-foreground text-sm">
                  {checkedText(health, now)}.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  title="Only the latest health check is kept, so no health trend can be drawn."
                >
                  Point in time, no history kept
                </Badge>
                <Badge
                  variant="outline"
                  title="Only traffic through the EYEON gateway is checked and logged. Traffic that bypasses it is not seen."
                >
                  Gateway traffic only
                </Badge>
                <Badge
                  variant="outline"
                  title="This page reads no prompt or answer text, error text, token hash or key secret."
                >
                  Metadata only
                </Badge>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {facts.map((f) => (
                <div key={f.key} className="flex min-w-0 flex-col">
                  <dt className="text-muted-foreground text-xs">{f.key}</dt>
                  <dd className="font-bold">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {health ? (
            <RouteMap data={data} health={health} links={links} />
          ) : null}
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
            <span>
              Health is checked from the LLM Gateway page, at most once every{" "}
              {health ? health.cacheMinutes : 5} minutes and only when that page
              asks; this page never calls the gateway. Only the latest check is
              kept, so no health trend is drawn.
            </span>
            {data.gatewayManagement ? (
              <Link href={links.gateway} className="text-foreground underline">
                {data.canCheckHealth
                  ? "Check health on the LLM Gateway page"
                  : "Open the LLM Gateway"}
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * The prototype's route map, without its drawn wires: applications send
 * traffic through the gateway to the models, and the gateway logs each call
 * to the request-log mirror.
 */
function RouteMap({
  data,
  health,
  links,
}: {
  data: Summary;
  health: Health;
  links: Links;
}) {
  return (
    <div
      role="group"
      aria-label={`Route map: applications, the gateway, ${health.counts.total.toLocaleString()} models and the request-log mirror`}
      className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,2fr)]"
    >
      <Link
        href={links.applications}
        className="hover:bg-muted/50 flex flex-col gap-1 rounded-md border p-3"
      >
        <span className="text-2xl font-bold tabular-nums">
          {data.applications === null
            ? "–"
            : data.applications.toLocaleString()}
        </span>
        <span className="text-muted-foreground text-xs">
          applications via gateway keys
        </span>
      </Link>
      <RouteArrow />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="font-bold">Gateway</span>
          <span className="text-muted-foreground text-xs">
            {health.checkedAt
              ? `Answered the last health check, ${ageText(health.checkedAt, data.generatedAt)}`
              : "No health check recorded"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="font-bold">Request-log mirror</span>
          {data.mirror ? (
            <>
              <EyeonMirrorChip state={data.mirror.state} />
              <span className="text-muted-foreground text-xs">
                {mirrorLine(data.mirror, data.generatedAt)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground text-xs">
              Switched off on this deployment
            </span>
          )}
        </div>
      </div>
      <RouteArrow />
      {health.models.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {health.checkedAt
            ? "The last health check listed no models."
            : "No health check is recorded yet. Opening the model list on the LLM Gateway page runs one."}
        </p>
      ) : (
        <ul aria-label="Models" className="flex min-w-0 flex-col gap-2">
          {health.models.map((m) => (
            <li
              key={m.model}
              className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-sm" title={m.model}>
                  {m.model}
                </span>
                <span
                  className="text-muted-foreground truncate text-xs"
                  title={modelNote(m)}
                >
                  {modelNote(m)}
                </span>
              </span>
              <EyeonModelHealthChip status={m.status} />
            </li>
          ))}
          {health.more > 0 ? (
            <li className="text-muted-foreground text-xs">
              {health.more.toLocaleString()} more on the LLM Gateway page.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function RouteArrow() {
  return (
    <span aria-hidden className="text-muted-foreground flex justify-center">
      <ArrowDown className="size-4 md:hidden" />
      <ArrowRight className="hidden size-4 md:block" />
    </span>
  );
}

function modelNote(m: Health["models"][number]): string {
  const providers =
    m.providers.length > 0 ? m.providers.join(", ") : "Provider not listed";
  return m.cause ? `${HEALTH_CAUSE[m.cause].label} · ${providers}` : providers;
}

function mirrorLine(mirror: Mirror, now: string): string {
  const lag = `expected lag up to about ${mirror.expectedLagMinutes} min`;
  return mirror.completeTo
    ? `Complete to ${utcTime(mirror.completeTo)} (${ageText(mirror.completeTo, now)}); ${lag}`
    : `No successful reconciliation recorded; ${lag}`;
}

function WhatToDo({
  health,
  data,
  links,
}: {
  health: Health;
  data: Summary;
  links: Links;
}) {
  const unhealthy = health.models.filter((m) => m.status === "unhealthy");
  const words = WINDOW_WORDS[data.window];
  return (
    <section aria-labelledby="gateway-health-todo" className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id="gateway-health-todo" className="text-base font-bold">
            What to do
          </h2>
          <p className="text-muted-foreground text-sm">
            Steps for each model that failed its last health check.
          </p>
        </div>
        <Badge variant={unhealthy.length > 0 ? "error" : "outline"}>
          {unhealthy.length === 0
            ? "Nothing unhealthy"
            : `${unhealthy.length.toLocaleString()} unhealthy ${unhealthy.length === 1 ? "model" : "models"}`}
        </Badge>
      </div>
      {unhealthy.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-1 p-4 text-sm">
            <p className="font-bold">No model failed the last health check</p>
            <p className="text-muted-foreground">
              Health is point in time. The failure analysis below shows what the
              request log recorded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {unhealthy.map((m) => {
            const cause = HEALTH_CAUSE[m.cause ?? "unknown"];
            const calls = data.failures?.byModel.shown.find(
              (r) => r.model === m.model,
            );
            return (
              <EyeonCard
                key={m.model}
                title={m.model}
                subtitle={`${cause.label} · ${checkedText(health, data.generatedAt)}`}
                link={{ href: links.gateway, label: "Open the LLM Gateway" }}
                footnote="Point in time. No health history is kept. The provider's own message is on the LLM Gateway page."
              >
                <p className="text-sm">{cause.means}</p>
                {data.canCheckHealth ? null : (
                  <p className="text-muted-foreground flex items-start gap-2 text-xs">
                    <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
                    Read-only for your role: an Owner or Admin carries out these
                    steps. You can follow them here and in the audit log.
                  </p>
                )}
                <ol className="list-decimal pl-5 text-sm">
                  {cause.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <p className="text-muted-foreground text-xs">
                  {!data.failures
                    ? "Request log: switched off on this deployment."
                    : calls
                      ? `Request log: ${calls.failed.toLocaleString()} failed of ${calls.calls.toLocaleString()} calls in the last ${words.period} (${formatCallShare(calls.failed, calls.calls)}).`
                      : `Request log: no calls to this model among the most-called models in the last ${words.period}.`}
                </p>
              </EyeonCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FailureAnalysis({
  failures,
  mirror,
  data,
  links,
}: {
  failures: Failures;
  mirror: Mirror;
  data: Summary;
  links: Links;
}) {
  const words = WINDOW_WORDS[data.window];
  const period = `last ${words.period}`;
  const delta = failedDelta(failures.failed, failures.previous, data.window);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EyeonKpiTile
          label="Gateway calls"
          figure={{
            state: "measured",
            value: failures.calls.toLocaleString(),
          }}
          subtitle={`From this project's keys, ${period}`}
          href={links.requests}
          trend={
            <EyeonSparkline
              label={`Gateway calls per ${words.bucket}`}
              points={failures.series.map((p) => ({
                label: p.label,
                value: p.calls,
              }))}
            />
          }
        />
        <EyeonKpiTile
          label="Failed calls"
          figure={{
            state: "measured",
            value: failures.failed.toLocaleString(),
          }}
          subtitle={`${formatCallShare(failures.failed, failures.calls)} of calls, ${period}`}
          delta={delta}
          href={links.requests}
          trend={
            <EyeonSparkline
              label={`Failed calls per ${words.bucket}`}
              points={failures.series.map((p) => ({
                label: p.label,
                value: p.failed,
              }))}
              tone="block"
            />
          }
        />
        <EyeonKpiTile
          label="Rate-limit and budget refusals"
          figure={{
            state: "measured",
            value: failures.limitRefusals.toLocaleString(),
          }}
          subtitle={`Failed calls refused on a rate limit or a budget, ${period}`}
          href={links.requests}
        />
        <EyeonKpiTile
          label="Request log complete to"
          figure={
            mirror.completeTo
              ? {
                  state: "measured",
                  value: ageText(mirror.completeTo, data.generatedAt),
                }
              : {
                  state: "notRecorded",
                  reason:
                    "No successful reconciliation is recorded, so nothing says the request log is complete.",
                }
          }
          subtitle={`Mirror lag up to about ${mirror.expectedLagMinutes} min${mirror.newestArrival ? `; newest call here ${ageText(mirror.newestArrival, data.generatedAt)}` : ""}`}
          delta={{
            text: MIRROR_STATE[mirror.state].label,
            tone: MIRROR_STATE[mirror.state].tone,
          }}
          href={links.requests}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <OverTimeCard failures={failures} data={data} links={links} />
        </div>
        <ShareCard failures={failures} period={period} links={links} />
        <ClassesCard failures={failures} period={period} links={links} />
        <div className="min-w-0 lg:col-span-2">
          <LatestCard failures={failures} data={data} links={links} />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <DurationCard failures={failures} period={period} links={links} />
        </div>
      </div>
    </>
  );
}

function OverTimeCard({
  failures,
  data,
  links,
}: {
  failures: Failures;
  data: Summary;
  links: Links;
}) {
  const words = WINDOW_WORDS[data.window];
  return (
    <EyeonCard
      title="Failed calls over time"
      subtitle={`Calls that did not succeed, per ${words.bucket}, last ${words.period}. Request-log data, not health history.`}
      link={{ href: links.requests, label: "Open Gateway requests" }}
      footnote="Request-log mirror, lag up to about 7 min."
    >
      <EyeonStackedBars
        label={`Failed gateway calls per ${words.bucket}`}
        series={[{ name: "Failed calls", tone: "block" }]}
        points={failures.series.map((p) => ({
          label: p.label,
          values: [p.failed],
        }))}
      />
      <EyeonChartTable
        caption={`Gateway calls and failed calls per ${words.bucket}, last ${words.period}`}
        columns={["Start (UTC)", "Calls", "Failed", "Failed share"]}
        rows={failures.series.map((p) => ({
          key: p.start,
          cells: [
            p.label,
            p.calls,
            p.failed,
            formatCallShare(p.failed, p.calls),
          ],
        }))}
      />
    </EyeonCard>
  );
}

function modelName(model: string | null): string {
  return model ?? "Model not logged";
}

function ShareCard({
  failures,
  period,
  links,
}: {
  failures: Failures;
  period: string;
  links: Links;
}) {
  const { shown, total } = failures.byModel;
  const more = total - shown.length;
  return (
    <EyeonCard
      title="Failure share by model"
      subtitle={`Each model's calls and how many failed, ${period}, most-called first.`}
      link={{ href: links.requests, label: "Open Gateway requests" }}
      footnote="Rated as the Applications reliability check: Watch from 2% failed, Act now over 5%, from 10 calls."
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No gateway call in this period.
        </p>
      ) : (
        <EyeonBarList
          label={`Calls and failed calls by model, ${period}`}
          items={shown.map((r) => ({
            key: modelName(r.model),
            name: <span className="font-mono">{modelName(r.model)}</span>,
            title: modelName(r.model),
            valueText: `${formatCallShare(r.failed, r.calls)} · ${r.failed.toLocaleString()} of ${r.calls.toLocaleString()}`,
            segments: [
              { name: "Failed", value: r.failed, tone: "block" as const },
              {
                name: "Succeeded",
                value: r.calls - r.failed,
                tone: "neutral" as const,
                muted: true,
              },
            ],
            note: (
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <EyeonRatingChip rating={ratingFromBand(r.band)} />
                {r.band === "none" ? (
                  <span className="text-muted-foreground">
                    Too few calls to rate
                  </span>
                ) : null}
              </span>
            ),
          }))}
        />
      )}
      {more > 0 ? (
        <p className="text-muted-foreground text-xs">
          {more === 1
            ? "1 more model had calls."
            : `${more.toLocaleString()} more models had calls.`}
        </p>
      ) : null}
    </EyeonCard>
  );
}

function ClassesCard({
  failures,
  period,
  links,
}: {
  failures: Failures;
  period: string;
  links: Links;
}) {
  const classes = failures.byClass;
  return (
    <EyeonCard
      title="Error classes"
      subtitle={`What kind of failure the provider or the gateway reported, ${period}.`}
      link={{ href: links.requests, label: "Open Gateway requests" }}
      footnote="Counts only. Error text is not stored."
    >
      {classes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No failed call in this period.
        </p>
      ) : (
        <EyeonBarList
          label={`Failed calls by error class, ${period}`}
          items={classes.map((c) => ({
            key: c.group,
            name: ERROR_CLASS[c.group].label,
            title: ERROR_CLASS[c.group].label,
            valueText: `${c.failed.toLocaleString()} · ${formatCallShare(c.failed, failures.failed)} of failures`,
            segments: [
              {
                name: ERROR_CLASS[c.group].label,
                value: c.failed,
                tone: "accent" as const,
              },
            ],
          }))}
        />
      )}
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">
          What each class means
        </summary>
        <dl className="flex flex-col gap-2 pt-2">
          {classes.map((c) => (
            <div key={c.group}>
              <dt className="font-bold">{ERROR_CLASS[c.group].label}</dt>
              <dd className="text-muted-foreground">
                {ERROR_CLASS[c.group].means}
                {ERROR_CLASS[c.group].classes.length > 0
                  ? ` The gateway's classes: ${ERROR_CLASS[c.group].classes.join(", ")}.`
                  : ""}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </EyeonCard>
  );
}

function LatestCard({
  failures,
  data,
  links,
}: {
  failures: Failures;
  data: Summary;
  links: Links;
}) {
  const latest = failures.latest;
  return (
    <EyeonCard
      title="Latest failed calls"
      subtitle={`The newest failed calls in the request log, last ${WINDOW_WORDS[data.window].period}. Metadata only.`}
      link={{ href: links.requests, label: "Open Gateway requests" }}
      footnote="Mirror lag up to about 7 min. A failed call's status code and error text are not recorded."
    >
      {latest === null ? (
        <p className="text-muted-foreground text-sm">
          Individual gateway calls need access to the gateway request log, which
          your role does not have.
        </p>
      ) : latest.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No failed call in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              The newest failed gateway calls
            </caption>
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th scope="col" className="py-1 text-left font-bold">
                  Time (UTC)
                </th>
                <th scope="col" className="py-1 text-left font-bold">
                  Model
                </th>
                <th scope="col" className="py-1 text-left font-bold">
                  Application
                </th>
                <th scope="col" className="py-1 text-left font-bold">
                  Error class
                </th>
              </tr>
            </thead>
            <tbody>
              {latest.map((r, i) => (
                <tr key={`${r.time}-${i}`} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-mono text-xs whitespace-nowrap">
                    {r.time.slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-xs">
                    {modelName(r.model)}
                  </td>
                  <td className="py-1.5 pr-2">
                    {r.application ? (
                      <Link
                        href={`${links.applications}/${encodeURIComponent(r.application.lineageId)}`}
                        className="font-bold underline"
                      >
                        {r.application.name}
                      </Link>
                    ) : null}
                    <span className="text-muted-foreground block font-mono text-xs">
                      {r.alias ?? "No key alias"}
                    </span>
                  </td>
                  <td className="py-1.5">{ERROR_CLASS[r.group].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EyeonCard>
  );
}

function DurationCard({
  failures,
  period,
  links,
}: {
  failures: Failures;
  period: string;
  links: Links;
}) {
  const shown = failures.byModel.shown;
  return (
    <EyeonCard
      title="Call duration by model"
      subtitle={`How long a successful call took, from the start to the end of the model call as the gateway logs it, ${period}. Cache hits are left out.`}
      link={{ href: links.requests, label: "Open Gateway requests" }}
      footnote="Request-log mirror, lag up to about 7 min. Shown from 10 timed calls. The guardrail's added latency is not recorded."
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No gateway call in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Call duration by model, {period}
            </caption>
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th scope="col" className="py-1 text-left font-bold">
                  Model
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  Timed calls
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  Median
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  95th percentile
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={modelName(r.model)} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-mono text-xs">
                    {modelName(r.model)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.timedCalls.toLocaleString()}
                  </td>
                  {r.p50Ms === null || r.p95Ms === null ? (
                    <td
                      colSpan={2}
                      className="text-muted-foreground py-1.5 text-right text-xs"
                    >
                      Too few calls to show
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatDurationMs(r.p50Ms)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatDurationMs(r.p95Ms)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EyeonCard>
  );
}

function ScopeCard({ data, links }: { data: Summary; links: Links }) {
  const items = [
    {
      what: "Coverage",
      value: "Gateway traffic only",
      note: "Traffic that bypasses the gateway is not checked or logged.",
    },
    {
      what: "Model health",
      value: "Point in time",
      note: `The latest check only, kept for ${data.health?.cacheMinutes ?? 5} minutes; no history, so no health trend.`,
    },
    {
      what: "Gateway reachable now",
      value: "Checked on the LLM Gateway page",
      note: "This page never calls the gateway; the LLM Gateway page checks it live.",
    },
    {
      what: "Request log",
      value: "Mirror lag up to about 7 min",
      note: "The newest failed calls can take up to about 7 minutes to appear.",
    },
    {
      what: "A failed call",
      value: "Any status but success",
      note: "Counted as on the Applications page, from this project's keys.",
    },
  ];
  return (
    <EyeonCard
      title="What these numbers cover"
      subtitle="The scope and limits of gateway health in EYEON, so nothing here reads as more than it is."
      link={{ href: links.audit, label: "Open Audit logs" }}
      footnote="Evidence to support your risk review."
    >
      <dl className="flex flex-col gap-2 text-sm">
        {items.map((it) => (
          <div
            key={it.what}
            className="flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <dt className="text-muted-foreground">{it.what}</dt>
            <dd className="flex flex-col items-end text-right">
              <span className="font-bold">{it.value}</span>
              <span className="text-muted-foreground text-xs">{it.note}</span>
            </dd>
          </div>
        ))}
      </dl>
    </EyeonCard>
  );
}

const NOT_RECORDED = [
  {
    what: "Model health over time",
    reason:
      "Only the latest health check is kept, so EYEON cannot say when a model's status began or draw a health trend.",
  },
  {
    what: "Provider status pages",
    reason:
      "EYEON does not read providers' status pages; the steps above say when to check them.",
  },
  {
    what: "Health of each gateway pod",
    reason: "The gateway's pods do not report their own health to EYEON.",
  },
  {
    what: "A failed call's status code",
    reason:
      "The request log keeps the gateway's error class, not the HTTP status.",
  },
  {
    what: "A failed call's error text",
    reason:
      "Discarded when the call is logged, because it can quote the prompt.",
  },
  {
    what: "Added latency of the guardrail",
    reason: "EYEON does not store how long a guardrail check takes.",
  },
] as const;

function NotRecordedCard({ links }: { links: Links }) {
  return (
    <EyeonCard
      title="Not on this page"
      subtitle="What EYEON does not record, so this page cannot show it."
      link={{ href: links.requests, label: "Open Gateway requests" }}
      footnote="Each gateway call, with its key alias and error class, is in the Gateway requests log."
    >
      <ul className="flex flex-col gap-2 text-sm">
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
