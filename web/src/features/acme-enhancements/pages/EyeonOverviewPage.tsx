import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { LayoutGrid } from "lucide-react";
import Page from "@/src/components/layouts/page";
import { Card, CardContent } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api, type RouterOutputs } from "@/src/utils/api";
import { DIMENSION_LABEL } from "@/src/features/acme-enhancements/components/AcmeApplicationsScorecard";
import { EyeonCard } from "@/src/features/acme-enhancements/components/eyeon/EyeonCard";
import {
  EyeonBullet,
  EyeonChartTable,
  EyeonRing,
  EyeonSparkline,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import {
  EyeonDecisionChip,
  EyeonModeChip,
  EyeonRatingChip,
  ratingFromBand,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonChips";
import { EyeonNotRecorded } from "@/src/features/acme-enhancements/components/eyeon/EyeonHonestLabels";
import { EyeonKpiTile } from "@/src/features/acme-enhancements/components/eyeon/EyeonKpiTile";
import {
  EyeonArrangeBar,
  EyeonArrangeFrame,
  EyeonArrangeZone,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonArrange";
import {
  budgetPeriodLabel,
  formatRate,
  formatShare,
  interventionLabel,
  modeSplitNote,
} from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";
import {
  EYEON_HOME_CARD_NAMES,
  EYEON_HOME_CARD_WIDTH,
  EYEON_HOME_TILE_NAMES,
  type ArrangeZone,
  type EyeonHomeCardId,
  type EyeonHomeLayout,
  type EyeonHomeTileId,
  cardSpans,
  hiddenWidgets,
  hideWidget,
  isDefaultEyeonHomeLayout,
  moveWidget,
  moveWidgetTo,
  showWidget,
  shownWidgets,
} from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";
import { useEyeonHomeLayout } from "@/src/features/acme-enhancements/utils/useEyeonHomeLayout";

// ACME (CHG-2026-132, ADR-0027): the EYEON overview, the first EYEON-native
// page, composed from the EYEON kit (components/eyeon). It follows the
// prototype's Home as far as the data truthfully allows; what EYEON does not
// record says so, and nothing is estimated. Metadata only.
//
// CHG-2026-136 (ADR-0028): the overview is also EYEON Home (`asHome`), and
// each person can arrange it for themselves: move tiles among the tiles and
// cards among the cards, hide and show them, and reset. The arrangement is
// kept in this browser only and only orders what the page already has: it
// fetches nothing and shows no role anything it could not see before.

type Summary = Extract<
  RouterOutputs["eyeonOverview"]["summary"],
  { enabled: true }
>;

function headerPropsFor(asHome: boolean) {
  return {
    title: asHome ? "Home" : "Overview",
    help: {
      description:
        "EYEON at a glance for this project: the guardrail checks and what " +
        "they stopped, the guardrail mode and its ceiling, the judge's " +
        "no-verdict rate, the applications that need action and, for roles " +
        "allowed to see it, spend against budget. Metadata only. Arrange " +
        "moves and hides the tiles and cards for you only, in this browser.",
    },
  };
}

export default function EyeonOverviewPage({
  asHome = false,
}: {
  /** Shown as the project's Home (CHG-2026-136): titled "Home". */
  asHome?: boolean;
}) {
  const projectId = useProjectIdFromURL();

  return (
    <Page headerProps={headerPropsFor(asHome)} scrollable withPadding>
      {projectId ? <EyeonOverview projectId={projectId} /> : null}
    </Page>
  );
}

function EyeonOverview({ projectId }: { projectId: string }) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const summary = api.eyeonOverview.summary.useQuery(
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
        Could not load the overview: {summary.error.message}
      </div>
    );
  }
  if (!summary.data.enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-sm">
          <p className="text-muted-foreground">
            The EYEON overview is switched off on this deployment.
          </p>
          <Link href={`/project/${projectId}`} className="underline">
            Go to the project home
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <OverviewContent
      data={summary.data}
      projectId={projectId}
      windowDays={windowDays}
      onWindowDaysChange={setWindowDays}
    />
  );
}

function headline(data: Summary): string {
  if (!data.applications)
    return "Applications are not rated: gateway management is switched off.";
  const n = data.applications.byOverall.red;
  if (n === 0) return "No application needs action.";
  return n === 1
    ? "1 application needs action."
    : `${n.toLocaleString()} applications need action.`;
}

type ArrangeGroup = "tiles" | "cards";

function OverviewContent({
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
  const decisionsHref = `${base}/security-logs?tab=guardrails`;
  const period = `last ${data.windowDays} days`;
  const d = data.decisions;
  const daily = (
    key: "checks" | "promptsRefused" | "answersWithheld" | "redactions",
  ) => data.daily.map((p) => ({ label: p.day, value: p[key] }));
  const total = (s: { enforced: number; notEnforced: number }) =>
    (s.enforced + s.notEnforced).toLocaleString();

  const tiles: Record<EyeonHomeTileId, ReactNode> = {
    checks: (
      <EyeonKpiTile
        label="Guardrail checks"
        figure={{ state: "measured", value: d.checks.toLocaleString() }}
        subtitle={`${d.promptChecks.toLocaleString()} prompts and ${d.answerChecks.toLocaleString()} answers, ${period}`}
        href={decisionsHref}
        trend={
          <EyeonSparkline
            label="Guardrail checks per UTC day"
            points={daily("checks")}
          />
        }
      />
    ),
    promptsRefused: (
      <EyeonKpiTile
        label={interventionLabel("promptsRefused", d.promptsRefused)}
        figure={{ state: "measured", value: total(d.promptsRefused) }}
        subtitle={modeSplitNote(d.promptsRefused)}
        href={decisionsHref}
        trend={
          <EyeonSparkline
            label="Prompts refused per UTC day"
            points={daily("promptsRefused")}
            tone="block"
          />
        }
      />
    ),
    answersWithheld: (
      <EyeonKpiTile
        label={interventionLabel("answersWithheld", d.answersWithheld)}
        figure={{ state: "measured", value: total(d.answersWithheld) }}
        subtitle={modeSplitNote(d.answersWithheld)}
        href={decisionsHref}
        trend={
          <EyeonSparkline
            label="Answers withheld per UTC day"
            points={daily("answersWithheld")}
            tone="block"
          />
        }
      />
    ),
    redactions: (
      <EyeonKpiTile
        label={interventionLabel("redactions", d.redactions)}
        figure={{ state: "measured", value: total(d.redactions) }}
        subtitle={modeSplitNote(d.redactions)}
        href={decisionsHref}
        trend={
          <EyeonSparkline
            label="Redactions per UTC day"
            points={daily("redactions")}
            tone="redact"
          />
        }
      />
    ),
    noVerdict: (
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
            : `${data.judge.noVerdict.toLocaleString()} of ${data.judge.checks.toLocaleString()} checks without a judge answer`
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
        href={`${base}/guardrails`}
      />
    ),
    applicationsNeedingAction: (
      <EyeonKpiTile
        label="Applications needing action"
        figure={
          data.applications
            ? {
                state: "measured",
                value: data.applications.byOverall.red.toLocaleString(),
              }
            : {
                state: "notRecorded",
                reason:
                  "Gateway management is switched off on this deployment, so no applications are rated.",
              }
        }
        subtitle={
          data.applications
            ? `Rated Act now, of ${data.applications.total.toLocaleString()} applications, ${period}`
            : "No applications without gateway management"
        }
        href={data.applications ? `${base}/applications` : undefined}
      />
    ),
  };

  // The spend card exists only for a viewer the server sent spend to; an
  // arrangement can hide it, never add it.
  const cards: Record<EyeonHomeCardId, ReactNode | undefined> = {
    decisions: (
      <DecisionsCard data={data} href={decisionsHref} period={period} />
    ),
    enforcement: (
      <EnforcementCard
        data={data}
        href={`${base}/guardrails`}
        period={period}
      />
    ),
    applications: (
      <ApplicationsCard data={data} href={`${base}/applications`} />
    ),
    spend: data.spend ? (
      <SpendCard
        spend={data.spend}
        href={`${base}/llm-gateway`}
        period={period}
      />
    ) : undefined,
    notRecorded: <NotRecordedCard />,
  };

  const userId = useSession().data?.user?.id;
  const arrangement = useEyeonHomeLayout(projectId, userId);
  const layout = arrangement.layout;
  const [arranging, setArranging] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // The arrange controls, by key, so focus can follow a moved, hidden or
  // shown widget instead of falling back to the page.
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
  /** Applies a change now, then moves focus to the first control named. */
  const commit = (change: () => void, focus: string[]) => {
    flushSync(change);
    focusFirst(focus);
  };

  const groupOf = (group: ArrangeGroup): ArrangeZone<string> => layout[group];
  const isAvailable = (group: ArrangeGroup) => (id: string) =>
    group === "tiles" || cards[id as EyeonHomeCardId] !== undefined;
  const nameOf = (group: ArrangeGroup, id: string) =>
    group === "tiles"
      ? EYEON_HOME_TILE_NAMES[id as EyeonHomeTileId]
      : EYEON_HOME_CARD_NAMES[id as EyeonHomeCardId];
  const withGroup = (
    group: ArrangeGroup,
    next: ArrangeZone<string>,
  ): EyeonHomeLayout =>
    group === "tiles"
      ? { ...layout, tiles: next as EyeonHomeLayout["tiles"] }
      : { ...layout, cards: next as EyeonHomeLayout["cards"] };
  const placeMessage = (
    group: ArrangeGroup,
    id: string,
    next: ArrangeZone<string>,
  ) => {
    const shown = shownWidgets(next, isAvailable(group));
    return `${nameOf(group, id)} moved to place ${shown.indexOf(id) + 1} of ${shown.length}.`;
  };

  const move = (
    group: ArrangeGroup,
    id: string,
    direction: "earlier" | "later",
  ) => {
    const next = moveWidget(groupOf(group), id, direction, isAvailable(group));
    commit(() => {
      arrangement.save(withGroup(group, next));
      setAnnouncement(placeMessage(group, id, next));
    }, [
      `${group}:${id}:${direction}`,
      `${group}:${id}:${direction === "earlier" ? "later" : "earlier"}`,
    ]);
  };
  const drop = (group: ArrangeGroup, id: string, target: string) => {
    const next = moveWidgetTo(groupOf(group), id, target);
    arrangement.save(withGroup(group, next));
    setAnnouncement(placeMessage(group, id, next));
  };
  const hide = (group: ArrangeGroup, id: string) =>
    commit(() => {
      arrangement.save(withGroup(group, hideWidget(groupOf(group), id)));
      setAnnouncement(
        `${nameOf(group, id)} hidden. Show it again from the hidden list.`,
      );
    }, [`show:${group}:${id}`, "done"]);
  const show = (group: ArrangeGroup, id: string) =>
    commit(() => {
      arrangement.save(withGroup(group, showWidget(groupOf(group), id)));
      setAnnouncement(`${nameOf(group, id)} shown again.`);
    }, [`${group}:${id}:hide`, "done"]);
  const resetToDefault = () =>
    commit(() => {
      arrangement.reset();
      setAnnouncement("Default arrangement restored.");
    }, ["reset", "done"]);
  const startArranging = () =>
    commit(() => {
      setArranging(true);
      setAnnouncement("");
    }, ["done"]);
  const stopArranging = () => commit(() => setArranging(false), ["arrange"]);

  const hidden = (["tiles", "cards"] as const).flatMap((group) =>
    hiddenWidgets(groupOf(group), isAvailable(group)).map((id) => ({
      key: `${group}:${id}`,
      name: nameOf(group, id),
      onShow: () => show(group, id),
    })),
  );
  const shownTiles = shownWidgets(layout.tiles);
  const shownCards = shownWidgets(layout.cards, isAvailable("cards"));
  const spans = cardSpans(shownCards, (id) => EYEON_HOME_CARD_WIDTH[id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-bold">{headline(data)}</p>
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
              title="This page reads no prompt or answer text."
            >
              Metadata only
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!arranging && hidden.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              {hidden.length === 1
                ? "1 hidden by you"
                : `${hidden.length} hidden by you`}
            </span>
          ) : null}
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
          {arranging ? null : (
            <Button
              type="button"
              variant="outline"
              ref={buttonRef("arrange")}
              title="Move or hide this page's tiles and cards, for you only"
              onClick={startArranging}
            >
              <LayoutGrid className="mr-1 h-4 w-4" aria-hidden="true" />
              Arrange
            </Button>
          )}
        </div>
      </div>

      {arranging ? (
        <EyeonArrangeBar
          hidden={hidden}
          onReset={resetToDefault}
          resetDisabled={isDefaultEyeonHomeLayout(layout)}
          onDone={stopArranging}
          buttonRef={buttonRef}
          storageRefused={arrangement.storageRefused}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {shownTiles.length > 0 ? (
        <EyeonArrangeZone
          ids={shownTiles}
          nameOf={(id) => nameOf("tiles", id)}
          onDrop={(id, target) => drop("tiles", id, target)}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {shownTiles.map((id, index) => (
              <EyeonArrangeFrame
                key={id}
                id={id}
                name={EYEON_HOME_TILE_NAMES[id]}
                place={index + 1}
                count={shownTiles.length}
                arranging={arranging}
                onMoveEarlier={() => move("tiles", id, "earlier")}
                onMoveLater={() => move("tiles", id, "later")}
                onHide={() => hide("tiles", id)}
                buttonRef={(action) => buttonRef(`tiles:${id}:${action}`)}
              >
                {tiles[id]}
              </EyeonArrangeFrame>
            ))}
          </div>
        </EyeonArrangeZone>
      ) : null}

      {shownCards.length > 0 ? (
        <EyeonArrangeZone
          ids={shownCards}
          nameOf={(id) => nameOf("cards", id)}
          onDrop={(id, target) => drop("cards", id, target)}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {shownCards.map((id, index) => (
              <EyeonArrangeFrame
                key={id}
                id={id}
                name={EYEON_HOME_CARD_NAMES[id]}
                place={index + 1}
                count={shownCards.length}
                arranging={arranging}
                span={spans.get(id)}
                onMoveEarlier={() => move("cards", id, "earlier")}
                onMoveLater={() => move("cards", id, "later")}
                onHide={() => hide("cards", id)}
                buttonRef={(action) => buttonRef(`cards:${id}:${action}`)}
              >
                {cards[id]}
              </EyeonArrangeFrame>
            ))}
          </div>
        </EyeonArrangeZone>
      ) : null}

      {shownTiles.length === 0 && shownCards.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          Everything on this page is hidden.{" "}
          {arranging
            ? "Show tiles and cards again from the hidden list, or reset to default."
            : "Use Arrange to show tiles and cards again."}
        </p>
      ) : null}
    </div>
  );
}

function DecisionsCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const d = data.decisions;
  const per100 = (n: number) =>
    d.checks > 0 ? (Math.round((1000 * n) / d.checks) / 10).toFixed(1) : "–";
  const rows = [
    { key: "allow", action: "allow", mode: null, count: d.allowed },
    {
      key: "block-applied",
      action: "block",
      mode: "enforce",
      count: d.promptsRefused.enforced + d.answersWithheld.enforced,
    },
    {
      key: "block-unapplied",
      action: "block",
      mode: null,
      count: d.promptsRefused.notEnforced + d.answersWithheld.notEnforced,
    },
    {
      key: "redact-applied",
      action: "redact",
      mode: "enforce",
      count: d.redactions.enforced,
    },
    {
      key: "redact-unapplied",
      action: "redact",
      mode: null,
      count: d.redactions.notEnforced,
    },
    {
      key: "unavailable",
      action: "unavailable",
      mode: null,
      count: d.noVerdict,
    },
  ] as const;
  return (
    <EyeonCard
      title="Guardrail decisions"
      subtitle={`Every guardrail check recorded for this project, ${period}, by decision and by the mode the gateway reported.`}
      link={{ href, label: "Open guardrail decisions" }}
      footnote="Blocked and Redacted only where the gateway enforced; otherwise Would block and Would redact."
    >
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">
          Checks per UTC day
        </span>
        <EyeonSparkline
          label="Guardrail checks per UTC day"
          points={data.daily.map((p) => ({ label: p.day, value: p.checks }))}
          size="lg"
        />
        <EyeonChartTable
          caption={`Guardrail decisions per UTC day, ${period}`}
          columns={[
            "Day",
            "Checks",
            "Prompts refused",
            "Answers withheld",
            "Redactions",
            "No verdict",
          ]}
          rows={data.daily.map((p) => ({
            key: p.day,
            cells: [
              p.day,
              p.checks,
              p.promptsRefused,
              p.answersWithheld,
              p.redactions,
              p.noVerdict,
            ],
          }))}
        />
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">
          Guardrail checks by decision, {period}
        </caption>
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th scope="col" className="py-1 text-left font-bold">
              Decision
            </th>
            <th scope="col" className="py-1 text-right font-bold">
              Checks
            </th>
            <th scope="col" className="py-1 text-right font-bold">
              Per 100 checks
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
                {r.count.toLocaleString()}
              </td>
              <td className="text-muted-foreground py-1.5 text-right tabular-nums">
                {per100(r.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </EyeonCard>
  );
}

const MODE_NOTE = {
  enforce:
    "Enforcing: a refused prompt stops the request, and a redaction sends redacted text to the model.",
  record:
    "Record mode: decisions are recorded, and every request still reaches the model unchanged.",
  none: "No guardrail settings are stored in EYEON yet: treat every decision as not applied.",
} as const;

function EnforcementCard({
  data,
  href,
  period,
}: {
  data: Summary;
  href: string;
  period: string;
}) {
  const { mode, ceiling, lastChange, trialEndsAt } = data.mode;
  const pct = data.decisions.enforcedPct;
  return (
    <EyeonCard
      title="Enforcement"
      subtitle="The guardrail mode now, its ceiling, and how much of the period was decided in enforce mode."
      link={{ href, label: "Open Guardrails" }}
      footnote="Gateway traffic only"
    >
      <EyeonModeChip mode={mode} ceiling={ceiling} />
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
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Last change</dt>
        <dd>
          {lastChange
            ? `To ${lastChange.to === "enforce" ? "Enforce" : "Record"}, ${new Date(lastChange.at).toLocaleString()}${lastChange.automatic ? " (automatic switch-back)" : ""}`
            : "No change of mode recorded"}
        </dd>
        {trialEndsAt ? (
          <>
            <dt className="text-muted-foreground">Switches back</dt>
            <dd>{new Date(trialEndsAt).toLocaleString()}</dd>
          </>
        ) : null}
      </dl>
      <p className="text-muted-foreground text-xs">
        {MODE_NOTE[mode ?? "none"]}
      </p>
    </EyeonCard>
  );
}

function ApplicationsCard({ data, href }: { data: Summary; href: string }) {
  const apps = data.applications;
  if (!apps) {
    return (
      <EyeonCard
        title="Applications"
        subtitle="Each application connected through the gateway, rated on six dimensions."
      >
        <p className="text-muted-foreground text-sm">
          Gateway management is switched off on this deployment, so there are no
          applications to rate.
        </p>
      </EyeonCard>
    );
  }
  const { risks, total } = apps.topRisks;
  return (
    <EyeonCard
      title="Applications"
      subtitle="Each application connected through the gateway, rated on six dimensions; the worst one sets its rating."
      link={{ href, label: "Open Applications" }}
      footnote={
        apps.missingBudget === 1
          ? "1 key has no budget."
          : `${apps.missingBudget.toLocaleString()} keys have no budget.`
      }
    >
      <div className="flex flex-wrap gap-2">
        <EyeonRatingChip rating="actnow" count={apps.byOverall.red} />
        <EyeonRatingChip rating="watch" count={apps.byOverall.amber} />
        <EyeonRatingChip rating="ontrack" count={apps.byOverall.green} />
        <EyeonRatingChip rating="notrated" count={apps.byOverall.none} />
      </div>
      <span className="text-muted-foreground text-xs font-bold">Top risks</span>
      {risks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No dimension is rated Watch or Act now in this period.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {risks.map((r) => (
            <li
              key={`${r.alias}-${r.dimension}`}
              className="grid grid-cols-[6.5rem_1fr] items-start gap-2 text-sm"
            >
              <span>
                <EyeonRatingChip rating={ratingFromBand(r.band)} />
              </span>
              <span className="min-w-0">
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
          {(total - risks.length).toLocaleString()} more on the Applications
          page.
        </p>
      ) : null}
    </EyeonCard>
  );
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function SpendCard({
  spend,
  href,
  period,
}: {
  spend: NonNullable<Summary["spend"]>;
  href: string;
  period: string;
}) {
  return (
    <EyeonCard
      title="Spend against budget"
      subtitle={`Gateway cost through application keys, ${period}, and each application's spend against its key's budget.`}
      link={{ href, label: "Open LLM Gateway" }}
      footnote="A key's budget period can differ from this page's period."
    >
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">
          {formatUsd(spend.totalUsd)}
        </span>
        <span className="text-muted-foreground text-xs">spent, {period}</span>
      </div>
      {spend.shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No application has a budget to measure against.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {spend.shown.map((b) => (
            <EyeonBullet
              key={b.alias}
              label={b.name}
              value={b.spentUsd}
              target={b.budgetUsd}
              valueText={formatUsd(b.spentUsd)}
              targetText={`${formatUsd(b.budgetUsd)} ${budgetPeriodLabel(b.budgetDuration)}`}
              tone={
                b.usedPct >= 100
                  ? "block"
                  : b.usedPct >= 80
                    ? "redact"
                    : "accent"
              }
            />
          ))}
          {spend.withBudget > spend.shown.length ? (
            <p className="text-muted-foreground text-xs">
              {(spend.withBudget - spend.shown.length).toLocaleString()} more
              with a budget on the Applications page.
            </p>
          ) : null}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {spend.withoutBudget === 1
          ? "1 application has no budget."
          : `${spend.withoutBudget.toLocaleString()} applications have no budget.`}
      </p>
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
    what: "A monthly budget for the project",
    reason:
      "Budgets are set per gateway key, each with its own period. There is no project budget to measure against.",
  },
  {
    what: "Personal-data types behind redactions",
    reason:
      "The findings are stored with each event only, and this page reads no content, so no aggregate exists.",
  },
  {
    what: "Traffic that bypasses the gateway",
    reason: "Only traffic through the EYEON gateway is checked and recorded.",
  },
  {
    what: "Model health over time",
    reason:
      "Model health is checked at a point in time on the LLM Gateway page; no history is kept.",
  },
] as const;

function NotRecordedCard() {
  return (
    <EyeonCard
      title="Not on this page"
      subtitle="What EYEON does not record, so this overview cannot show it."
      footnote="Totals here count every guardrail check recorded for this project; the Applications page counts application keys only, so its totals can be lower."
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
