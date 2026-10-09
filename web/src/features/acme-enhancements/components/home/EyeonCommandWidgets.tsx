import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  OctagonAlert,
} from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/utils/tailwind";
import { EyeonCard } from "@/src/features/acme-enhancements/components/eyeon/EyeonCard";
import {
  EyeonBarList,
  EyeonBullet,
  EyeonRing,
  EyeonSparkline,
  EyeonStackBar,
  EyeonStackedBars,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import {
  EyeonModeChip,
  EyeonRatingChip,
  ratingFromBand,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import {
  EyeonMirrorChip,
  EyeonModelHealthChip,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonHealthChips";
import { EyeonModeScale } from "@/src/features/acme-enhancements/components/eyeon/EyeonModeScale";
import { DIMENSION_LABEL } from "@/src/features/acme-enhancements/components/AcmeApplicationsScorecard";
import {
  type AttentionItem,
  type CommandLinks,
  type HomeDecisions,
  type HomeEnforcement,
  type HomeHealth,
  type HomeOverview,
  type HomeSpend,
  RETIRED_APPLICATIONS,
  plural,
} from "@/src/features/acme-enhancements/utils/eyeonCommandCentre";
import {
  changeText,
  formatCount,
  formatPct,
  formatUsd,
  monthHeadline,
} from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";
import {
  changedByText,
  formatRate,
  formatShare,
} from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";
import {
  ageText,
  formatCallShare,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";
import {
  entityTypeLabel,
  policyCellCount,
} from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";

// ACME (CHG-2026-147, ADR-0030): the command centre's widgets. Each takes
// the figures of one or two EYEON pages' summaries, exactly as those pages
// return them, and links to the page that shows the evidence. Props only:
// the page does the reads, so every widget renders in Storybook and tests.

const lastDays = (days: number) => `last ${days} days`;

/** A widget waiting for, missing or refused its figures, in words. */
export function EyeonWidgetState({
  title,
  state,
  message,
}: {
  title: string;
  state: "loading" | "error" | "off";
  /** The error, or why the figures are not recorded. */
  message?: string;
}) {
  const text =
    state === "loading"
      ? "Loading…"
      : state === "off"
        ? (message ??
          "Its EYEON page is switched off on this deployment, so nothing is read for it.")
        : `Could not load: ${message ?? "unknown error"}`;
  return (
    <EyeonCard title={title} subtitle="Not shown right now.">
      <p
        className={cn(
          "text-muted-foreground text-sm",
          state === "loading" && "animate-pulse",
        )}
      >
        {text}
      </p>
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Needs your attention
// ---------------------------------------------------------------------------

export function AttentionWidget({
  items,
  sourcesMissing,
}: {
  items: AttentionItem[];
  /** Sources that could not be read: the queue cannot speak for them. */
  sourcesMissing: string[];
}) {
  const act = items.filter((i) => i.severity === "act").length;
  return (
    <EyeonCard
      title="Needs your attention"
      subtitle={
        items.length === 0
          ? "What a leader should act on, most serious first."
          : `${plural(act, "item")} to act on and ${plural(items.length - act, "to watch", "to watch")}, most serious first.`
      }
      footnote={
        sourcesMissing.length > 0
          ? `Not checked here: ${sourcesMissing.join(", ")}.`
          : undefined
      }
    >
      {items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
          <CheckCircle2
            aria-hidden
            className="text-dark-green mt-0.5 size-5 shrink-0"
          />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-bold">Nothing needs you right now.</span>
            <span className="text-muted-foreground">
              Every check below is within its threshold for the period.
            </span>
          </div>
        </div>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Needs your attention">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "bg-muted/30 flex items-start gap-3 rounded-lg border border-l-4 p-3",
                item.severity === "act"
                  ? "border-l-dark-red"
                  : "border-l-dark-yellow",
              )}
            >
              {item.severity === "act" ? (
                <OctagonAlert
                  aria-hidden
                  className="text-dark-red mt-0.5 size-4 shrink-0"
                />
              ) : (
                <AlertTriangle
                  aria-hidden
                  className="text-dark-yellow mt-0.5 size-4 shrink-0"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-bold">
                  <span className="sr-only">
                    {item.severity === "act" ? "Act now: " : "Watch: "}
                  </span>
                  {item.title}
                </span>
                <span className="text-muted-foreground text-xs">
                  {item.detail}
                </span>
              </div>
              {item.href ? (
                <Link
                  href={item.href}
                  className="text-primary-accent inline-flex shrink-0 items-center gap-1 self-center text-xs font-bold whitespace-nowrap hover:underline"
                >
                  {item.linkLabel}
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Guardrail posture
// ---------------------------------------------------------------------------

export function PostureWidget({
  overview,
  href,
}: {
  overview: HomeOverview;
  href: string;
}) {
  const { mode, decisions } = overview;
  const last = mode.lastChange;
  return (
    <EyeonCard
      title="Guardrail posture"
      subtitle="Whether risky prompts are stopped or only recorded."
      link={{ href, label: "Open enforcement" }}
    >
      <EyeonModeChip mode={mode.mode} ceiling={mode.ceiling} />
      <EyeonModeScale mode={mode.mode} ceiling={mode.ceiling} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Enforced</dt>
        <dd className="font-bold tabular-nums">
          {decisions.enforcedPct === null
            ? "No checks"
            : `${formatShare(decisions.enforcedPct)} of checks`}
        </dd>
        {mode.trialEndsAt ? (
          <>
            <dt className="text-muted-foreground">Trial ends</dt>
            <dd>{mode.trialEndsAt.slice(0, 16).replace("T", " ")} UTC</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Last change</dt>
        <dd className="min-w-0">
          {last ? (
            <span title={last.reason}>
              To {last.to} on {last.at.slice(0, 10)}, by {changedByText(last)}
            </span>
          ) : (
            "None recorded"
          )}
        </dd>
      </dl>
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Risks stopped and let through
// ---------------------------------------------------------------------------

export function StoppedWidget({
  overview,
  href,
}: {
  overview: HomeOverview;
  href: string;
}) {
  const d = overview.decisions;
  const rows = [
    {
      key: "refused",
      name: "Prompts flagged to refuse",
      split: d.promptsRefused,
    },
    {
      key: "withheld",
      name: "Answers flagged to withhold",
      split: d.answersWithheld,
    },
    { key: "redacted", name: "Personal data to redact", split: d.redactions },
  ];
  const max = Math.max(
    1,
    ...rows.map((r) => r.split.enforced + r.split.notEnforced),
  );
  const notStopped =
    d.promptsRefused.notEnforced + d.answersWithheld.notEnforced;
  return (
    <EyeonCard
      title="Risks stopped and let through"
      subtitle={
        notStopped > 0
          ? `${plural(notStopped, "flagged prompt or answer", "flagged prompts and answers")} reached the model or the user, ${lastDays(overview.windowDays)}.`
          : `What the guardrails flagged, and whether the gateway applied it, ${lastDays(overview.windowDays)}.`
      }
      link={{ href, label: "Open guardrail decisions" }}
    >
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{r.name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                <span className="text-foreground font-bold">
                  {r.split.enforced.toLocaleString("en-US")}
                </span>{" "}
                stopped ·{" "}
                <span
                  className={cn(
                    "font-bold",
                    r.split.notEnforced > 0
                      ? "text-dark-red"
                      : "text-foreground",
                  )}
                >
                  {r.split.notEnforced.toLocaleString("en-US")}
                </span>{" "}
                let through
              </span>
            </div>
            <EyeonStackBar
              title={r.name}
              max={max}
              segments={[
                {
                  name: "Stopped (enforce mode)",
                  tone: "allow",
                  value: r.split.enforced,
                },
                {
                  name: "Let through (not enforced)",
                  tone: "block",
                  value: r.split.notEnforced,
                },
              ]}
            />
          </li>
        ))}
      </ul>
      <EyeonStackedBars
        label="Flagged prompts and answers per UTC day"
        series={[
          { name: "Refuse", tone: "block" },
          { name: "Withhold", tone: "info" },
          { name: "Redact", tone: "redact" },
        ]}
        points={overview.daily.map((p) => ({
          label: p.day,
          values: [p.promptsRefused, p.answersWithheld, p.redactions],
        }))}
        emptyText="Nothing was flagged in the period."
      />
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Spend this month
// ---------------------------------------------------------------------------

export function SpendWidget({
  spend,
  href,
}: {
  spend: HomeSpend;
  href: string;
}) {
  const m = spend.month;
  const t = spend.period.totals;
  return (
    <EyeonCard
      title="Spend this month"
      subtitle={monthHeadline(m)}
      link={{ href, label: "Open Spend" }}
      footnote="A straight line from the month so far, not a forecast."
    >
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums">
          {formatUsd(m.spentUsd)}
        </span>
        <span className="text-muted-foreground text-xs">
          by day {m.dayOfMonth} of {m.daysInMonth}
        </span>
      </div>
      <EyeonSparkline
        label="Spend so far this month, by UTC day"
        size="lg"
        points={m.days.map((d) => ({ label: d.day, value: d.cumulativeUsd }))}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">On pace for</dt>
        <dd className="font-bold tabular-nums">
          {m.projectedUsd === null
            ? "Too early to tell"
            : formatUsd(m.projectedUsd)}
        </dd>
        <dt className="text-muted-foreground">This period</dt>
        <dd className="tabular-nums">
          {formatUsd(t.spendUsd)} ·{" "}
          {changeText(t.spendUsd, spend.period.previous.spendUsd, spend.window)}
        </dd>
        <dt className="text-muted-foreground">Budgets</dt>
        <dd>
          {plural(spend.budgets.withBudget, "key")} with one,{" "}
          {spend.budgets.withoutBudget.toLocaleString("en-US")} without
        </dd>
      </dl>
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// AI adoption
// ---------------------------------------------------------------------------

export function AdoptionWidget({
  spend,
  health,
  href,
  windowDays,
}: {
  spend: HomeSpend | null;
  health: HomeHealth | null;
  href: string;
  windowDays: number;
}) {
  const calls = spend?.period.totals.calls ?? health?.failures?.calls ?? null;
  const previous =
    spend?.period.previous.calls ?? health?.failures?.previous.calls ?? null;
  const series = spend
    ? spend.period.series.map((p) => ({ label: p.label, value: p.calls }))
    : (health?.failures?.series.map((p) => ({
        label: p.label,
        value: p.calls,
      })) ?? []);
  const applications = spend
    ? spend.breakdown.application.rows.filter(
        (r) => r.id !== RETIRED_APPLICATIONS,
      ).length + spend.breakdown.application.rest.count
    : null;
  const models = spend
    ? spend.breakdown.model.rows.length + spend.breakdown.model.rest.count
    : null;
  return (
    <EyeonCard
      title="AI adoption"
      subtitle={`How much the organisation uses AI through the gateway, ${lastDays(windowDays)}.`}
      link={{ href, label: spend ? "Open Spend" : "Open Gateway health" }}
    >
      {calls === null ? (
        <p className="text-muted-foreground text-sm">
          Gateway calls are not recorded here.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {formatCount(calls)}
            </span>
            <span className="text-muted-foreground text-xs">AI calls</span>
          </div>
          {previous !== null ? (
            <span className="text-muted-foreground text-xs">
              {previous === 0
                ? "None in the period before"
                : `${calls >= previous ? "+" : "−"}${Math.abs((100 * (calls - previous)) / previous).toFixed(1)}% on the period before`}
            </span>
          ) : null}
          <EyeonSparkline label="AI calls over the period" points={series} />
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Fact label="Applications calling" value={applications} />
            <Fact label="Models used" value={models} />
            <Fact
              label="Tokens"
              value={
                spend ? formatCount(spend.period.totals.totalTokens) : null
              }
            />
            <Fact
              label="Cache hits"
              value={
                spend && spend.period.cacheHitPct !== null
                  ? formatPct(spend.period.cacheHitPct)
                  : null
              }
            />
          </dl>
        </>
      )}
    </EyeonCard>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div className="bg-muted/40 flex flex-col rounded-md px-2 py-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-bold tabular-nums">
        {value === null ? (
          <span
            className="text-muted-foreground inline-flex items-center gap-1 text-xs"
            title="Your role does not see this figure, or it is not recorded"
          >
            <CircleSlash aria-hidden className="size-3" />
            Not shown
          </span>
        ) : typeof value === "number" ? (
          value.toLocaleString("en-US")
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gateway and models
// ---------------------------------------------------------------------------

export function GatewayWidget({
  health,
  href,
}: {
  health: HomeHealth;
  href: string;
}) {
  const h = health.health;
  const f = health.failures;
  const checked = h ? h.counts.healthy + h.counts.unhealthy : 0;
  const failing = h ? h.models.filter((m) => m.status === "unhealthy") : [];
  return (
    <EyeonCard
      title="Gateway and models"
      subtitle="Whether the models answer, and how many calls fail."
      link={{ href, label: "Open Gateway health" }}
    >
      {h ? (
        <div className="flex items-center gap-4">
          <EyeonRing
            label={`Models healthy: ${h.counts.healthy} of ${checked} checked`}
            fraction={checked > 0 ? h.counts.healthy / checked : null}
            centerText={checked > 0 ? `${h.counts.healthy}/${checked}` : "–"}
            tone={h.counts.unhealthy > 0 ? "block" : "allow"}
          />
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="font-bold">
              {h.checkedAt === null
                ? "No health check recorded"
                : h.counts.unhealthy > 0
                  ? `${plural(h.counts.unhealthy, "model")} failing`
                  : "Every checked model answered"}
            </span>
            {h.checkedAt ? (
              <span className="text-muted-foreground text-xs">
                Checked {ageText(h.checkedAt, health.generatedAt)}
                {h.fresh ? "" : " (stale)"}
              </span>
            ) : null}
            <ul className="flex flex-wrap gap-1">
              {failing.slice(0, 4).map((m) => (
                <li key={m.model} className="flex items-center gap-1">
                  <EyeonModelHealthChip status={m.status} />
                  <span className="truncate text-xs" title={m.model}>
                    {m.model}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Gateway management is switched off: no models to report.
        </p>
      )}
      {f ? (
        <div className="flex items-center justify-between gap-2 border-t pt-2 text-sm">
          <span className="text-muted-foreground">Failed calls</span>
          <span className="font-bold tabular-nums">
            {formatCallShare(f.failed, f.calls)}{" "}
            <span className="text-muted-foreground text-xs font-normal">
              ({f.failed.toLocaleString("en-US")} of{" "}
              {f.calls.toLocaleString("en-US")})
            </span>
          </span>
        </div>
      ) : null}
      {health.mirror ? <EyeonMirrorChip state={health.mirror.state} /> : null}
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// What the guardrails caught
// ---------------------------------------------------------------------------

export function ThreatsWidget({
  decisions,
  href,
}: {
  decisions: HomeDecisions;
  href: string;
}) {
  const rows = decisions.policyByDirection
    .map((r) => ({
      r,
      prompts: policyCellCount(r.prompts),
      answers: policyCellCount(r.answers),
    }))
    .filter((x) => x.prompts + x.answers > 0)
    .slice(0, 6);
  const entities = decisions.entityTypes.slice(0, 8);
  return (
    <EyeonCard
      title="What the guardrails caught"
      subtitle={`Refusals and redactions by policy type, and the kinds of personal data found, ${lastDays(decisions.windowDays)}.`}
      link={{ href, label: "Open guardrail decisions" }}
      footnote="Types and counts only: no prompt, answer or matched text."
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No policy was triggered in the period.
        </p>
      ) : (
        <EyeonBarList
          label="Policy types triggered"
          items={rows.map(({ r, prompts, answers }) => ({
            key: r.type,
            name: r.label,
            title: r.label,
            valueText: `${(prompts + answers).toLocaleString("en-US")} (${prompts.toLocaleString("en-US")} prompts, ${answers.toLocaleString("en-US")} answers)`,
            segments: [
              { name: "Prompts", tone: "block", value: prompts },
              { name: "Answers", tone: "info", value: answers },
            ],
          }))}
        />
      )}
      {entities.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            Personal data found
          </span>
          <ul className="flex flex-wrap gap-1" aria-label="Personal data found">
            {entities.map((e) => (
              <li key={e.type}>
                <Badge variant="outline" className="gap-1">
                  {entityTypeLabel(e.type)}
                  <span className="text-muted-foreground tabular-nums">
                    {e.count.toLocaleString("en-US")}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Control integrity
// ---------------------------------------------------------------------------

function Check({
  ok,
  label,
  detail,
}: {
  /** True: holds. False: does not. Null: nothing to compare. */
  ok: boolean | null;
  label: string;
  detail: string;
}) {
  const Icon = ok === null ? CircleSlash : ok ? CheckCircle2 : OctagonAlert;
  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          ok === null
            ? "text-muted-foreground"
            : ok
              ? "text-dark-green"
              : "text-dark-red",
        )}
      />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-bold">
          <span className="sr-only">
            {ok === null ? "Not compared: " : ok ? "Holds: " : "Fails: "}
          </span>
          {label}
        </span>
        <span className="text-muted-foreground text-xs">{detail}</span>
      </div>
    </li>
  );
}

export function IntegrityWidget({
  enforcement,
  health,
  href,
}: {
  enforcement: HomeEnforcement;
  health: HomeHealth | null;
  href: string;
}) {
  const pods = enforcement.pods;
  const gw = enforcement.gateways;
  const judge = enforcement.judge;
  return (
    <EyeonCard
      title="Control integrity"
      subtitle="Whether the controls run as configured, not just as written."
      link={{ href, label: "Open enforcement" }}
    >
      <ul className="flex flex-col gap-2">
        <Check
          ok={pods.agree}
          label="Guardrail pods on the current settings"
          detail={
            pods.currentVersion === null
              ? "No guardrail settings are stored in EYEON yet."
              : `${pods.onCurrent} of ${pods.reporting} reporting pods apply version ${pods.currentVersion}${pods.stale > 0 ? `; ${pods.stale} stopped reporting` : ""}.`
          }
        />
        <Check
          ok={gw.matchesServed}
          label="Gateways apply the mode EYEON serves"
          detail={
            gw.replicas === 0
              ? "No gateway replica reported a decision in the period."
              : `${plural(gw.replicas, "replica")}: ${gw.byMode.enforce} enforce, ${gw.byMode.record} record, ${gw.byMode.notReported} not reported.`
          }
        />
        <Check
          ok={judge.checks === 0 ? null : !judge.alert}
          label="The judge decides"
          detail={
            judge.checks === 0
              ? `No checks in the last ${judge.windowHours} hours.`
              : `${formatRate(judge.rate ?? 0)} without a verdict in ${judge.windowHours} hours (alert at ${formatRate(judge.alertRate)}).`
          }
        />
        {health?.mirror ? (
          <Check
            ok={
              health.mirror.state === "withinLag"
                ? true
                : health.mirror.state === "behind"
                  ? false
                  : null
            }
            label="Gateway records are complete"
            detail={
              health.mirror.state === "withinLag"
                ? `Reconciled within the expected ${health.mirror.expectedLagMinutes} minutes.`
                : health.mirror.state === "behind"
                  ? "Reconciliation is behind: recent calls may be missing."
                  : "No reconciliation is recorded."
            }
          />
        ) : null}
      </ul>
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export function TopAppsWidget({
  spend,
  decisions,
  href,
  windowDays,
}: {
  spend: HomeSpend | null;
  decisions: HomeDecisions | null;
  href: string | null;
  windowDays: number;
}) {
  const link = href ? { href, label: "Open Applications" } : undefined;
  if (spend) {
    const rows = spend.breakdown.application.rows
      .filter((r) => r.id !== RETIRED_APPLICATIONS)
      .slice(0, 6);
    return (
      <EyeonCard
        title="Top applications"
        subtitle={`The applications using AI most, by calls, with their spend, ${lastDays(windowDays)}.`}
        link={link}
      >
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No application called the gateway in the period.
          </p>
        ) : (
          <EyeonBarList
            label="Top applications by calls"
            items={rows.map((r) => ({
              key: r.id,
              name: r.name,
              title: r.name,
              valueText: `${formatCount(r.calls)} calls · ${formatUsd(r.spendUsd)}`,
              segments: [{ name: "Calls", tone: "accent", value: r.calls }],
            }))}
          />
        )}
      </EyeonCard>
    );
  }
  const busiest = decisions?.busiest.shown ?? [];
  return (
    <EyeonCard
      title="Top applications"
      subtitle={`The callers with the most guardrail refusals, ${lastDays(windowDays)}.`}
      link={link}
    >
      {busiest.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {decisions
            ? "No caller had a refusal in the period."
            : "Your role does not see application activity here."}
        </p>
      ) : (
        <EyeonBarList
          label="Callers with the most refusals"
          items={busiest.map((b) => {
            const name = b.application?.name ?? b.alias;
            return {
              key: b.alias,
              name,
              title: name,
              valueText: `${(b.matched.enforced + b.matched.notEnforced).toLocaleString("en-US")} refusals of ${b.checks.toLocaleString("en-US")} checks`,
              segments: [
                {
                  name: "Stopped",
                  tone: "allow" as const,
                  value: b.matched.enforced,
                },
                {
                  name: "Let through",
                  tone: "block" as const,
                  value: b.matched.notEnforced,
                },
              ],
            };
          })}
        />
      )}
    </EyeonCard>
  );
}

export function AppRiskWidget({
  overview,
  href,
}: {
  overview: HomeOverview;
  href: string | null;
}) {
  const apps = overview.applications;
  return (
    <EyeonCard
      title="Applications at risk"
      subtitle="How each application rates on the Applications scorecard."
      link={href ? { href, label: "Open Applications" } : undefined}
    >
      {apps === null ? (
        <p className="text-muted-foreground text-sm">
          Applications are not rated: gateway management is switched off.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            <EyeonRatingChip rating="actnow" count={apps.byOverall.red} />
            <EyeonRatingChip rating="watch" count={apps.byOverall.amber} />
            <EyeonRatingChip rating="ontrack" count={apps.byOverall.green} />
            {apps.byOverall.none > 0 ? (
              <EyeonRatingChip rating="notrated" count={apps.byOverall.none} />
            ) : null}
          </div>
          {apps.topRisks.risks.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No application has a risk rated Watch or Act now.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Top risks">
              {apps.topRisks.risks.slice(0, 4).map((r) => (
                <li
                  key={`${r.alias}:${r.dimension}`}
                  className="flex flex-col gap-0.5"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <EyeonRatingChip rating={ratingFromBand(r.band)} />
                    <span className="truncate font-bold" title={r.name}>
                      {r.name}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {DIMENSION_LABEL[r.dimension]}: {r.evidence}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <span className="text-muted-foreground text-xs">
            {plural(apps.total, "application")} rated;{" "}
            {apps.missingBudget.toLocaleString("en-US")} without a spending
            limit.
          </span>
        </>
      )}
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// Model mix and budgets
// ---------------------------------------------------------------------------

export function ModelMixWidget({
  spend,
  href,
  windowDays,
}: {
  spend: HomeSpend;
  href: string;
  windowDays: number;
}) {
  const rows = spend.breakdown.model.rows.slice(0, 6);
  return (
    <EyeonCard
      title="Model mix"
      subtitle={`Which models the organisation's AI runs on, by calls, ${lastDays(windowDays)}.`}
      link={{ href, label: "Open Spend" }}
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No model was called in the period.
        </p>
      ) : (
        <EyeonBarList
          label="Models by calls"
          items={rows.map((r) => ({
            key: r.id,
            name: r.name,
            title: r.name,
            valueText: `${formatCount(r.calls)} calls · ${formatUsd(r.spendUsd)}`,
            segments: [{ name: "Calls", tone: "accent", value: r.calls }],
          }))}
        />
      )}
    </EyeonCard>
  );
}

export function BudgetsWidget({
  spend,
  href,
}: {
  spend: HomeSpend;
  href: string;
}) {
  const shown = spend.budgets.shown.slice(0, 5);
  return (
    <EyeonCard
      title="Closest to budget"
      subtitle="Gateway keys by how much of their budget is used."
      link={{ href, label: "Open Spend" }}
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No key has a budget.{" "}
          {spend.budgets.withoutBudget > 0
            ? `${plural(spend.budgets.withoutBudget, "key")} run without one.`
            : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((b) => (
            <li key={b.lineageId}>
              <EyeonBullet
                label={b.name}
                value={b.spentUsd}
                target={b.budgetUsd}
                valueText={formatUsd(b.spentUsd)}
                targetText={formatUsd(b.budgetUsd)}
                tone={
                  b.usedPct >= 100
                    ? "block"
                    : b.usedPct >= 80
                      ? "redact"
                      : "accent"
                }
              />
            </li>
          ))}
        </ul>
      )}
    </EyeonCard>
  );
}

// ---------------------------------------------------------------------------
// What EYEON cannot see
// ---------------------------------------------------------------------------

export function NotRecordedWidget({ links }: { links: CommandLinks }) {
  const rows: { title: string; detail: string; href?: string }[] = [
    {
      title: "AI traffic that bypasses the gateway",
      detail:
        "An application that calls a model provider directly is neither checked nor counted. Coverage is only as wide as the gateway's.",
    },
    {
      title: "Who the end user was",
      detail:
        "The gateway does not forward a user identity yet, so decisions name the application, not the person.",
      href: links.decisions,
    },
    {
      title: "What was said",
      detail:
        "By design this page reads no prompt or answer text. Authorised reviewers see content on the Guardrails page.",
      href: links.guardrails,
    },
  ];
  return (
    <EyeonCard
      title="What EYEON cannot see"
      subtitle="The limits of these figures, so a gap never reads as a zero."
    >
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start gap-2">
            <CircleSlash
              aria-hidden
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-sm font-bold">
                {r.href ? (
                  <Link href={r.href} className="hover:underline">
                    {r.title}
                  </Link>
                ) : (
                  r.title
                )}
              </span>
              <span className="text-muted-foreground text-xs">{r.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </EyeonCard>
  );
}
