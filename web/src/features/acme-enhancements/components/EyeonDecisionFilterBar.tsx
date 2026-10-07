import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Button } from "@/src/components/ui/button";
import {
  APPLIED_FILTERS,
  APPLIED_FILTER_LABEL,
  DIRECTION_FILTERS,
  DIRECTION_FILTER_LABEL,
  POLICY_TYPE_FILTERS,
  VERDICT_FILTERS,
  type DecisionFilters,
  type DecisionView,
  describeFilters,
  isFiltered,
  policyTypeFilterLabel,
  verdictFilterLabel,
  withoutFilters,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";

// ACME (CHG-2026-137, ADR-0027): the Guardrail decisions page's filter row,
// after the prototype's: the period first, then direction, decision,
// application (the caller), policy type and applied or recorded. One row
// above everything it scopes; every card follows it. The view lives in the
// URL (the page owns that), so a filtered view can be shared.

/** A caller the filter can choose, by key alias, with its application. */
export type CallerChoice = {
  alias: string;
  checks: number;
  application: { name: string } | null;
};

const ALL = "all";
/** A caller's option value: prefixed, so no agent id can read as "all". */
const CALLER = "caller:";

function callerText(c: CallerChoice): string {
  return c.application ? `${c.application.name} (${c.alias})` : c.alias;
}

export function EyeonDecisionFilterBar({
  view,
  callers,
  callersCapped,
  onChange,
}: {
  view: DecisionView;
  /** The callers in the period, most checks first, as the server listed them. */
  callers: CallerChoice[];
  /** True when the server listed only the busiest callers. */
  callersCapped: boolean;
  onChange: (view: DecisionView) => void;
}) {
  const f = view.filters;
  const setFilter = <K extends keyof DecisionFilters>(
    key: K,
    value: DecisionFilters[K] | undefined,
  ) => {
    const rest = withoutFilters(f, [key]);
    onChange({
      ...view,
      filters: value === undefined ? rest : { ...rest, [key]: value },
    });
  };
  // A caller from a shared link may not be among the busiest listed.
  const choices =
    f.caller && !callers.some((c) => c.alias === f.caller)
      ? [...callers, { alias: f.caller, checks: 0, application: null }]
      : callers;
  const chosen = choices.find((c) => c.alias === f.caller);
  const active = describeFilters(
    f,
    chosen?.application ? chosen.application.name : undefined,
  );

  return (
    <section className="flex flex-col gap-2" aria-label="Filters">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(view.windowDays)}
          onValueChange={(v) =>
            onChange({ ...view, windowDays: v === "30" ? 30 : 7 })
          }
        >
          <SelectTrigger className="w-36" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={f.direction ?? ALL}
          onValueChange={(v) =>
            setFilter(
              "direction",
              DIRECTION_FILTERS.find((d) => d === v),
            )
          }
        >
          <SelectTrigger className="w-52" aria-label="Direction">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Prompts and answers</SelectItem>
            {DIRECTION_FILTERS.map((d) => (
              <SelectItem key={d} value={d}>
                {DIRECTION_FILTER_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={f.verdict ?? ALL}
          onValueChange={(v) =>
            setFilter(
              "verdict",
              VERDICT_FILTERS.find((d) => d === v),
            )
          }
        >
          <SelectTrigger className="w-52" aria-label="Decision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All decisions</SelectItem>
            {VERDICT_FILTERS.map((d) => (
              <SelectItem key={d} value={d}>
                {verdictFilterLabel(d, f.applied)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={f.caller ? `${CALLER}${f.caller}` : ALL}
          onValueChange={(v) =>
            setFilter(
              "caller",
              v.startsWith(CALLER) ? v.slice(CALLER.length) : undefined,
            )
          }
        >
          <SelectTrigger className="w-60" aria-label="Application">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All applications</SelectItem>
            {choices.map((c) => (
              <SelectItem key={c.alias} value={`${CALLER}${c.alias}`}>
                {callerText(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={f.policyType ?? ALL}
          onValueChange={(v) =>
            setFilter(
              "policyType",
              POLICY_TYPE_FILTERS.find((t) => t === v),
            )
          }
        >
          <SelectTrigger className="w-56" aria-label="Policy type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All policy types</SelectItem>
            {POLICY_TYPE_FILTERS.map((t) => (
              <SelectItem key={t} value={t}>
                {policyTypeFilterLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={f.applied ?? ALL}
          onValueChange={(v) =>
            setFilter(
              "applied",
              APPLIED_FILTERS.find((a) => a === v),
            )
          }
        >
          <SelectTrigger className="w-64" aria-label="Applied or recorded">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Applied and recorded</SelectItem>
            {APPLIED_FILTERS.map((a) => (
              <SelectItem key={a} value={a}>
                {APPLIED_FILTER_LABEL[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFiltered(f) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...view, filters: {} })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {active.length > 0 ? (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          Filtered: {active.join(" · ")}. Every card follows the filters except
          the judge&apos;s 24-hour alert figure; rates per 100 checks keep every
          check{f.caller ? " of this caller" : ""} as their base.
          {f.policyType
            ? " Allowed checks and checks without a verdict carry no policy label, so they drop out while a policy type is chosen."
            : ""}
        </p>
      ) : null}
      {callersCapped ? (
        <p className="text-muted-foreground text-xs">
          The application list holds the {callers.length.toLocaleString()}{" "}
          callers with the most checks in this period.
        </p>
      ) : null}
    </section>
  );
}
