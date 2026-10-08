import { useState } from "react";
import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  CircleHelp,
  Clock,
  Database,
  FlaskConical,
  LayoutGrid,
  Lock,
  Server,
} from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent } from "@/src/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import { type RouterOutputs } from "@/src/utils/api";
import { cn } from "@/src/utils/tailwind";
import { EyeonBullet } from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import {
  EyeonMirrorChip,
  EyeonModelHealthChip,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonHealthChips";
import {
  EYEON_TONE_TEXT,
  type EyeonTone,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonTones";
import {
  HEALTH_CAUSE,
  MIRROR_STATE,
  type ModelHealthStatus,
  WINDOW_WORDS,
  ageText,
  formatCallShare,
  formatDurationMs,
  routeHeadline,
  utcTime,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";
import {
  ROUTE_LEAD_PX,
  routeLayout,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayRouteGeometry";

// ACME (CHG-2026-139 follow-up; owner, 2026-10-08: "my Gateway health should
// be similar to this and clickable"): the Gateway health hero as the
// prototype's route map. The applications send traffic through the gateway;
// a wire runs from the gateway to every model, solid for a model that passed
// its last health check and dashed, with a cross, for one that failed; the
// gateway logs each call to the request-log mirror below it. Every card is
// clickable: a model opens its detail, the others open their own pages.
// Props only, so Storybook can draw it on fixed figures; the page passes the
// server's summary.

type Summary = Extract<
  RouterOutputs["eyeonGatewayHealth"]["summary"],
  { enabled: true }
>;
type Health = NonNullable<Summary["health"]>;
type Model = Health["models"][number];
type Mirror = NonNullable<Summary["mirror"]>;

type GatewayRouteLinks = {
  gateway: string;
  requests: string;
  applications: string;
};

const STATUS_TONE: Record<ModelHealthStatus, EyeonTone> = {
  healthy: "allow",
  unhealthy: "block",
  unknown: "neutral",
};

const STATUS_ICON = {
  healthy: CheckCircle2,
  unhealthy: Ban,
  unknown: CircleHelp,
} as const;

/** "20:09 UTC" from an ISO time. */
function clock(iso: string): string {
  return utcTime(iso).slice(11);
}

/** When the last check ran, as the cards say it. */
function checkWords(health: Health): string {
  if (!health.checkedAt) return "No health check recorded";
  return health.fresh
    ? `Checked ${clock(health.checkedAt)}`
    : `Stale as of ${clock(health.checkedAt)}`;
}

/** How many applications' keys may call a model, in words. */
function routeWords(model: Model): string {
  const n = model.routes.count;
  if (n === 0) return "No application key routes here";
  return `${n.toLocaleString()} application ${n === 1 ? "key" : "keys"}`;
}

function newestRowWords(mirror: Mirror | null, now: string): string {
  if (!mirror) return "Switched off";
  return mirror.newestArrival
    ? ageText(mirror.newestArrival, now)
    : "No call in this period";
}

export function EyeonGatewayRouteMap({
  data,
  links,
}: {
  data: Summary;
  links: GatewayRouteLinks;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const health = data.health;
  const model = health?.models.find((m) => m.model === selected) ?? null;
  return (
    <section aria-labelledby="gateway-health-now">
      <Card>
        <CardContent className="flex flex-col gap-6 p-5">
          <Headline data={data} />
          {!health ? null : health.checkedAt && health.models.length > 0 ? (
            <RouteMap
              data={data}
              health={health}
              links={links}
              onSelect={setSelected}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {health.checkedAt
                ? "The last health check listed no models."
                : "No health check is recorded yet. Opening the model list on the LLM Gateway page runs one."}
            </p>
          )}
          <Footer data={data} links={links} />
        </CardContent>
      </Card>
      {health && model ? (
        <ModelSheet
          model={model}
          health={health}
          data={data}
          links={links}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The headline and its facts
// ---------------------------------------------------------------------------

function Headline({ data }: { data: Summary }) {
  const health = data.health;
  const counts = health?.counts;
  const failing = health?.models.filter((m) => m.status === "unhealthy") ?? [];
  const now = data.generatedAt;
  const causes = failing
    .map(
      (m) =>
        `${m.model}: ${HEALTH_CAUSE[m.cause ?? "unknown"].label.toLowerCase()}.`,
    )
    .join(" ");
  const headline = routeHeadline(health);
  const unchecked = counts?.unknown ?? 0;
  const tail = [
    unchecked > 0
      ? `${unchecked.toLocaleString()} ${unchecked === 1 ? "model was" : "models were"} not in the check.`
      : "",
    health?.checkedAt
      ? `The gateway answered the last check${data.mirror?.newestArrival ? `, and the request-log mirror's newest row arrived ${ageText(data.mirror.newestArrival, now)}` : ""}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const facts = [
    {
      key: "Gateway",
      value: health?.checkedAt ? "Reachable" : "Not checked",
      title: health?.checkedAt
        ? `It answered the last health check, at ${utcTime(health.checkedAt)}. This page does not call the gateway.`
        : "No health check is recorded.",
      warn: false,
    },
    {
      key: "Models answering",
      value:
        counts && counts.total > 0
          ? `${counts.healthy.toLocaleString()} of ${counts.total.toLocaleString()}`
          : "Not available",
      title: "Models that passed the last health check.",
      warn: false,
    },
    {
      key: "Last health check",
      value: health ? checkWords(health) : "Not available",
      title: health?.checkedAt
        ? `${utcTime(health.checkedAt)}, ${ageText(health.checkedAt, now)}. A result is kept for ${health.cacheMinutes} minutes.`
        : "No health check is recorded.",
      warn: Boolean(health?.checkedAt && !health.fresh),
    },
    {
      key: "Mirror's newest row",
      value: newestRowWords(data.mirror, now),
      title: data.mirror
        ? `The newest call of this project in the period to reach the request-log mirror. Expected lag up to about ${data.mirror.expectedLagMinutes} minutes.`
        : "The request-log mirror is switched off on this deployment.",
      warn: false,
    },
  ];
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-3">
        <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full bg-current",
              EYEON_TONE_TEXT.info,
            )}
          />
          Right now · point in time
        </span>
        <h2 id="gateway-health-now" className="text-2xl font-bold lg:text-3xl">
          {headline.lead ? (
            <>
              <span className={EYEON_TONE_TEXT.block}>
                {headline.lead}
              </span>{" "}
            </>
          ) : null}
          {headline.rest}
        </h2>
        {causes || tail ? (
          <p className="text-muted-foreground max-w-prose text-sm">
            {[causes, tail].filter(Boolean).join(" ")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1"
            title="Only the latest health check is kept, so no health trend can be drawn."
          >
            <Clock aria-hidden className="size-3" />
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
            className="gap-1"
            title="This page reads no prompt or answer text, error text, token hash or key secret."
          >
            <FlaskConical aria-hidden className="size-3" />
            Metadata only
          </Badge>
        </div>
      </div>
      <dl className="grid shrink-0 grid-cols-2 gap-2 lg:w-96">
        {facts.map((f) => (
          <div
            key={f.key}
            className="flex min-w-0 flex-col gap-1 rounded-md border p-3"
            title={f.title}
          >
            <dt className="text-muted-foreground text-xs">{f.key}</dt>
            <dd
              className={cn(
                "font-bold break-words",
                f.warn ? EYEON_TONE_TEXT.redact : undefined,
              )}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The route map
// ---------------------------------------------------------------------------

function RouteMap({
  data,
  health,
  links,
  onSelect,
}: {
  data: Summary;
  health: Health;
  links: GatewayRouteLinks;
  onSelect: (model: string) => void;
}) {
  const layout = routeLayout(health.models.length);
  const checked = checkWords(health);
  return (
    <div
      role="group"
      aria-label={`Route map: applications, the gateway, ${health.counts.total.toLocaleString()} models and the request-log mirror`}
      className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,10rem)_auto_minmax(0,14rem)_auto_minmax(0,1fr)] lg:gap-0"
    >
      <Link
        href={links.applications}
        className="hover:bg-muted/50 focus-visible:ring-ring flex items-center gap-3 rounded-md border border-dashed p-3 focus-visible:ring-2 focus-visible:outline-hidden lg:col-start-1 lg:row-start-1"
      >
        <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
          <LayoutGrid
            aria-hidden
            className={cn("size-4", EYEON_TONE_TEXT.accent)}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-2xl font-bold tabular-nums">
            {data.applications === null
              ? "–"
              : data.applications.toLocaleString()}
          </span>
          <span className="text-muted-foreground text-xs">
            applications via gateway keys
          </span>
        </span>
      </Link>

      <svg
        aria-hidden
        width={ROUTE_LEAD_PX}
        height={layout.height}
        viewBox={`0 0 ${ROUTE_LEAD_PX} ${layout.height}`}
        className={cn(
          "hidden lg:col-start-2 lg:row-start-1 lg:block",
          EYEON_TONE_TEXT.neutral,
        )}
      >
        <line
          x1={0}
          y1={layout.gatewayY}
          x2={ROUTE_LEAD_PX}
          y2={layout.gatewayY}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      </svg>

      <Link
        href={links.gateway}
        className="hover:bg-muted/50 focus-visible:ring-ring bg-card flex h-44 flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center focus-visible:ring-2 focus-visible:outline-hidden lg:col-start-3 lg:row-start-1"
        title="Open the LLM Gateway, where health is checked and models are managed"
      >
        <span className="bg-muted relative flex size-12 items-center justify-center rounded-full">
          <Server
            aria-hidden
            className={cn("size-5", EYEON_TONE_TEXT.accent)}
          />
          <span
            aria-hidden
            className={cn(
              "absolute right-0 bottom-0 size-2.5 rounded-full bg-current",
              EYEON_TONE_TEXT.allow,
            )}
          />
        </span>
        <span className="text-lg font-bold">Gateway</span>
        <Badge variant="success" className="gap-1">
          <CheckCircle2 aria-hidden className="size-3" />
          Reachable
        </Badge>
        <span className="text-muted-foreground text-xs">
          {health.fresh ? "At the last check" : checked}
        </span>
      </Link>

      <div className="flex flex-col items-stretch lg:col-start-3 lg:row-start-2">
        <span
          aria-hidden
          className="mx-auto hidden h-5 border-l-2 border-dashed lg:block"
        />
        <Link
          href={links.requests}
          className="hover:bg-muted/50 focus-visible:ring-ring flex flex-col gap-2 rounded-md border p-3 focus-visible:ring-2 focus-visible:outline-hidden"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Database aria-hidden className="size-4" />
            Request-log mirror
          </span>
          {data.mirror ? (
            <>
              <EyeonMirrorChip state={data.mirror.state} />
              <MirrorBar mirror={data.mirror} now={data.generatedAt} />
            </>
          ) : (
            <span className="text-muted-foreground text-xs">
              Switched off on this deployment
            </span>
          )}
        </Link>
      </div>

      <svg
        aria-hidden
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="hidden lg:col-start-4 lg:row-start-1 lg:block"
      >
        {health.models.map((m, i) => {
          const wire = layout.wires[i];
          if (!wire) return null;
          const tone = EYEON_TONE_TEXT[STATUS_TONE[m.status]];
          return (
            <g key={m.model} className={tone}>
              <path
                d={wire.path}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={m.status === "healthy" ? undefined : "4 4"}
              />
              {m.status === "unhealthy" ? (
                <g>
                  <circle
                    cx={wire.mid.x}
                    cy={wire.mid.y}
                    r={7}
                    className="fill-card"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                  <path
                    d={`M ${wire.mid.x - 3} ${wire.mid.y - 3} L ${wire.mid.x + 3} ${wire.mid.y + 3} M ${wire.mid.x + 3} ${wire.mid.y - 3} L ${wire.mid.x - 3} ${wire.mid.y + 3}`}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>

      <ul
        aria-label="Models"
        className="flex min-w-0 flex-col justify-center gap-2 lg:col-start-5 lg:row-start-1 lg:self-stretch"
      >
        {health.models.map((m) => (
          <li key={m.model}>
            <ModelCard model={m} checked={checked} onSelect={onSelect} />
          </li>
        ))}
        {health.more > 0 ? (
          <li className="text-muted-foreground text-xs">
            {health.more.toLocaleString()} more on the LLM Gateway page.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function ModelCard({
  model,
  checked,
  onSelect,
}: {
  model: Model;
  checked: string;
  onSelect: (model: string) => void;
}) {
  const Icon = STATUS_ICON[model.status];
  const tone = EYEON_TONE_TEXT[STATUS_TONE[model.status]];
  const cause =
    model.status === "unhealthy"
      ? HEALTH_CAUSE[model.cause ?? "unknown"].label
      : null;
  const meta = `${checked} · ${routeWords(model)}`;
  return (
    <button
      type="button"
      onClick={() => onSelect(model.model)}
      aria-label={`${model.model}: ${model.status === "healthy" ? "Healthy" : model.status === "unhealthy" ? `Unhealthy, ${cause ?? ""}` : "Not in the check"}. Open details.`}
      className={cn(
        "hover:bg-muted/50 focus-visible:ring-ring flex h-16 w-full items-center gap-3 rounded-md border border-l-4 px-3 text-left focus-visible:ring-2 focus-visible:outline-hidden",
        model.status === "healthy" && "border-l-dark-green",
        model.status === "unhealthy" &&
          "border-dark-red/60 border-l-dark-red bg-dark-red/5",
        model.status === "unknown" && "border-l-border",
      )}
    >
      <span
        className={cn(
          "bg-muted flex size-8 shrink-0 items-center justify-center rounded-full",
          tone,
        )}
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate font-mono text-sm font-bold"
          title={model.model}
        >
          {model.model}
        </span>
        {cause ? (
          <span className={cn("truncate text-xs", tone)} title={cause}>
            {cause}
          </span>
        ) : null}
        <span className="text-muted-foreground truncate text-xs" title={meta}>
          {meta}
        </span>
      </span>
      <EyeonModelHealthChip status={model.status} />
    </button>
  );
}

/**
 * How old the mirror's newest row is against the expected lag: the bar is
 * the age, the mark is the lag the mirror is designed to stay within.
 */
function MirrorBar({ mirror, now }: { mirror: Mirror; now: string }) {
  if (!mirror.newestArrival) {
    return (
      <span className="text-muted-foreground text-xs">
        No call of this project reached the mirror in this period; lag up to{" "}
        {mirror.expectedLagMinutes} min.
      </span>
    );
  }
  const minutes = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(mirror.newestArrival)) / 60_000),
  );
  return (
    <>
      <EyeonBullet
        label="Newest row"
        value={minutes}
        target={mirror.expectedLagMinutes}
        valueText={`${minutes.toLocaleString()} min`}
        targetText={`${mirror.expectedLagMinutes} min lag`}
        tone={MIRROR_STATE[mirror.state].tone === "bad" ? "redact" : "info"}
      />
      <span className="text-muted-foreground text-xs">
        Newest row {ageText(mirror.newestArrival, now)} · lag up to{" "}
        {mirror.expectedLagMinutes} min
      </span>
    </>
  );
}

function Footer({ data, links }: { data: Summary; links: GatewayRouteLinks }) {
  const health = data.health;
  const expired = Boolean(health?.checkedAt && !health.fresh);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
      <span>
        {expired
          ? `Health cache expired: re-check on the LLM Gateway page for a fresh result. `
          : `Health is checked from the LLM Gateway page, at most once every ${health?.cacheMinutes ?? 5} minutes. `}
        No health history is kept, so this page draws no health trend.
      </span>
      <Link href={links.gateway} className="text-foreground underline">
        {data.canCheckHealth
          ? "Re-check on the LLM Gateway"
          : "Open the LLM Gateway"}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A model's detail
// ---------------------------------------------------------------------------

function ModelSheet({
  model,
  health,
  data,
  links,
  onClose,
}: {
  model: Model;
  health: Health;
  data: Summary;
  links: GatewayRouteLinks;
  onClose: () => void;
}) {
  const words = WINDOW_WORDS[data.window];
  const cause =
    model.status === "unhealthy"
      ? HEALTH_CAUSE[model.cause ?? "unknown"]
      : null;
  const calls = data.failures?.byModel.shown.find(
    (r) => r.model === model.model,
  );
  const more = model.routes.count - model.routes.applications.length;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-mono">{model.model}</SheetTitle>
          <SheetDescription>
            {checkWords(health)}
            {health.checkedAt
              ? `, ${ageText(health.checkedAt, data.generatedAt)}`
              : ""}
            . Point in time: no health history is kept.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <EyeonModelHealthChip status={model.status} />
          <span className="text-muted-foreground">
            {model.providers.length > 0
              ? `Provider: ${model.providers.join(", ")}`
              : "Provider not listed"}
          </span>
        </div>

        {cause ? (
          <section
            aria-label="What to do"
            className="flex flex-col gap-2 text-sm"
          >
            <h3 className={cn("font-bold", EYEON_TONE_TEXT.block)}>
              {cause.label}
            </h3>
            <p>{cause.means}</p>
            {data.canCheckHealth ? null : (
              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
                Read-only for your role: an Owner or Admin carries out these
                steps.
              </p>
            )}
            <ol className="list-decimal pl-5">
              {cause.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
        ) : null}

        <section
          aria-label="Applications"
          className="flex flex-col gap-2 text-sm"
        >
          <h3 className="font-bold">Applications that may call it</h3>
          {model.routes.count === 0 ? (
            <p className="text-muted-foreground">
              No application&apos;s key routes to this model.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {model.routes.applications.map((a) => (
                <li key={a.lineageId}>
                  <Link
                    href={`${links.applications}/${encodeURIComponent(a.lineageId)}`}
                    className="underline"
                  >
                    {a.name}
                  </Link>
                </li>
              ))}
              {more > 0 ? (
                <li className="text-muted-foreground text-xs">
                  and {more.toLocaleString()} more
                </li>
              ) : null}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">
            From each application&apos;s current key: its own model list, else
            its team&apos;s, else every model.
          </p>
        </section>

        <section
          aria-label="Request log"
          className="flex flex-col gap-2 text-sm"
        >
          <h3 className="font-bold">Request log, last {words.period}</h3>
          {!data.failures ? (
            <p className="text-muted-foreground">
              The request log is switched off on this deployment.
            </p>
          ) : calls ? (
            <dl className="grid grid-cols-2 gap-2">
              <Fact k="Calls" v={calls.calls.toLocaleString()} />
              <Fact
                k="Failed"
                v={`${calls.failed.toLocaleString()} (${formatCallShare(calls.failed, calls.calls)})`}
              />
              <Fact
                k="Median duration"
                v={
                  calls.p50Ms === null
                    ? "Too few calls"
                    : formatDurationMs(calls.p50Ms)
                }
              />
              <Fact
                k="95th percentile"
                v={
                  calls.p95Ms === null
                    ? "Too few calls"
                    : formatDurationMs(calls.p95Ms)
                }
              />
            </dl>
          ) : (
            <p className="text-muted-foreground">
              No calls to this model among the most-called models in this
              period.
            </p>
          )}
        </section>

        <div className="mt-auto flex flex-wrap gap-4 border-t pt-3 text-sm">
          <Link href={links.gateway} className="underline">
            {data.canCheckHealth
              ? "Re-check on the LLM Gateway"
              : "Open the LLM Gateway"}
          </Link>
          <Link href={links.requests} className="underline">
            Open Gateway requests
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col rounded-md border p-2">
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="font-bold tabular-nums">{v}</dd>
    </div>
  );
}
