import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { LayoutGrid } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { cn } from "@/src/utils/tailwind";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import {
  EyeonRing,
  EyeonSparkline,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import { EyeonModeChip } from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import {
  EyeonArrangeBar,
  EyeonArrangeFrame,
  EyeonArrangeZone,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonArrange";
import {
  AdoptionWidget,
  AppRiskWidget,
  AttentionWidget,
  BudgetsWidget,
  EyeonWidgetState,
  GatewayWidget,
  IntegrityWidget,
  ModelMixWidget,
  NotRecordedWidget,
  PostureWidget,
  SpendWidget,
  StoppedWidget,
  ThreatsWidget,
  TopAppsWidget,
} from "@/src/features/acme-enhancements/components/home/EyeonCommandWidgets";
import {
  type CommandCentreInput,
  type HomeSource,
  attentionItems,
  briefing,
  commandLinks,
  greeting,
  plural,
  postureRings,
  ready,
} from "@/src/features/acme-enhancements/utils/eyeonCommandCentre";
import {
  COMMAND_LENSES,
  COMMAND_LENS_NAMES,
  COMMAND_WIDGET_NAMES,
  type CommandLens,
  type CommandWidgetId,
  isLensLayout,
  lensLayout,
  resizeWidget,
  sizeWords,
  widgetSize,
  withWidgets,
} from "@/src/features/acme-enhancements/utils/eyeonCommandLayout";
import {
  cardSpans,
  hiddenWidgets,
  hideWidget,
  moveWidget,
  moveWidgetTo,
  showWidget,
  shownWidgets,
} from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";
import { useEyeonCommandLayout } from "@/src/features/acme-enhancements/utils/useEyeonCommandLayout";
import {
  formatCount,
  formatUsd,
} from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";
import { formatShare } from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";

// ACME (CHG-2026-147, ADR-0030): the EYEON command centre, the project Home
// for an executive and a security lead. Top to bottom: a briefing in
// sentences with three rings, a strip of headline figures, and widgets each
// person can move anywhere, resize and hide, starting from a view
// (Everything, Executive, Security). Props only: the page
// (EyeonCommandCentrePage) does the reads.

type Source = keyof Pick<
  CommandCentreInput,
  "overview" | "spend" | "health" | "decisions" | "enforcement"
>;

const SOURCE_NAMES: Record<Source, string> = {
  overview: "guardrail decisions and applications",
  spend: "spend",
  health: "gateway health",
  decisions: "policy types",
  enforcement: "control integrity",
};

/** The source each widget needs; without access to it the widget is not offered. */
const WIDGET_SOURCE: Partial<Record<CommandWidgetId, Source>> = {
  posture: "overview",
  stopped: "overview",
  appRisk: "overview",
  spend: "spend",
  modelMix: "spend",
  budgets: "spend",
  gateway: "health",
  threats: "decisions",
  integrity: "enforcement",
};

export function EyeonCommandCentre({
  input,
  userId,
  viewerName,
  now = new Date(),
  onWindowDaysChange,
}: {
  input: CommandCentreInput;
  userId: string | undefined;
  viewerName: string | null;
  /** The viewer's clock, for the greeting and the date. */
  now?: Date;
  onWindowDaysChange: (days: 7 | 30) => void;
}) {
  const links = commandLinks(input);
  const attention = attentionItems(input);
  const brief = briefing(input, attention);
  const rings = postureRings(input);
  const overview = ready(input.overview);
  const spend = ready(input.spend);
  const health = ready(input.health);
  const decisions = ready(input.decisions);
  const enforcement = ready(input.enforcement);
  const { windowDays } = input;

  const arrangement = useEyeonCommandLayout(input.projectId, userId);
  const layout = arrangement.layout;
  const [arranging, setArranging] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // The arrange controls, by key, so focus can follow a moved, resized,
  // hidden or shown widget instead of falling back to the page.
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const buttonRef = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(key, element);
    else buttons.current.delete(key);
  };
  const focusFirst = (keys: string[]) => {
    for (const key of keys) {
      const element = buttons.current.get(key);
      if (element && !element.disabled) {
        element.focus();
        return;
      }
    }
  };
  const commit = (change: () => void, focus: string[]) => {
    flushSync(change);
    focusFirst(focus);
  };

  const isAvailable = (id: CommandWidgetId) => {
    const source = WIDGET_SOURCE[id];
    if (source) return input[source].state !== "noAccess";
    // Adoption reads Spend, else Gateway health.
    if (id === "adoption")
      return (
        input.spend.state !== "noAccess" || input.health.state !== "noAccess"
      );
    return true;
  };
  const name = (id: string) => COMMAND_WIDGET_NAMES[id as CommandWidgetId];
  const shown = shownWidgets(layout.widgets, isAvailable);
  const hidden = hiddenWidgets(layout.widgets, isAvailable);
  const spans = cardSpans(shown, (id) => widgetSize(layout, id));
  const placeMessage = (id: CommandWidgetId, order: CommandWidgetId[]) =>
    `${name(id)} moved to place ${order.indexOf(id) + 1} of ${order.length}.`;

  const move = (id: CommandWidgetId, direction: "earlier" | "later") => {
    const next = moveWidget(layout.widgets, id, direction, isAvailable);
    commit(() => {
      arrangement.save(withWidgets(layout, next));
      setAnnouncement(placeMessage(id, shownWidgets(next, isAvailable)));
    }, [
      `w:${id}:${direction}`,
      `w:${id}:${direction === "earlier" ? "later" : "earlier"}`,
    ]);
  };
  const drop = (id: string, target: string) => {
    const next = moveWidgetTo(
      layout.widgets,
      id as CommandWidgetId,
      target as CommandWidgetId,
    );
    arrangement.save(withWidgets(layout, next));
    setAnnouncement(
      placeMessage(id as CommandWidgetId, shownWidgets(next, isAvailable)),
    );
  };
  const resize = (id: CommandWidgetId, direction: "wider" | "narrower") => {
    const next = resizeWidget(layout, id, direction);
    commit(() => {
      arrangement.save(next);
      setAnnouncement(
        `${name(id)} now takes ${sizeWords(widgetSize(next, id))} on large screens.`,
      );
    }, [
      `w:${id}:${direction}`,
      `w:${id}:${direction === "wider" ? "narrower" : "wider"}`,
    ]);
  };
  const hide = (id: CommandWidgetId) =>
    commit(() => {
      arrangement.save(withWidgets(layout, hideWidget(layout.widgets, id)));
      setAnnouncement(
        `${name(id)} hidden. Show it again from the hidden list.`,
      );
    }, [`show:${id}`, "done"]);
  const show = (id: CommandWidgetId) =>
    commit(() => {
      arrangement.save(withWidgets(layout, showWidget(layout.widgets, id)));
      setAnnouncement(`${name(id)} shown again.`);
    }, [`w:${id}:hide`, "done"]);
  const chooseLens = (lens: CommandLens) => {
    arrangement.save(lensLayout(lens));
    setAnnouncement(`${COMMAND_LENS_NAMES[lens]} view applied.`);
  };
  const resetToDefault = () =>
    commit(() => {
      arrangement.reset();
      setAnnouncement("Default arrangement restored.");
    }, ["reset", "done"]);

  const widget = (id: CommandWidgetId): ReactNode => {
    const title = COMMAND_WIDGET_NAMES[id];
    const pending = (source: HomeSource<unknown>) =>
      source.state === "ready" || source.state === "noAccess" ? null : (
        <EyeonWidgetState
          title={title}
          state={source.state}
          message={
            source.state === "error"
              ? source.message
              : source.state === "off"
                ? source.reason
                : undefined
          }
        />
      );
    switch (id) {
      case "attention":
        return (
          <AttentionWidget
            items={attention}
            sourcesMissing={(Object.keys(SOURCE_NAMES) as Source[])
              .filter((s) => input[s].state === "error")
              .map((s) => SOURCE_NAMES[s])}
          />
        );
      case "posture":
        return overview ? (
          <PostureWidget overview={overview} href={links.enforcement} />
        ) : (
          pending(input.overview)
        );
      case "stopped":
        return overview ? (
          <StoppedWidget overview={overview} href={links.decisions} />
        ) : (
          pending(input.overview)
        );
      case "appRisk":
        return overview ? (
          <AppRiskWidget overview={overview} href={links.applications} />
        ) : (
          pending(input.overview)
        );
      case "spend":
        return spend && links.spend ? (
          <SpendWidget spend={spend} href={links.spend} />
        ) : (
          pending(input.spend)
        );
      case "modelMix":
        return spend && links.spend ? (
          <ModelMixWidget
            spend={spend}
            href={links.spend}
            windowDays={windowDays}
          />
        ) : (
          pending(input.spend)
        );
      case "budgets":
        return spend && links.spend ? (
          <BudgetsWidget spend={spend} href={links.spend} />
        ) : (
          pending(input.spend)
        );
      case "adoption":
        return spend || health ? (
          <AdoptionWidget
            spend={spend}
            health={health}
            href={links.spend ?? links.health}
            windowDays={windowDays}
          />
        ) : (
          pending(input.spend.state === "noAccess" ? input.health : input.spend)
        );
      case "gateway":
        return health ? (
          <GatewayWidget health={health} href={links.health} />
        ) : (
          pending(input.health)
        );
      case "threats":
        return decisions ? (
          <ThreatsWidget decisions={decisions} href={links.decisions} />
        ) : (
          pending(input.decisions)
        );
      case "integrity":
        return enforcement ? (
          <IntegrityWidget
            enforcement={enforcement}
            health={health}
            href={links.enforcement}
          />
        ) : (
          pending(input.enforcement)
        );
      case "topApps":
        return (
          <TopAppsWidget
            spend={spend}
            decisions={decisions}
            href={links.applications}
            windowDays={windowDays}
          />
        );
      case "notRecorded":
        return <NotRecordedWidget links={links} />;
    }
  };

  const lensValue = isLensLayout(layout, "everything")
    ? "everything"
    : layout.lens;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Briefing"
        className="from-primary-accent/10 via-card to-card relative overflow-hidden rounded-xl border bg-linear-to-br p-5 md:p-6"
      >
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex max-w-3xl min-w-0 flex-col gap-3">
            <span className="text-muted-foreground text-sm">
              {greeting(now.getHours(), viewerName)} ·{" "}
              {now.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            <h2
              className={cn(
                "text-2xl font-bold tracking-tight md:text-3xl",
                brief.tone === "act" && "text-dark-red",
                brief.tone === "watch" && "text-dark-yellow",
              )}
            >
              {brief.lead}
            </h2>
            <div className="flex flex-col gap-1.5 text-sm md:text-base">
              {brief.sentences.map((parts, i) => (
                <p key={i}>
                  {parts.map((part, j) =>
                    part.strong ? (
                      <strong
                        key={j}
                        className="text-primary-accent font-bold tabular-nums"
                      >
                        {part.text}
                      </strong>
                    ) : (
                      <span key={j}>{part.text}</span>
                    ),
                  )}
                </p>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {overview ? (
                <EyeonModeChip
                  mode={overview.mode.mode}
                  ceiling={overview.mode.ceiling}
                />
              ) : null}
              <Badge
                variant="outline"
                title="Only traffic through the EYEON gateway is checked and counted. Traffic that bypasses it is not."
              >
                Gateway traffic only
              </Badge>
              <Badge
                variant="outline"
                title="This page reads no prompt or answer text."
              >
                Metadata only
              </Badge>
            </div>
          </div>
          {rings.length > 0 ? (
            <ul
              className="grid grid-cols-3 justify-items-center gap-2 sm:flex sm:justify-center sm:gap-4"
              aria-label="Posture rings"
            >
              {rings.map((ring) => (
                <li
                  key={ring.key}
                  className="flex w-full max-w-36 flex-col items-center gap-1 sm:w-36"
                >
                  <span className="text-center text-xs font-bold sm:text-sm">
                    {ring.label}
                  </span>
                  <EyeonRing
                    label={`${ring.label}: ${ring.centerText} ${ring.caption}`}
                    fraction={ring.fraction}
                    centerText={ring.centerText}
                    caption={ring.caption}
                    tone={ring.tone}
                    size="responsive"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <KpiStrip input={input} links={links} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Your dashboard</h2>
        <div className="flex flex-wrap items-center gap-2">
          {!arranging && hidden.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              {plural(hidden.length, "widget")} hidden
            </span>
          ) : null}
          <Select
            value={lensValue}
            onValueChange={(v) => {
              if ((COMMAND_LENSES as readonly string[]).includes(v))
                chooseLens(v as CommandLens);
            }}
          >
            <SelectTrigger
              className="w-48"
              aria-label="View"
              title="Start from a view; choosing one replaces your arrangement"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMAND_LENSES.map((lens) => (
                <SelectItem key={lens} value={lens}>
                  {COMMAND_LENS_NAMES[lens]} view
                </SelectItem>
              ))}
              {lensValue === "custom" ? (
                <SelectItem value="custom" disabled>
                  {COMMAND_LENS_NAMES.custom}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <Select
            value={String(windowDays)}
            onValueChange={(v) => onWindowDaysChange(v === "30" ? 30 : 7)}
          >
            <SelectTrigger className="w-36" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          {arranging ? null : (
            <Button
              type="button"
              variant="outline"
              ref={buttonRef("arrange")}
              title="Move, resize or hide this page's widgets, for you only"
              onClick={() =>
                commit(() => {
                  setArranging(true);
                  setAnnouncement("");
                }, ["done"])
              }
            >
              <LayoutGrid className="mr-1 h-4 w-4" aria-hidden="true" />
              Arrange
            </Button>
          )}
        </div>
      </div>

      {arranging ? (
        <EyeonArrangeBar
          intro="Drag widgets by their grip, or use the buttons, to move them anywhere; make them wider or narrower; hide what you do not need."
          hidden={hidden.map((id) => ({
            key: id,
            name: COMMAND_WIDGET_NAMES[id],
            onShow: () => show(id),
          }))}
          onReset={resetToDefault}
          resetDisabled={isLensLayout(layout, "everything")}
          onDone={() => commit(() => setArranging(false), ["arrange"])}
          buttonRef={buttonRef}
          storageRefused={arrangement.storageRefused}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {shown.length > 0 ? (
        <EyeonArrangeZone ids={shown} nameOf={name} onDrop={drop}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {shown.map((id, index) => (
              <EyeonArrangeFrame
                key={id}
                id={id}
                name={COMMAND_WIDGET_NAMES[id]}
                place={index + 1}
                count={shown.length}
                arranging={arranging}
                span={spans.get(id)}
                resize={{
                  size: widgetSize(layout, id),
                  sizeText: sizeWords(widgetSize(layout, id)),
                  onWider: () => resize(id, "wider"),
                  onNarrower: () => resize(id, "narrower"),
                }}
                onMoveEarlier={() => move(id, "earlier")}
                onMoveLater={() => move(id, "later")}
                onHide={() => hide(id)}
                buttonRef={(action) => buttonRef(`w:${id}:${action}`)}
              >
                {widget(id)}
              </EyeonArrangeFrame>
            ))}
          </div>
        </EyeonArrangeZone>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          Every widget is hidden.{" "}
          {arranging
            ? "Show widgets again from the hidden list, or reset to default."
            : "Use Arrange, or choose a view, to show widgets again."}
        </p>
      )}
    </div>
  );
}

/** The headline figures, each opening the page behind it. */
function KpiStrip({
  input,
  links,
}: {
  input: CommandCentreInput;
  links: ReturnType<typeof commandLinks>;
}) {
  const overview = ready(input.overview);
  const spend = ready(input.spend);
  const health = ready(input.health);
  const period = `last ${input.windowDays} days`;
  const waiting = (source: HomeSource<unknown>) =>
    source.state === "loading"
      ? ({ state: "measured", value: "…" } as const)
      : ({
          state: "notRecorded",
          reason:
            source.state === "off"
              ? "Its EYEON page is switched off on this deployment."
              : "It could not be loaded.",
        } as const);
  const tiles: ReactNode[] = [];

  const calls = spend?.period.totals.calls ?? health?.failures?.calls ?? null;
  if (input.spend.state !== "noAccess" || input.health.state !== "noAccess") {
    const series = spend
      ? spend.period.series.map((p) => ({ label: p.label, value: p.calls }))
      : (health?.failures?.series.map((p) => ({
          label: p.label,
          value: p.calls,
        })) ?? []);
    tiles.push(
      <EyeonKpiTile
        key="calls"
        label="AI calls"
        figure={
          calls === null
            ? waiting(spend ? input.health : input.spend)
            : { state: "measured", value: formatCount(calls) }
        }
        subtitle={`Through the gateway, ${period}`}
        href={links.spend ?? links.health}
        trend={
          series.length > 0 ? (
            <EyeonSparkline label="AI calls over the period" points={series} />
          ) : undefined
        }
      />,
    );
  }
  if (input.spend.state !== "noAccess") {
    tiles.push(
      <EyeonKpiTile
        key="spend"
        label="Spend this month"
        figure={
          spend
            ? { state: "measured", value: formatUsd(spend.month.spentUsd) }
            : waiting(input.spend)
        }
        subtitle="Month to date, UTC"
        delta={
          spend && spend.month.projectedUsd !== null
            ? {
                text: `On pace for ${formatUsd(spend.month.projectedUsd)}`,
                tone: "neutral",
              }
            : undefined
        }
        href={links.spend ?? undefined}
        trend={
          spend ? (
            <EyeonSparkline
              label="Spend so far this month, by UTC day"
              points={spend.month.days.map((d) => ({
                label: d.day,
                value: d.cumulativeUsd,
              }))}
            />
          ) : undefined
        }
      />,
    );
  }
  const d = overview?.decisions;
  const flagged = d
    ? d.promptsRefused.enforced +
      d.promptsRefused.notEnforced +
      d.answersWithheld.enforced +
      d.answersWithheld.notEnforced +
      d.redactions.enforced +
      d.redactions.notEnforced
    : null;
  const letThrough = d
    ? d.promptsRefused.notEnforced + d.answersWithheld.notEnforced
    : 0;
  tiles.push(
    <EyeonKpiTile
      key="flagged"
      label="Risks flagged"
      figure={
        flagged === null
          ? waiting(input.overview)
          : { state: "measured", value: formatCount(flagged) }
      }
      subtitle={`Refuse, withhold or redact, ${period}`}
      delta={
        d
          ? letThrough > 0
            ? { text: `${formatCount(letThrough)} let through`, tone: "bad" }
            : { text: "None let through", tone: "good" }
          : undefined
      }
      href={links.decisions}
      trend={
        overview ? (
          <EyeonSparkline
            label="Flagged prompts and answers per UTC day"
            points={overview.daily.map((p) => ({
              label: p.day,
              value: p.promptsRefused + p.answersWithheld + p.redactions,
            }))}
            tone="block"
          />
        ) : undefined
      }
    />,
  );
  tiles.push(
    <EyeonKpiTile
      key="enforced"
      label="Enforced"
      figure={
        d
          ? d.enforcedPct === null
            ? {
                state: "notRecorded",
                reason: "No guardrail checks in the period.",
              }
            : { state: "measured", value: formatShare(d.enforcedPct) }
          : waiting(input.overview)
      }
      subtitle={`Of ${d ? formatCount(d.checks) : "the"} guardrail checks, ${period}`}
      delta={
        overview
          ? overview.mode.mode === "enforce"
            ? { text: "Enforce mode", tone: "good" }
            : { text: "Record mode: nothing is stopped", tone: "bad" }
          : undefined
      }
      href={links.enforcement}
    />,
  );
  const apps = overview?.applications;
  tiles.push(
    <EyeonKpiTile
      key="applications"
      label="Applications"
      figure={
        overview
          ? apps
            ? { state: "measured", value: apps.total.toLocaleString("en-US") }
            : {
                state: "notRecorded",
                reason: "Gateway management is switched off.",
              }
          : waiting(input.overview)
      }
      subtitle="Rated on the scorecard"
      delta={
        apps
          ? apps.byOverall.red > 0
            ? { text: `${apps.byOverall.red} need action`, tone: "bad" }
            : { text: "None need action", tone: "good" }
          : undefined
      }
      href={links.applications ?? undefined}
    />,
  );
  const counts = health?.health?.counts;
  tiles.push(
    <EyeonKpiTile
      key="models"
      label="Models healthy"
      figure={
        health
          ? counts && counts.total > 0
            ? {
                state: "measured",
                value: `${counts.healthy} of ${counts.healthy + counts.unhealthy}`,
              }
            : {
                state: "notRecorded",
                reason: "No model health check recorded.",
              }
          : waiting(input.health)
      }
      subtitle="At the last health check"
      delta={
        counts
          ? counts.unhealthy > 0
            ? { text: `${counts.unhealthy} failing`, tone: "bad" }
            : { text: "None failing", tone: "good" }
          : undefined
      }
      href={links.health}
    />,
  );

  return (
    <section
      aria-label="Headline figures"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
    >
      {tiles}
    </section>
  );
}
