/**
 * ACME (CHG-2026-143, ADR-0027): the EYEON Cost and usage page's figures.
 *
 * Pure functions only, so they are tested without a database; the router
 * (eyeonSpendRouter.ts) does the reads. Every input here is metadata:
 *  - from the gateway request-log mirror: per call, its time, status, model,
 *    key alias, tokens, cache flag and spend, summed by day, time bucket,
 *    model and key alias;
 *  - the project's gateway keys: lineage, generation, name, alias, status,
 *    team, budget and budget period;
 *  - the project's gateway teams: id and alias.
 * No prompt or answer text, error text, token hash, key secret, end user or
 * source address is an input here.
 *
 * Spend is read from the request-log mirror, as on the overview and the
 * Applications page, so the three agree. The classic Spend tab on the LLM
 * Gateway page asks the gateway for its own daily totals instead, so the two
 * can differ by the mirror's lag of up to about 7 minutes.
 */
import {
  type Band,
  SCORECARD_THRESHOLDS,
  bandAbove,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { currentGeneration } from "@/src/features/acme-enhancements/server/acmeApplicationDetail";
import { applicationsByAlias } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import { budgetUse } from "@/src/features/acme-enhancements/server/eyeonOverview";
import { type windowRange } from "@/src/features/acme-enhancements/server/eyeonGatewayHealth";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** How many models the model query returns; the rest are summed. */
export const SPEND_MODELS_SHOWN = 10;

/** How many rows each other breakdown lists; the rest are summed. */
export const BREAKDOWN_ROWS_SHOWN = 15;

/** How many applications the key budgets card lists. */
export const BUDGETS_SHOWN = 20;

type WindowRange = ReturnType<typeof windowRange>;

// ---------------------------------------------------------------------------
// The month to date (calendar month, UTC): hero and runway
// ---------------------------------------------------------------------------

/** The calendar month (UTC) that holds `now`. */
export function monthWindow(now: Date): {
  start: Date;
  end: Date;
  daysInMonth: number;
  dayOfMonth: number;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    start,
    end,
    daysInMonth: Math.round((end.getTime() - start.getTime()) / DAY_MS),
    dayOfMonth: now.getUTCDate(),
  };
}

/** One UTC day of the month so far, as the month query returns it. */
export type MonthDayRow = { day: string; spend: number; calls: number };

type MonthDay = {
  /** "2026-10-08" */
  day: string;
  spendUsd: number;
  calls: number;
  /** The month's spend up to and including this day. */
  cumulativeUsd: number;
};

type MonthToDate = {
  /** "2026-10" */
  month: string;
  daysInMonth: number;
  dayOfMonth: number;
  spentUsd: number;
  calls: number;
  /** Null in the month's first 24 hours: too little to average. */
  dailyAverageUsd: number | null;
  /** The daily average carried to the month's end; null with no average. */
  projectedUsd: number | null;
  days: MonthDay[];
};

/**
 * The month so far, one point per UTC day up to today, zero where nothing
 * was logged, and the straight-line run-rate the prototype draws: the
 * month-to-date spend over the time elapsed, carried to the month's end. A
 * day stamped past today (a call a little ahead of the console's clock)
 * counts in today; nothing before the month is read.
 */
export function monthToDate(rows: MonthDayRow[], now: Date): MonthToDate {
  const m = monthWindow(now);
  const days: MonthDay[] = Array.from({ length: m.dayOfMonth }, (_, i) => ({
    day: new Date(m.start.getTime() + i * DAY_MS).toISOString().slice(0, 10),
    spendUsd: 0,
    calls: 0,
    cumulativeUsd: 0,
  }));
  const index = new Map(days.map((d, i) => [d.day, i]));
  const today = days.length - 1;
  for (const r of rows) {
    const i =
      index.get(r.day) ?? (r.day > (days[today]?.day ?? "") ? today : -1);
    const day = days[i];
    if (!day) continue;
    day.spendUsd += r.spend;
    day.calls += r.calls;
  }
  let running = 0;
  for (const d of days) {
    running += d.spendUsd;
    d.cumulativeUsd = running;
  }
  const elapsedDays = (now.getTime() - m.start.getTime()) / DAY_MS;
  const dailyAverageUsd = elapsedDays >= 1 ? running / elapsedDays : null;
  return {
    month: m.start.toISOString().slice(0, 7),
    daysInMonth: m.daysInMonth,
    dayOfMonth: m.dayOfMonth,
    spentUsd: running,
    calls: days.reduce((n, d) => n + d.calls, 0),
    dailyAverageUsd,
    projectedUsd:
      dailyAverageUsd === null ? null : dailyAverageUsd * m.daysInMonth,
    days,
  };
}

// ---------------------------------------------------------------------------
// The chosen period: series, totals and the change
// ---------------------------------------------------------------------------

