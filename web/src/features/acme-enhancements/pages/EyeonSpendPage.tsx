import { type ReactNode, useState } from "react";
import Link from "next/link";
import Page from "@/src/components/layouts/page";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
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
  EyeonBullet,
  EyeonChartTable,
  EyeonSparkline,
  EyeonStackedBars,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import {
  EyeonRatingChip,
  ratingFromBand,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import { EyeonMirrorChip } from "@/src/features/acme-enhancements/components/eyeon/EyeonHealthChips";
import {
  type EyeonFigure,
  EyeonNotRecorded,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonHonestLabels";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import { type EyeonTone } from "@/src/features/acme-enhancements/components/eyeon/eyeonTones";
import {
  ageText,
  utcTime,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";
import {
  BREAKDOWNS,
  BREAKDOWN_WORDS,
  type Breakdown,
  NOT_RECORDED,
  SPEND_WINDOWS,
  type SpendWindow,
  WINDOW_WORDS,
  budgetPeriodText,
  changeText,
  formatCount,
  formatPct,
  formatUsd,
  monthHeadline,
  monthName,
  monthSentence,
} from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";

// ACME (CHG-2026-143, ADR-0027): the EYEON Cost and usage page ("Spend" in
// the navigation), composed from the EYEON kit (components/eyeon). It
// follows the prototype's Spend page as far as the console's data truthfully
// allows: what the gateway spends this month and in the chosen period, on
// which models, applications, teams and keys, and against each key's budget.
// Metadata only, from the request-log mirror; what EYEON does not record says
// so, and nothing is estimated beyond the run-rate it names as one.

type Summary = Extract<
  RouterOutputs["eyeonSpend"]["summary"],
  { enabled: true }
>;
type Month = NonNullable<Summary["month"]>;
type Period = NonNullable<Summary["period"]>;
type Breakdowns = NonNullable<Summary["breakdown"]>;
type Budgets = NonNullable<Summary["budgets"]>;
type Mirror = NonNullable<Summary["mirror"]>;

type Links = {
  gateway: string;
  /** Null where this person cannot open the page. */
  applications: string | null;
  gatewayHealth: string | null;
};

const headerProps = {
  title: "Cost and usage",
  help: {
    description:
      "What the gateway spends, on which models, applications, teams and " +
      "keys, and how each application stands against its key's budget. " +
      "Spend is the gateway's own price for each call, from the gateway " +
      "request log. Metadata only.",
  },
};

export default function EyeonSpendPage() {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <EyeonSpend projectId={projectId} /> : null}
    </Page>
  );
}

function EyeonSpend({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState<SpendWindow>("7d");
  const summary = api.eyeonSpend.summary.useQuery(
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
        Could not load cost and usage: {summary.error.message}
      </div>
    );
  }
  const base = `/project/${projectId}/acme-enhancements`;
  if (!summary.data.enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <p className="text-muted-foreground">
            The EYEON Cost and usage page is switched off on this deployment.
          </p>
          <Link href={`${base}/llm-gateway`} className="underline">
            Open the LLM Gateway&apos;s Spend tab
          </Link>
        </CardContent>
      </Card>
    );
  }
  const data = summary.data;
  const links: Links = {
    gateway: `${base}/llm-gateway`,
    applications: data.links.applications ? `${base}/applications` : null,
    gatewayHealth: data.links.gatewayHealth ? `${base}/gateway-health` : null,
  };
  if (
    !data.month ||
    !data.period ||
    !data.breakdown ||
    !data.budgets ||
    !data.mirror
  ) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <p className="text-muted-foreground">
            {data.gatewayManagement
              ? "The gateway request log is switched off on this deployment, so EYEON holds no record of gateway spend to show."
              : "Gateway management is switched off on this deployment, so EYEON holds no gateway keys or spend to report."}
          </p>
          {data.gatewayManagement ? (
            <Link href={links.gateway} className="underline">
              Open the LLM Gateway&apos;s Spend tab
            </Link>
          ) : null}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <BudgetHero
        month={data.month}
        mirror={data.mirror}
        now={data.generatedAt}
      />
      <section aria-labelledby="spend-period" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="spend-period" className="text-base font-bold">
              {WINDOW_WORDS[data.window].option}
            </h2>
            <p className="text-muted-foreground text-sm">
              Spend, calls and tokens on this project&apos;s gateway keys. The
              period applies from here down; the month above is the calendar
              month.
            </p>
          </div>
          <Select
            value={period}
            onValueChange={(v) =>
              setPeriod(SPEND_WINDOWS.find((w) => w === v) ?? "7d")
            }
          >
            <SelectTrigger className="w-40" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEND_WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>
                  {WINDOW_WORDS[w].option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Ribbon period={data.period} window={data.window} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SpendOverTime period={data.period} window={data.window} />
          <WhereTheMoneyGoes
            breakdown={data.breakdown}
            window={data.window}
            links={links}
          />
          <UsageCard period={data.period} window={data.window} links={links} />
          <KeyBudgetsCard
            budgets={data.budgets}
            window={data.window}
            links={links}
          />
          <ScopeCard links={links} />
          <NotRecordedCard />
        </div>
      </section>
    </div>
  );
}

