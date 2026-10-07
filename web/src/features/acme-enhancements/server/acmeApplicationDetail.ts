/**
 * ACME (CHG-2026-125, ADR-0023 §3.5): the application detail screen, and the
 * aggregation the Applications scorecard shares with it.
 *
 * Pure functions only, so they are tested without a database. The first part
 * turns the grouped guardrail decisions and gateway calls into one scorecard
 * per application; the scorecards query (phase 1) and the detail query both
 * use it, so a card and its detail screen always agree. The second part
 * shapes the detail screen's evidence: the key's generations, its recent
 * requests with their guardrail decisions beside them, its daily activity
 * and its change record.
 *
 * Metadata only. Nothing here sees prompt or answer text, redacted text,
 * personal-data findings or encrypted content, and a key's token hash is
 * never part of any output: the change record's before and after are read
 * through an allow-list of settings.
 */
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  AcmeLitellmEventOutcome,
  AcmeLitellmEventPhase,
  AcmeLitellmKeyStatus,
} from "@langfuse/shared/src/db";
import {
  type GatewayMode,
  type GuardrailAction,
  gatewayModeFromDb,
} from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import {
  type GuardrailCounts,
  type ScorecardInput,
  dailyTrend,
  scoreApplication,
  threatTypeBreakdown,
  utcDay,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";

// ---------------------------------------------------------------------------
// Shared with the scorecards query
// ---------------------------------------------------------------------------

export function emptyGuardrailCounts(): GuardrailCounts {
  return {
    promptChecks: 0,
    answerChecks: 0,
    promptBlocks: 0,
    answerBlocks: 0,
    redactions: 0,
    noVerdict: 0,
    enforcedChecks: 0,
  };
}

/** One row of the guardrail decisions grouped by alias and verdict. */
export type GuardrailGroup = {
  agentId: string;
  direction: AcmeGuardrailEventDirection;
  action: AcmeGuardrailEventAction;
  policyTriggered: string | null;
  gatewayMode: string | null;
  _count: { _all: number };
};

export type Refusal = { policyTriggered: string | null; count: number };

/** Guardrail counts, and refusals by policy label, per key alias. */
export function guardrailCountsByAlias(groups: GuardrailGroup[]): {
  counts: Map<string, GuardrailCounts>;
  refusals: Map<string, Refusal[]>;
} {
  const counts = new Map<string, GuardrailCounts>();
  const refusals = new Map<string, Refusal[]>();
  for (const e of groups) {
    const c = counts.get(e.agentId) ?? emptyGuardrailCounts();
    const n = e._count._all;
    const isPrompt = e.direction === AcmeGuardrailEventDirection.INPUT;
    if (isPrompt) c.promptChecks += n;
    else c.answerChecks += n;
    if (e.action === AcmeGuardrailEventAction.BLOCK) {
      if (isPrompt) c.promptBlocks += n;
      else c.answerBlocks += n;
      const list = refusals.get(e.agentId) ?? [];
      list.push({ policyTriggered: e.policyTriggered, count: n });
      refusals.set(e.agentId, list);
    }
    if (e.action === AcmeGuardrailEventAction.REDACT) c.redactions += n;
    if (e.action === AcmeGuardrailEventAction.UNAVAILABLE) c.noVerdict += n;
    if (gatewayModeFromDb(e.gatewayMode) === "enforce") c.enforcedChecks += n;
    counts.set(e.agentId, c);
  }
  return { counts, refusals };
}

/** One row of the gateway calls grouped by alias and status. */
export type CallGroup = {
  keyAlias: string | null;
  status: string;
  _count: { _all: number };
  _sum: { spend: number | null };
};

export type CallCounts = { calls: number; failed: number; spend: number };

/** Calls, failed calls and spend per key alias. */
export function callCountsByAlias(
  groups: CallGroup[],
): Map<string, CallCounts> {
  const byAlias = new Map<string, CallCounts>();
  for (const r of groups) {
    if (!r.keyAlias) continue;
    const c = byAlias.get(r.keyAlias) ?? { calls: 0, failed: 0, spend: 0 };
    c.calls += r._count._all;
    if (r.status !== "success") c.failed += r._count._all;
    c.spend += r._sum.spend ?? 0;
    byAlias.set(r.keyAlias, c);
  }
  return byAlias;
}

export type AliasDayCount = { alias: string; day: string; n: number };

/** The trend's daily calls and refused prompts, per key alias. */
export function trendRowsByAlias(
  dailyCalls: AliasDayCount[],
  dailyRefused: AliasDayCount[],
): Map<string, { day: string; calls: number; refused: number }[]> {
  const byAlias = new Map<
    string,
    { day: string; calls: number; refused: number }[]
  >();
  for (const r of [
    ...dailyCalls.map((d) => ({ ...d, calls: d.n, refused: 0 })),
    ...dailyRefused.map((d) => ({ ...d, calls: 0, refused: d.n })),
  ]) {
    const list = byAlias.get(r.alias) ?? [];
    list.push({ day: r.day, calls: r.calls, refused: r.refused });
    byAlias.set(r.alias, list);
  }
  return byAlias;
}

/** The current generation's settings a scorecard reads. */
export type ScorecardKey = {
  lineageId: string;
  generation: number;
  displayName: string;
  litellmKeyAlias: string;
  models: string[];
  rpmLimit: number | null;
  maxBudget: number | null;
  budgetDuration: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

/**
 * One application's scorecard: its settings are the current generation's,
 * its traffic every generation's (`aliases`), so a rotation does not reset
 * it. Spend is passed on only when the viewer may see it.
 */
export function buildApplicationScorecard(args: {
  current: ScorecardKey;
  aliases: string[];
  guard: ReturnType<typeof guardrailCountsByAlias>;
  calls: Map<string, CallCounts>;
  trendRows: ReturnType<typeof trendRowsByAlias>;
  mode: "enforce" | "record";
  now: Date;
  canSeeSpend: boolean;
  trendFrom: Date;
  windowDays: number;
}) {
  const { current, aliases } = args;
  const guard = emptyGuardrailCounts();
  let callCount = 0;
  let failed = 0;
  let spend = 0;
  for (const alias of aliases) {
    const g = args.guard.counts.get(alias);
    if (g) {
      for (const k of Object.keys(guard) as (keyof GuardrailCounts)[])
        guard[k] += g[k];
    }
    const c = args.calls.get(alias);
    if (c) {
      callCount += c.calls;
      failed += c.failed;
      spend += c.spend;
    }
  }
  const scoreInput: ScorecardInput = {
    key: {
      models: current.models,
      rpmLimit: current.rpmLimit,
      maxBudget: current.maxBudget,
      expiresAt: current.expiresAt,
      issuedAt: current.createdAt,
    },
    calls: callCount,
    failedCalls: failed,
    spendUsd: args.canSeeSpend ? spend : null,
    guard,
    mode: args.mode,
    now: args.now,
  };
  return {
    input: scoreInput,
    score: scoreApplication(scoreInput),
    app: {
      lineageId: current.lineageId,
      name: current.displayName,
      alias: current.litellmKeyAlias,
      generation: current.generation,
      models: current.models,
      budgetDuration: current.budgetDuration,
      threatTypes: threatTypeBreakdown(
        aliases.flatMap((alias) => args.guard.refusals.get(alias) ?? []),
      ),
      trend: dailyTrend(
        args.trendFrom,
        args.windowDays,
        aliases.flatMap((alias) => args.trendRows.get(alias) ?? []),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// The detail screen
// ---------------------------------------------------------------------------

/** How many recent gateway requests the detail screen lists. */
export const DETAIL_REQUESTS_SHOWN = 50;

/** How many change-record rows the detail screen lists, newest first. */
export const DETAIL_CHANGES_SHOWN = 100;

/**
 * How far before the oldest listed request a guardrail decision is still
 * looked for. The guardrail service stamps its own time, which can differ a
 * little from the gateway's; the link itself is the gateway call id.
 */
export const DECISION_LOOKBACK_MS = 3_600_000;

/** A generation's row as read for the detail screen. Never the token hash. */
export type GenerationRow = {
  id: string;
  generation: number;
  displayName: string;
  litellmKeyAlias: string;
  status: AcmeLitellmKeyStatus;
  models: string[];
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxBudget: number | null;
  budgetDuration: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

/**
 * The application's current generation: the newest active one, as on the
 * scorecard. Undefined when none is active, and then the lineage is not an
 * application the page shows.
 */
export function currentGeneration<
  T extends { generation: number; status: AcmeLitellmKeyStatus },
>(generations: T[]): T | undefined {
  return [...generations]
    .sort((a, b) => b.generation - a.generation)
    .find((g) => g.status === AcmeLitellmKeyStatus.ACTIVE);
}

/**
 * A generation as the detail screen shows it: its settings and dates. A
 * rotated key's end is its rotation, any other's its revocation.
 */
export function generationView(row: GenerationRow, currentId: string) {
  const ended = row.revokedAt?.toISOString() ?? null;
  const rotated = row.status === AcmeLitellmKeyStatus.ROTATED;
  return {
    generation: row.generation,
    alias: row.litellmKeyAlias,
    status: row.status,
    current: row.id === currentId,
    createdAt: row.createdAt.toISOString(),
    rotatedAt: rotated ? ended : null,
    revokedAt: rotated ? null : ended,
    models: row.models,
    rpmLimit: row.rpmLimit,
    tpmLimit: row.tpmLimit,
    maxBudget: row.maxBudget,
    budgetDuration: row.budgetDuration,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/** A guardrail decision as read for the detail screen. Metadata only. */
export type DecisionRow = {
  traceId: string | null;
  eventTime: Date;
  direction: AcmeGuardrailEventDirection;
  action: AcmeGuardrailEventAction;
  policyTriggered: string | null;
  gatewayMode: string | null;
};

export type DecisionView = {
  time: string;
  direction: "input" | "output";
  action: GuardrailAction;
  mode: GatewayMode | null;
  policy: string | null;
};

const ACTION_VIEW: Record<AcmeGuardrailEventAction, GuardrailAction> = {
  [AcmeGuardrailEventAction.ALLOW]: "allow",
  [AcmeGuardrailEventAction.REDACT]: "redact",
  [AcmeGuardrailEventAction.BLOCK]: "block",
  [AcmeGuardrailEventAction.UNAVAILABLE]: "unavailable",
};

export function decisionView(d: DecisionRow): DecisionView {
  return {
    time: d.eventTime.toISOString(),
    direction:
      d.direction === AcmeGuardrailEventDirection.INPUT ? "input" : "output",
    action: ACTION_VIEW[d.action],
    mode: gatewayModeFromDb(d.gatewayMode),
    policy: d.policyTriggered,
  };
}

/**
 * The call ids to look decisions up by. A decision's trace id is the gateway
 * call id; the request log holds it as `litellmCallId`, and on a failed call
 * also as `requestId`, so both are tried, as the guardrail log's detail
 * panel does (CHG-2026-071).
 */
export function requestCallIds(
  requests: { litellmCallId: string | null; requestId: string }[],
): string[] {
  return [
    ...new Set(
      requests.flatMap((r) =>
        [r.litellmCallId, r.requestId].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
}

/** Each request's decisions, prompt first, in time order. */
export function decisionsByRequest<
  R extends { id: string; litellmCallId: string | null; requestId: string },
>(requests: R[], decisions: DecisionRow[]): Map<string, DecisionView[]> {
  const byCallId = new Map<string, DecisionRow[]>();
  for (const d of decisions) {
    if (!d.traceId) continue;
    const list = byCallId.get(d.traceId) ?? [];
    list.push(d);
    byCallId.set(d.traceId, list);
  }
  const out = new Map<string, DecisionView[]>();
  for (const r of requests) {
    const matched = requestCallIds([r])
      .flatMap((id) => byCallId.get(id) ?? [])
      .sort(
        (a, b) =>
          a.eventTime.getTime() - b.eventTime.getTime() ||
          Number(b.direction === AcmeGuardrailEventDirection.INPUT) -
            Number(a.direction === AcmeGuardrailEventDirection.INPUT),
      );
    out.set(r.id, matched.map(decisionView));
  }
  return out;
}

/** A gateway request as read for the detail screen. Metadata only. */
export type RequestRow = {
  id: string;
  requestId: string;
  litellmCallId: string | null;
  startTime: Date;
  endTime: Date | null;
  status: string;
  errorClass: string | null;
  model: string | null;
  modelGroup: string | null;
  keyAlias: string | null;
  endUser: string | null;
  /** Read only when the viewer may see spend. */
  spend?: number | null;
};

/**
 * A request as the detail screen lists it. The cost is there only when the
 * viewer may see spend; otherwise the field is absent, not null. The request
 * and call ids are used for the join only and are not returned.
 */
export function requestView(
  row: RequestRow,
  decisions: DecisionView[],
  generationByAlias: Map<string, number>,
  canSeeSpend: boolean,
) {
  return {
    id: row.id,
    time: row.startTime.toISOString(),
    generation: row.keyAlias
      ? (generationByAlias.get(row.keyAlias) ?? null)
      : null,
    model: row.modelGroup ?? row.model,
    succeeded: row.status === "success",
    errorClass: row.errorClass,
    latencyMs: row.endTime
      ? row.endTime.getTime() - row.startTime.getTime()
      : null,
    endUser: row.endUser,
    ...(canSeeSpend ? { costUsd: row.spend ?? null } : {}),
    decisions,
  };
}

export type DailyActivityPoint = {
  day: string;
  calls: number;
  failed: number;
  refused: number;
  /** Present only when the viewer may see spend. */
  spendUsd?: number;
};

/**
 * One point per UTC day, `days` days from `start`, with zeros where nothing
 * happened. Rows for a day outside the range are ignored. Spend is summed
 * and returned only when the viewer may see it.
 */
export function dailyActivity(
  start: Date,
  days: number,
  callRows: {
    day: string;
    calls: number;
    failed: number;
    spend?: number | null;
  }[],
  refusedRows: { day: string; n: number }[],
  canSeeSpend: boolean,
): DailyActivityPoint[] {
  const points: DailyActivityPoint[] = Array.from({ length: days }, (_, i) => ({
    day: utcDay(new Date(start.getTime() + i * 86_400_000)),
    calls: 0,
    failed: 0,
    refused: 0,
    ...(canSeeSpend ? { spendUsd: 0 } : {}),
  }));
  const byDay = new Map(points.map((p) => [p.day, p]));
  for (const r of callRows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    p.calls += r.calls;
    p.failed += r.failed;
    if (canSeeSpend) p.spendUsd = (p.spendUsd ?? 0) + (r.spend ?? 0);
  }
  for (const r of refusedRows) {
    const p = byDay.get(r.day);
    if (p) p.refused += r.n;
  }
  return points;
}

// ----- the change record ---------------------------------------------------

/**
 * The key settings a change-record row may show, by the field name the
 * gateway service writes into the record's before and after. Anything else in
 * them (the token hash above all, and ids) is never read out.
 */
export const KEY_SETTING_LABELS = {
  displayName: "Name",
  alias: "Alias",
  status: "Status",
  models: "Models",
  maxBudget: "Budget",
  budgetDuration: "Budget period",
  rpmLimit: "Requests per minute",
  tpmLimit: "Tokens per minute",
  expiresAt: "Expiry",
} as const;

export type KeySetting = keyof typeof KEY_SETTING_LABELS;
export type SettingValue = string | number | boolean | string[] | null;

/** The longest text one setting value is shown with. */
const SETTING_TEXT_MAX = 200;
/** The most list items one setting value is shown with. */
const SETTING_LIST_MAX = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A stored value as a plain, bounded value; anything else as null. */
function settingValue(v: unknown): SettingValue {
  if (typeof v === "string") return v.slice(0, SETTING_TEXT_MAX);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === "string")
      .slice(0, SETTING_LIST_MAX)
      .map((x) => x.slice(0, SETTING_TEXT_MAX));
  }
  return null;
}

export type SettingChange = {
  setting: KeySetting;
  label: string;
  from: SettingValue;
  to: SettingValue;
};

/**
 * Which allow-listed settings a change-record row changed, from its before
 * and after. Only settings present in `after` count: an intent row has no
 * after, and a rotation's after describes the operation, not one key, so
 * both list nothing. With no before (a key's creation), every setting the
 * key was created with is listed, from nothing.
 */
export function changedSettings(
  before: unknown,
  after: unknown,
): SettingChange[] {
  if (!isRecord(after)) return [];
  const prior = isRecord(before) ? before : null;
  const changes: SettingChange[] = [];
  for (const setting of Object.keys(KEY_SETTING_LABELS) as KeySetting[]) {
    if (!Object.prototype.hasOwnProperty.call(after, setting)) continue;
    const to = settingValue(after[setting]);
    const from = prior ? settingValue(prior[setting]) : null;
    const unchanged = JSON.stringify(from) === JSON.stringify(to);
    const empty = to === null || (Array.isArray(to) && to.length === 0);
    if (prior ? unchanged : empty) continue;
    changes.push({ setting, label: KEY_SETTING_LABELS[setting], from, to });
  }
  return changes;
}

/** A change-record row as read for the detail screen. */
export type ChangeRow = {
  id: string;
  eventTime: Date;
  phase: AcmeLitellmEventPhase;
  outcome: AcmeLitellmEventOutcome | null;
  action: string;
  resourceId: string;
  actorUserId: string;
  actorOrgRole: string | null;
  actorProjectRole: string | null;
  before: unknown;
  after: unknown;
};

const OUTCOME_VIEW: Record<
  AcmeLitellmEventOutcome,
  "succeeded" | "failed" | "partial"
> = {
  [AcmeLitellmEventOutcome.SUCCESS]: "succeeded",
  [AcmeLitellmEventOutcome.FAILURE]: "failed",
  [AcmeLitellmEventOutcome.PARTIAL]: "partial",
};

/**
 * A change-record row as the detail screen lists it: what was done, by whom,
 * when, to which generation, and which settings changed. The record's before
 * and after are not returned, only the allow-listed changes read from them.
 */
export function changeView(
  row: ChangeRow,
  generationByKeyId: Map<string, number>,
  actorById: Map<string, string>,
) {
  return {
    id: row.id,
    time: row.eventTime.toISOString(),
    action: row.action,
    phase:
      row.phase === AcmeLitellmEventPhase.INTENT
        ? ("intent" as const)
        : ("outcome" as const),
    outcome: row.outcome ? OUTCOME_VIEW[row.outcome] : null,
    generation: generationByKeyId.get(row.resourceId) ?? null,
    actor: actorById.get(row.actorUserId) ?? "Unknown user",
    role: row.actorProjectRole ?? row.actorOrgRole,
    changes: changedSettings(row.before, row.after),
  };
}