/** One time bucket of the period, as the bucket query returns it. */
export type SpendBucketRow = {
  bucket: number;
  calls: number;
  failed: number;
  spend: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Calls the gateway reported as served from its cache. */
  cacheHits: number;
  /** Calls the gateway reported a cache field for at all. */
  cacheReported: number;
  /** The newest arrival in the bucket, as UTC ISO text. */
  newestReceivedAt: string | null;
};

type SpendPoint = {
  /** The bucket's start, UTC ISO. */
  start: string;
  /** "2026-10-07" for a day, "2026-10-07 13:00" otherwise. */
  label: string;
  spendUsd: number;
  calls: number;
  totalTokens: number;
};

/**
 * Every bucket of the period, zero where nothing was logged. A bucket index
 * past the last counts in the last; one before the first is dropped (as on
 * Gateway health).
 */
export function spendSeries(
  range: WindowRange,
  rows: SpendBucketRow[],
): SpendPoint[] {
  const points: SpendPoint[] = Array.from({ length: range.buckets }, (_, i) => {
    const iso = new Date(
      range.from.getTime() + i * range.bucketMs,
    ).toISOString();
    return {
      start: iso,
      label:
        range.bucketMs >= 24 * HOUR_MS
          ? iso.slice(0, 10)
          : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`,
      spendUsd: 0,
      calls: 0,
      totalTokens: 0,
    };
  });
  for (const r of rows) {
    if (!Number.isFinite(r.bucket) || r.bucket < 0) continue;
    const point = points[Math.min(r.bucket, range.buckets - 1)];
    if (!point) continue;
    point.spendUsd += r.spend;
    point.calls += r.calls;
    point.totalTokens += r.totalTokens;
  }
  return points;
}

type SpendTotals = {
  spendUsd: number;
  calls: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHits: number;
  cacheReported: number;
};

/** The period's totals over every bucket. */
export function spendTotals(rows: SpendBucketRow[]): SpendTotals {
  const t: SpendTotals = {
    spendUsd: 0,
    calls: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHits: 0,
    cacheReported: 0,
  };
  for (const r of rows) {
    if (!Number.isFinite(r.bucket) || r.bucket < 0) continue;
    t.spendUsd += r.spend;
    t.calls += r.calls;
    t.failed += r.failed;
    t.promptTokens += r.promptTokens;
    t.completionTokens += r.completionTokens;
    t.totalTokens += r.totalTokens;
    t.cacheHits += r.cacheHits;
    t.cacheReported += r.cacheReported;
  }
  return t;
}

/** The previous period's rows grouped by status, as Prisma returns them. */
type StatusGroupRow = {
  status: string;
  _count: { _all: number };
  _sum: { spend: number | null };
};

/** Calls, failed calls and spend of the previous period. */
export function previousTotals(rows: StatusGroupRow[]): {
  spendUsd: number;
  calls: number;
  failed: number;
} {
  let spendUsd = 0;
  let calls = 0;
  let failed = 0;
  for (const r of rows) {
    spendUsd += r._sum.spend ?? 0;
    calls += r._count._all;
    // As the Applications page: anything but "success" did not succeed.
    if (r.status !== "success") failed += r._count._all;
  }
  return { spendUsd, calls, failed };
}

/**
 * The ratios the ribbon shows. Each is null where it does not exist (no
 * calls, no tokens, no cache field reported), never a zero in its place.
 * The failed share is rated as the Applications reliability check (from 2%
 * Watch, over 5% Act now) from 10 calls.
 */
export function spendRatios(t: SpendTotals): {
  costPer1kTokensUsd: number | null;
  failedPct: number | null;
  failedBand: Band;
  cacheHitPct: number | null;
} {
  const th = SCORECARD_THRESHOLDS;
  const failedPct = t.calls > 0 ? (100 * t.failed) / t.calls : null;
  return {
    costPer1kTokensUsd:
      t.totalTokens > 0 ? (1_000 * t.spendUsd) / t.totalTokens : null,
    failedPct,
    failedBand:
      failedPct !== null && t.calls >= th.minCallsForRates
        ? bandAbove(failedPct, th.errorPct)
        : "none",
    cacheHitPct:
      t.cacheReported > 0 ? (100 * t.cacheHits) / t.cacheReported : null,
  };
}

// ---------------------------------------------------------------------------
// Where the money goes
// ---------------------------------------------------------------------------

/** One model's calls in the period, as the model query returns it. */
export type SpendModelRow = {
  model: string | null;
  calls: number;
  failed: number;
  spend: number;
  totalTokens: number;
  /** How many models had calls in the period (the same on every row). */
  models: number;
};

type BreakdownRow = {
  /** A stable key for the row. */
  id: string;
  name: string;
  /** Set where the row is an application, for its link. */
  lineageId?: string;
  /** A line under the name, e.g. a key's status. */
  note?: string;
  spendUsd: number;
  calls: number;
  totalTokens: number;
  /** Of the period's spend; null when the period spent nothing. */
  sharePct: number | null;
};

type Breakdown = {
  rows: BreakdownRow[];
  /** What the rows past the list add up to. */
  rest: { count: number; spendUsd: number; calls: number };
};

function share(part: number, whole: number): number | null {
  return whole > 0 ? (100 * part) / whole : null;
}

/**
 * Rows by spend, then calls, then name; the first `limit` listed and the
 * rest summed, so the list always adds up to the period's spend.
 */
function ranked(
  rows: Omit<BreakdownRow, "sharePct">[],
  totalSpend: number,
  limit: number,
): Breakdown {
  const sorted = [...rows].sort(
    (a, b) =>
      b.spendUsd - a.spendUsd ||
      b.calls - a.calls ||
      a.name.localeCompare(b.name),
  );
  const listed = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  return {
    rows: listed.map((r) => ({
      ...r,
      sharePct: share(r.spendUsd, totalSpend),
    })),
    rest: {
      count: rest.length,
      spendUsd: rest.reduce((s, r) => s + r.spendUsd, 0),
      calls: rest.reduce((s, r) => s + r.calls, 0),
    },
  };
}

/**
 * Spend by model. The query already returns the top models only, with the
 * number of models beside each row; the rest is what the period spent
 * beyond them.
 */
export function spendByModel(
  rows: SpendModelRow[],
  totals: { spendUsd: number; calls: number },
): Breakdown {
  const listed = rows.slice(0, SPEND_MODELS_SHOWN).map((r) => ({
    id: `model:${r.model ?? ""}`,
    name: r.model ?? "Model not reported",
    spendUsd: r.spend,
    calls: r.calls,
    totalTokens: r.totalTokens,
    sharePct: share(r.spend, totals.spendUsd),
  }));
  const listedSpend = listed.reduce((s, r) => s + r.spendUsd, 0);
  const listedCalls = listed.reduce((s, r) => s + r.calls, 0);
  return {
    rows: listed,
    rest: {
      count: Math.max(0, (rows[0]?.models ?? 0) - listed.length),
      // Never below zero: float sums can disagree in the last digit.
      spendUsd: Math.max(0, totals.spendUsd - listedSpend),
      calls: Math.max(0, totals.calls - listedCalls),
    },
  };
}

/** The period's calls grouped by key alias, as Prisma returns them. */
type AliasGroupRow = {
  keyAlias: string | null;
  _count: { _all: number };
  _sum: { spend: number | null; totalTokens: number | null };
};

/** A gateway key as the page reads it: no token hash, no secret. */
type SpendKeyRow = Parameters<typeof applicationsByAlias>[0][number] & {
  litellmTeamId: string | null;
  maxBudget: number | null;
  budgetDuration: string | null;
};

type TeamRow = { id: string; teamAlias: string };

type AliasTotals = { spendUsd: number; calls: number; totalTokens: number };

function aliasTotals(rows: AliasGroupRow[]): Map<string, AliasTotals> {
  const byAlias = new Map<string, AliasTotals>();
  for (const r of rows) {
    const alias = r.keyAlias ?? "";
    const t = byAlias.get(alias) ?? { spendUsd: 0, calls: 0, totalTokens: 0 };
    t.spendUsd += r._sum.spend ?? 0;
    t.calls += r._count._all;
    t.totalTokens += r._sum.totalTokens ?? 0;
    byAlias.set(alias, t);
  }
  return byAlias;
}

function addTo(
  groups: Map<string, Omit<BreakdownRow, "sharePct">>,
  id: string,
  base: { name: string; lineageId?: string; note?: string },
  t: AliasTotals,
) {
  const g = groups.get(id) ?? {
    id,
    ...base,
    spendUsd: 0,
    calls: 0,
    totalTokens: 0,
  };
  g.spendUsd += t.spendUsd;
  g.calls += t.calls;
  g.totalTokens += t.totalTokens;
  groups.set(id, g);
}

const KEY_STATUS_NOTE: Record<string, string> = {
  ACTIVE: "Active",
  ROTATED: "Rotated",
  ROTATION_PARTIAL: "Rotation incomplete",
  REVOKED: "Revoked",
};

/**
 * Spend by application, team and key generation, from the period's calls
 * grouped by key alias. An application is a key lineage with an active key,
 * as on the Applications page; spend from a lineage with none left is
 * listed as "Keys no longer in use", so nothing is dropped. A key's team is
 * the gateway team it was issued in. The key alias is used to match and is
 * not returned: rows carry the key's display name.
 */
export function spendBreakdowns(
  keys: SpendKeyRow[],
  teams: TeamRow[],
  rows: AliasGroupRow[],
  totalSpend: number,
): { application: Breakdown; team: Breakdown; key: Breakdown } {
  const keyByAlias = new Map(keys.map((k) => [k.litellmKeyAlias, k]));
  const appByAlias = applicationsByAlias(keys);
  const teamAlias = new Map(teams.map((t) => [t.id, t.teamAlias]));
  const apps = new Map<string, Omit<BreakdownRow, "sharePct">>();
  const teamGroups = new Map<string, Omit<BreakdownRow, "sharePct">>();
  const keyGroups = new Map<string, Omit<BreakdownRow, "sharePct">>();

  for (const [alias, t] of aliasTotals(rows)) {
    const key = keyByAlias.get(alias);
    const app = appByAlias.get(alias);
    if (app) {
      addTo(
        apps,
        `app:${app.lineageId}`,
        { name: app.name, lineageId: app.lineageId },
        t,
      );
    } else {
      addTo(apps, "app:retired", { name: "Keys no longer in use" }, t);
    }
    if (key?.litellmTeamId) {
      addTo(
        teamGroups,
        `team:${key.litellmTeamId}`,
        { name: teamAlias.get(key.litellmTeamId) ?? "Deleted team" },
        t,
      );
    } else {
      addTo(teamGroups, "team:none", { name: "No team" }, t);
    }
    if (key) {
      addTo(
        keyGroups,
        `key:${key.lineageId}:${key.generation}`,
        {
          name:
            key.generation > 1
              ? `${key.displayName} (generation ${key.generation})`
              : key.displayName,
          note: KEY_STATUS_NOTE[key.status] ?? key.status,
        },
        t,
      );
    } else {
      // A call this project was charged for whose key is not among its used
      // keys (or that the gateway logged without an alias): counted, never
      // named after its alias.
      addTo(keyGroups, "key:unknown", { name: "Key not in use" }, t);
    }
  }
  return {
    application: ranked([...apps.values()], totalSpend, BREAKDOWN_ROWS_SHOWN),
    team: ranked([...teamGroups.values()], totalSpend, BREAKDOWN_ROWS_SHOWN),
    key: ranked([...keyGroups.values()], totalSpend, BREAKDOWN_ROWS_SHOWN),
  };
}

// ---------------------------------------------------------------------------
// Key budgets
// ---------------------------------------------------------------------------

type KeyBudget = {
  lineageId: string;
  name: string;
  spentUsd: number;
  budgetUsd: number;
  /** The key's own budget period, as the gateway holds it (e.g. "30d"). */
  budgetDuration: string | null;
  usedPct: number;
  /** As the Applications spend check: from 80% Watch, over 100% Act now. */
  band: Band;
};

/**
 * Each application's spend in the period against its current key's budget,
 * the most used first, through the overview's own function, so Home and
 * this page agree. The gateway's reset time is not recorded, so this is
 * spend in the chosen period, never "since the last reset".
 */
export function keyBudgets(
  keys: SpendKeyRow[],
  rows: AliasGroupRow[],
): {
  shown: KeyBudget[];
  withBudget: number;
  withoutBudget: number;
} {
  const spendByAlias = aliasTotals(rows);
  const lineages = new Map<string, SpendKeyRow[]>();
  for (const k of keys) {
    const list = lineages.get(k.lineageId) ?? [];
    list.push(k);
    lineages.set(k.lineageId, list);
  }
  const lineageByAlias = new Map<string, string>();
  const apps: Parameters<typeof budgetUse>[0] = [];
  for (const generations of lineages.values()) {
    // As the Applications page: the newest active generation carries the
    // application's name and budget; its spend is every generation's.
    const current = currentGeneration(generations);
    if (!current) continue;
    lineageByAlias.set(current.litellmKeyAlias, current.lineageId);
    apps.push({
      name: current.displayName,
      alias: current.litellmKeyAlias,
      budgetDuration: current.budgetDuration,
      maxBudget: current.maxBudget,
      spendUsd: generations.reduce(
        (s, g) => s + (spendByAlias.get(g.litellmKeyAlias)?.spendUsd ?? 0),
        0,
      ),
    });
  }
  const use = budgetUse(apps, BUDGETS_SHOWN);
  return {
    shown: use.shown.map((b) => ({
      lineageId: lineageByAlias.get(b.alias) ?? "",
      name: b.name,
      spentUsd: b.spentUsd,
      budgetUsd: b.budgetUsd,
      budgetDuration: b.budgetDuration,
      usedPct: b.usedPct,
      band: bandAbove(b.usedPct, SCORECARD_THRESHOLDS.spendPct),
    })),
    withBudget: use.withBudget,
    withoutBudget: use.withoutBudget,
  };
}
