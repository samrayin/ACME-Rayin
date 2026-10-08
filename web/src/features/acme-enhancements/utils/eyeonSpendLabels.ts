/**
 * ACME (CHG-2026-143, ADR-0027): the EYEON Cost and usage page's wording.
 *
 * Spend is what the gateway recorded for each call in its request log, in US
 * dollars, at the gateway's own model prices: it is not a provider's invoice.
 * Budgets are set per gateway key, so EYEON holds no project-level budget,
 * and the gateway keeps each key's budget reset time to itself, so this page
 * never speaks of "spend since the last reset". Pure functions and tables,
 * safe in the browser and on the server, tested without either.
 */
import {
  type GatewayHealthWindow,
  WINDOW_WORDS,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";

/** The periods the page offers: the same as Gateway health's. */
export {
  GATEWAY_HEALTH_WINDOWS as SPEND_WINDOWS,
  WINDOW_WORDS,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";
export type SpendWindow = GatewayHealthWindow;

/** The breakdowns of "Where the money goes", in the prototype's order. */
export const BREAKDOWNS = ["model", "application", "team", "key"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

export const BREAKDOWN_WORDS: Record<
  Breakdown,
  { tab: string; caption: string }
> = {
  model: {
    tab: "Model",
    caption: "Spend by model, as the caller asked for it",
  },
  application: {
    tab: "Application",
    caption: "Spend by application: every generation of its gateway key",
  },
  team: { tab: "Team", caption: "Spend by gateway team, from each key's team" },
  key: { tab: "Key", caption: "Spend by gateway key generation" },
};

/** Why a figure is "Not recorded" on this page. */
export const NOT_RECORDED = {
  projectBudget:
    "Budgets are set per gateway key, not per project, so EYEON holds no project budget to measure this month against.",
  resetTime:
    "The gateway keeps each key's budget reset time to itself; EYEON does not record it, so spend since the last reset is not shown.",
  cacheHits: "The gateway reported no cache field for any call in this period.",
  costPer1k: "No tokens were recorded in this period.",
} as const;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Dollars, to the cent. A spend above zero but under a cent keeps four
 * decimals, so it never reads as nothing.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return USD.format(value);
}

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A count, shortened from ten thousand up: 12.4K, 3.1M. */
export function formatCount(value: number): string {
  return value < 10_000 ? value.toLocaleString("en-US") : COMPACT.format(value);
}

/** A share in percent, one decimal; "<0.1%" for a sliver above zero. */
export function formatPct(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

/** "October 2026", from "2026-10". */
export function monthName(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "October", from "2026-10". */
function monthOnly(month: string): string {
  return monthName(month).split(" ")[0] ?? month;
}

/**
 * The change from the previous period of the same length, in words. Up is
 * neither good nor bad for spend: the tone is neutral, as in the prototype.
 */
export function changeText(
  current: number,
  previous: number,
  window: SpendWindow,
): string {
  const against = `the previous ${WINDOW_WORDS[window].period}`;
  if (previous <= 0)
    return current > 0 ? `None in ${against}` : `No change on ${against}`;
  const change = (100 * (current - previous)) / previous;
  if (Math.abs(change) < 0.05) return `No change on ${against}`;
  return `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}% on ${against}`;
}

/** The month's headline: the run-rate when there is one, else the spend. */
export function monthHeadline(m: {
  month: string;
  spentUsd: number;
  projectedUsd: number | null;
}): string {
  const name = monthOnly(m.month);
  return m.projectedUsd === null
    ? `${formatUsd(m.spentUsd)} spent so far in ${name}.`
    : `On pace to spend ${formatUsd(m.projectedUsd)} in ${name}.`;
}

/**
 * The month's sentence: what was spent by when, the daily average, and where
 * that average takes the month. Early on the first day there is no average
 * worth drawing a line from, and the sentence says so.
 */
export function monthSentence(m: {
  spentUsd: number;
  dayOfMonth: number;
  daysInMonth: number;
  dailyAverageUsd: number | null;
  projectedUsd: number | null;
}): string {
  const spent = `${formatUsd(m.spentUsd)} spent by day ${m.dayOfMonth} of ${m.daysInMonth} (UTC).`;
  if (m.dailyAverageUsd === null || m.projectedUsd === null)
    return `${spent} Less than a day has passed, so no run-rate is drawn yet.`;
  return `${spent} At the month-to-date daily average of ${formatUsd(m.dailyAverageUsd)}, the month closes at about ${formatUsd(m.projectedUsd)}. A straight line, not a forecast.`;
}

/** A budget period as the gateway holds it ("30d"), in words. */
export function budgetPeriodText(duration: string | null): string {
  if (!duration) return "No reset: a lifetime budget";
  const match = /^(\d{1,4})(s|m|h|d|mo)$/.exec(duration);
  if (!match) return duration;
  const n = Number(match[1]);
  const unit = {
    s: "second",
    m: "minute",
    h: "hour",
    d: "day",
    mo: "month",
  }[match[2] as "s" | "m" | "h" | "d" | "mo"];
  return `Resets every ${n === 1 ? unit : `${n} ${unit}s`}`;
}