/** Cents, for chart values: a hover title then reads like money. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function measured(value: string): EyeonFigure {
  return { state: "measured", value };
}

function mirrorLine(mirror: Mirror, now: string): string {
  const lag = `expected lag up to about ${mirror.expectedLagMinutes} min`;
  return mirror.completeTo
    ? `Complete to ${utcTime(mirror.completeTo)} (${ageText(mirror.completeTo, now)}); ${lag}.`
    : `No successful reconciliation recorded; ${lag}.`;
}

// ---------------------------------------------------------------------------
// The month: budget hero and runway
// ---------------------------------------------------------------------------

function BudgetHero({
  month,
  mirror,
  now,
}: {
  month: Month;
  mirror: Mirror;
  now: string;
}) {
  const facts: { key: string; value: ReactNode }[] = [
    { key: "Spent this month", value: formatUsd(month.spentUsd) },
    {
      key: "Daily average",
      value:
        month.dailyAverageUsd === null
          ? "Under a day so far"
          : formatUsd(month.dailyAverageUsd),
    },
    {
      key: "At this rate, month end",
      value:
        month.projectedUsd === null
          ? "Not drawn yet"
          : formatUsd(month.projectedUsd),
    },
    {
      key: "Project budget",
      value: <EyeonNotRecorded reason={NOT_RECORDED.projectBudget} />,
    },
  ];
  const label = `Spend so far in ${monthName(month.month)}, running total in US dollars by UTC day`;
  return (
    <section aria-labelledby="spend-month">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <span className="text-muted-foreground text-xs">
                Budget · {monthName(month.month)} · this project
              </span>
              <h2 id="spend-month" className="text-lg font-bold">
                {monthHeadline(month)}
              </h2>
              <p className="text-muted-foreground text-sm">
                {monthSentence(month)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  title="Only traffic through the EYEON gateway is priced and logged. Traffic that bypasses it is not seen."
                >
                  Gateway traffic only
                </Badge>
                <Badge
                  variant="outline"
                  title="The month runs from the 1st, 00:00 UTC, whatever period is chosen below."
                >
                  Calendar month, UTC
                </Badge>
                <Badge
                  variant="outline"
                  title="This page reads no prompt or answer text, error text, token hash or key secret."
                >
                  Metadata only
                </Badge>
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
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-sm font-bold">Month runway</span>
              <span className="text-muted-foreground text-xs">
                The running total by UTC day, day 1 to today. The month-end
                figure is the daily average carried forward, not a forecast.
              </span>
              <EyeonSparkline
                label={label}
                size="lg"
                points={month.days.map((d) => ({
                  label: d.day,
                  value: cents(d.cumulativeUsd),
                }))}
              />
              <EyeonChartTable
                caption={label}
                columns={["UTC day", "Spend", "Running total", "Calls"]}
                rows={month.days.map((d) => ({
                  key: d.day,
                  cells: [
                    d.day,
                    formatUsd(d.spendUsd),
                    formatUsd(d.cumulativeUsd),
                    d.calls,
                  ],
                }))}
              />
            </div>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <span>Request-log mirror:</span>
            <EyeonMirrorChip state={mirror.state} />
            <span>{mirrorLine(mirror, now)}</span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The period: ribbon
// ---------------------------------------------------------------------------

const BAND_DELTA = {
  green: { text: "Within the reliability threshold", tone: "good" },
  amber: { text: "Watch: 2% or more failed", tone: "bad" },
  red: { text: "Act now: over 5% failed", tone: "bad" },
  none: { text: "Fewer than 10 calls: not rated", tone: "neutral" },
} as const;

function Ribbon({ period, window }: { period: Period; window: SpendWindow }) {
  const t = period.totals;
  const words = WINDOW_WORDS[window];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <EyeonKpiTile
        label="Spend"
        figure={measured(formatUsd(t.spendUsd))}
        subtitle={`Last ${words.period}, this project's gateway keys`}
        delta={{
          text: changeText(t.spendUsd, period.previous.spendUsd, window),
          tone: "neutral",
        }}
        trend={
          <EyeonSparkline
            label={`Spend in US dollars per ${words.bucket}`}
            points={period.series.map((p) => ({
              label: p.label,
              value: cents(p.spendUsd),
            }))}
          />
        }
      />
      <EyeonKpiTile
        label="Requests"
        figure={measured(formatCount(t.calls))}
        subtitle={`Gateway calls, last ${words.period}`}
        delta={{
          text: changeText(t.calls, period.previous.calls, window),
          tone: "neutral",
        }}
      />
      <EyeonKpiTile
        label="Tokens"
        figure={measured(formatCount(t.totalTokens))}
        subtitle={`${formatCount(t.promptTokens)} in, ${formatCount(t.completionTokens)} out`}
      />
      <EyeonKpiTile
        label="Failed calls"
        figure={
          period.failedPct === null
            ? {
                state: "notRecorded",
                reason: "No gateway call in this period, so there is no rate.",
              }
            : measured(formatPct(period.failedPct))
        }
        subtitle={`${t.failed.toLocaleString()} of ${t.calls.toLocaleString()} calls`}
        delta={BAND_DELTA[period.failedBand]}
      />
      <EyeonKpiTile
        label="Cost per 1K tokens"
        figure={
          period.costPer1kTokensUsd === null
            ? { state: "notRecorded", reason: NOT_RECORDED.costPer1k }
            : measured(formatUsd(period.costPer1kTokensUsd))
        }
        subtitle="Spend over every token, in and out"
      />
      <EyeonKpiTile
        label="Cache-hit share"
        figure={
          period.cacheHitPct === null
            ? { state: "notRecorded", reason: NOT_RECORDED.cacheHits }
            : measured(formatPct(period.cacheHitPct))
        }
        subtitle={
          t.cacheReported > 0
            ? `${t.cacheHits.toLocaleString()} of ${t.cacheReported.toLocaleString()} calls with a cache field`
            : "Calls the gateway answered from its cache"
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where the money goes
// ---------------------------------------------------------------------------

function SpendOverTime({
  period,
  window,
}: {
  period: Period;
  window: SpendWindow;
}) {
  const words = WINDOW_WORDS[window];
  const label = `Spend in US dollars per ${words.bucket}, last ${words.period}`;
  return (
    <EyeonCard
      title="Spend over time"
      subtitle={`What the gateway spent per ${words.bucket}, from the period's first ${words.bucket} to now.`}
      footnote="Request-log mirror, lag up to about 7 min."
    >
      <EyeonStackedBars
        label={label}
        series={[{ name: "Spend", tone: "accent" }]}
        points={period.series.map((p) => ({
          label: p.label,
          values: [cents(p.spendUsd)],
        }))}
        legendValues={[formatUsd(period.totals.spendUsd)]}
      />
      <EyeonChartTable
        caption={label}
        columns={["Period start (UTC)", "Spend", "Calls", "Tokens"]}
        rows={period.series.map((p) => ({
          key: p.start,
          cells: [p.label, formatUsd(p.spendUsd), p.calls, p.totalTokens],
        }))}
      />
    </EyeonCard>
  );
}

const REST_WORDS: Record<Breakdown, [string, string]> = {
  model: ["model", "models"],
  application: ["application", "applications"],
  team: ["team", "teams"],
  key: ["key", "keys"],
};

function WhereTheMoneyGoes({
  breakdown,
  window,
  links,
}: {
  breakdown: Breakdowns;
  window: SpendWindow;
  links: Links;
}) {
  const [by, setBy] = useState<Breakdown>("model");
  const list = breakdown[by];
  const words = BREAKDOWN_WORDS[by];
  const [one, many] = REST_WORDS[by];
  return (
    <EyeonCard
      title="Where the money goes"
      subtitle={`${words.caption}, last ${WINDOW_WORDS[window].period}, the costliest first.`}
      footnote="Shares are of the period's spend on this project's gateway keys."
    >
      <div
        role="group"
        aria-label="Break spend down by"
        className="flex flex-wrap gap-2"
      >
        {BREAKDOWNS.map((b) => (
          <Button
            key={b}
            type="button"
            size="sm"
            variant={b === by ? "secondary" : "outline"}
            aria-pressed={b === by}
            onClick={() => setBy(b)}
          >
            {BREAKDOWN_WORDS[b].tab}
          </Button>
        ))}
      </div>
      {list.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No gateway spend in this period.
        </p>
      ) : (
        <>
          <EyeonBarList
            label={words.caption}
            items={list.rows.map((r) => ({
              key: r.id,
              title: r.name,
              name:
                r.lineageId && links.applications ? (
                  <Link
                    href={`${links.applications}/${encodeURIComponent(r.lineageId)}`}
                    className="underline"
                  >
                    {r.name}
                  </Link>
                ) : (
                  r.name
                ),
              valueText: `${formatUsd(r.spendUsd)} · ${r.sharePct === null ? "–" : formatPct(r.sharePct)} · ${r.calls.toLocaleString()} calls`,
              segments: [{ name: "Spend", tone: "accent", value: r.spendUsd }],
              note: r.note ? (
                <span className="text-muted-foreground text-xs">{r.note}</span>
              ) : undefined,
            }))}
          />
          {list.rest.count > 0 ? (
            <p className="text-muted-foreground text-xs">
              {list.rest.count.toLocaleString()} more{" "}
              {list.rest.count === 1 ? one : many}:{" "}
              {formatUsd(list.rest.spendUsd)} over{" "}
              {list.rest.calls.toLocaleString()} calls.
            </p>
          ) : null}
          <EyeonChartTable
            caption={words.caption}
            columns={[words.tab, "Spend", "Share", "Calls", "Tokens"]}
            rows={list.rows.map((r) => ({
              key: r.id,
              cells: [
                r.name,
                formatUsd(r.spendUsd),
                r.sharePct === null ? "–" : formatPct(r.sharePct),
                r.calls,
                r.totalTokens,
              ],
            }))}
          />
        </>
      )}
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Usage and reliability, key budgets
// ---------------------------------------------------------------------------

function UsageCard({
  period,
  window,
  links,
}: {
  period: Period;
  window: SpendWindow;
  links: Links;
}) {
  const t = period.totals;
  const items = [
    { key: "Gateway calls", value: t.calls.toLocaleString() },
    { key: "Prompt tokens (in)", value: t.promptTokens.toLocaleString() },
    {
      key: "Completion tokens (out)",
      value: t.completionTokens.toLocaleString(),
    },
    {
      key: "Cost per 1K tokens",
      value:
        period.costPer1kTokensUsd === null ? (
          <EyeonNotRecorded reason={NOT_RECORDED.costPer1k} />
        ) : (
          formatUsd(period.costPer1kTokensUsd)
        ),
    },
  ];
  return (
    <EyeonCard
      title="Usage and reliability"
      subtitle={`Tokens and calls in the last ${WINDOW_WORDS[window].period}, and how many calls failed.`}
      link={
        links.gatewayHealth
          ? { href: links.gatewayHealth, label: "See what is failing" }
          : undefined
      }
      footnote="A failed call is any status but success, as on the Applications page."
    >
      <dl className="flex flex-col gap-2 text-sm">
        {items.map((it) => (
          <div
            key={it.key}
            className="flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <dt className="text-muted-foreground">{it.key}</dt>
            <dd className="font-bold tabular-nums">{it.value}</dd>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-x-3 border-t pt-2">
          <dt className="text-muted-foreground">Failed calls</dt>
          <dd className="flex items-center gap-2">
            <span className="font-bold tabular-nums">
              {t.failed.toLocaleString()}
              {period.failedPct === null
                ? ""
                : ` (${formatPct(period.failedPct)})`}
            </span>
            <EyeonRatingChip rating={ratingFromBand(period.failedBand)} />
          </dd>
        </div>
      </dl>
    </EyeonCard>
  );
}

const BUDGET_TONE: Record<Budgets["shown"][number]["band"], EyeonTone> = {
  green: "allow",
  amber: "redact",
  red: "block",
  none: "neutral",
};

function KeyBudgetsCard({
  budgets,
  window,
  links,
}: {
  budgets: Budgets;
  window: SpendWindow;
  links: Links;
}) {
  const words = WINDOW_WORDS[window];
  return (
    <EyeonCard
      title="Key budgets"
      subtitle={`Each application's spend in the last ${words.period} against its gateway key's budget, the most used first.`}
      link={
        links.applications
          ? { href: links.applications, label: "Open Applications" }
          : undefined
      }
      footnote={`${budgets.withoutBudget.toLocaleString()} ${budgets.withoutBudget === 1 ? "application has" : "applications have"} no budget set. Rated as the Applications spend check: from 80% Watch, over 100% Act now.`}
    >
      {budgets.shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No application&apos;s gateway key has a budget set.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Key budgets">
          {budgets.shown.map((b) => (
            <li key={b.lineageId || b.name} className="flex flex-col gap-1">
              <EyeonBullet
                label={b.name}
                value={b.spentUsd}
                target={b.budgetUsd}
                valueText={formatUsd(b.spentUsd)}
                targetText={formatUsd(b.budgetUsd)}
                tone={BUDGET_TONE[b.band]}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {budgetPeriodText(b.budgetDuration)}
                </span>
                <EyeonRatingChip rating={ratingFromBand(b.band)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
        Spend since each key&apos;s last reset:
        <EyeonNotRecorded reason={NOT_RECORDED.resetTime} />
      </p>
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// About these figures
// ---------------------------------------------------------------------------

function ScopeCard({ links }: { links: Links }) {
  const items = [
    {
      what: "Coverage",
      value: "Gateway traffic only",
      note: "Calls that bypass the gateway are not priced or seen.",
    },
    {
      what: "Spend",
      value: "The gateway's price per call",
      note: "In US dollars, from the gateway's model prices; not a provider's invoice.",
    },
    {
      what: "Source",
      value: "Request-log mirror, lag up to about 7 min",
      note: "As on Home and Applications. The LLM Gateway's Spend tab asks the gateway directly, so the two can differ by the lag.",
    },
    {
      what: "Month",
      value: "Calendar month, UTC",
      note: "The month-end figure is a straight line from the daily average, not a forecast.",
    },
    {
      what: "Budgets",
      value: "Per gateway key",
      note: "An application's budget is its current key's; its spend counts every generation of the key.",
    },
  ];
  return (
    <EyeonCard
      title="What these numbers cover"
      subtitle="The scope and limits of cost and usage in EYEON, so nothing here reads as more than it is."
      link={{ href: links.gateway, label: "Open the LLM Gateway" }}
      footnote="Evidence to support your cost review."
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

const NOT_ON_THIS_PAGE = [
  { what: "A project budget", reason: NOT_RECORDED.projectBudget },
  { what: "Spend since a key's last reset", reason: NOT_RECORDED.resetTime },
  {
    what: "Provider invoices",
    reason:
      "EYEON does not read providers' bills; spend here is the gateway's own price for each call.",
  },
  {
    what: "Spend that bypasses the gateway",
    reason:
      "Calls made straight to a provider never reach the gateway, so EYEON cannot price them.",
  },
] as const;

function NotRecordedCard() {
  return (
    <EyeonCard
      title="Not on this page"
      subtitle="What EYEON does not record, so this page cannot show it."
    >
      <ul className="flex flex-col gap-2 text-sm">
        {NOT_ON_THIS_PAGE.map((n) => (
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
