/**
 * ACME (CHG-2026-138, ADR-0027): the EYEON Enforcement and policy page's
 * figures.
 *
 * Pure functions only, so they are tested without a database; the router
 * (eyeonEnforcementRouter.ts) does the reads. Every input here is metadata:
 * the guardrail settings in force and their mode history, the settings
 * version each guardrail pod reports, the mode each gateway replica reported
 * with its latest decision, and counts of guardrail decisions by verdict,
 * policy label and reported mode. Nothing here sees prompt or answer text,
 * redacted text, personal-data findings or encrypted content.
 *
 * Owner decisions of 2026-10-07 (CHG-2026-138 follow-up):
 * - who changed the mode and the reason given are shown, as the Guardrails
 *   page shows them (modeChangeBy): never the user id, the email only to the
 *   deployment's guardrail administrators;
 * - the guardrail pods are counted, never named, as the gateway replicas are.
 *
 * The mode is the Guardrails page's own: the version in force, an ended
 * trial read as record, capped by the deployment ceiling (servedMode).
 */
import {
  AUTOMATIC_CREATOR,
  type GuardrailMode,
  type GuardrailModeChange,
  type GuardrailSettingsVersion,
  POD_STALE_AFTER_SECONDS,
  effectiveMode,
  trialExpired,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import { utcDay } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import {
  type ModeChangeBy,
  modeChangeBy,
  overviewMode,
} from "@/src/features/acme-enhancements/server/eyeonOverview";
import {
  type ModeSplit,
  type RefusalType,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";

// ------------------------------------------------------------ the mode now

export type EnforcementMode = ReturnType<typeof overviewMode> & {
  /** The settings version in force; null when none is stored. */
  version: number | null;
  /** The mode the version in force was saved with, before trial and ceiling. */
  storedMode: GuardrailMode | null;
  /** A stored enforce that the ceiling serves as record (SF-2026-023). */
  cappedByCeiling: boolean;
  /**
   * An enforce trial whose switch-back time has passed: it is served as
   * record already, and the next pod pull writes the automatic version.
   */
  switchBackDue: boolean;
};

/**
 * The mode EYEON serves now against its ceiling, as the Guardrails page and
 * the overview read it (overviewMode, servedMode), with the two cases where
 * the stored version and the served mode differ. `showEmail`: the viewer is
 * one of the deployment's guardrail administrators (defaults to no).
 */
export function enforcementMode(
  settings: GuardrailSettingsVersion | null,
  changes: readonly GuardrailModeChange[],
  now: Date,
  ceiling: GuardrailMode,
  showEmail = false,
): EnforcementMode {
  return {
    ...overviewMode(settings, changes, now, ceiling, showEmail),
    version: settings?.version ?? null,
    storedMode: settings?.mode ?? null,
    cappedByCeiling: settings
      ? effectiveMode(settings, now) === "enforce" && ceiling !== "enforce"
      : false,
    switchBackDue: settings ? trialExpired(settings, now) : false,
  };
}

// ------------------------------------------------- checks per day, by mode

/** One UTC day's checks, as the daily SQL returns them. */
export type DailyModeRow = {
  day: string;
  checks: number;
  /** Decided where the gateway reported enforce mode. */
  enforceMode: number;
  /** Decided where the gateway reported record mode. */
  recordMode: number;
};

export type DailyModes = DailyModeRow & {
  /** No mode, or a value the console does not know, reported. */
  notReported: number;
};

/**
 * One point per UTC day, `days` days from `start`, with zeros where nothing
 * happened; a check with no reported mode is "not reported". Rows for a day
 * outside the range are ignored.
 */
export function dailyModes(
  start: Date,
  days: number,
  rows: readonly DailyModeRow[],
): DailyModes[] {
  const points: DailyModes[] = Array.from({ length: days }, (_, i) => ({
    day: utcDay(new Date(start.getTime() + i * 86_400_000)),
    checks: 0,
    enforceMode: 0,
    recordMode: 0,
    notReported: 0,
  }));
  const byDay = new Map(points.map((p) => [p.day, p]));
  for (const r of rows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    p.checks += r.checks;
    p.enforceMode += r.enforceMode;
    p.recordMode += r.recordMode;
  }
  for (const p of points)
    p.notReported = Math.max(0, p.checks - p.enforceMode - p.recordMode);
  return points;
}

// ------------------------------------------------------------ mode history

/**
 * One recorded change of mode: when, to what, who and why (ModeChangeBy: an
 * automatic switch-back says so; the email only for a guardrail
 * administrator; never the user id).
 */
export type ModeChangeRow = ModeChangeBy & {
  version: number;
  at: string;
  /** The mode before; null for the first version stored. */
  from: GuardrailMode | null;
  to: GuardrailMode;
  /** For an enforce trial: when it switches back to record. */
  switchBackAt: string | null;
  /** Made within the page's period. */
  inPeriod: boolean;
};

/**
 * The recorded changes of mode, newest first, at most `limit` of them, and
 * how many fell in the period. `changes` is listModeChanges' output (oldest
 * first). Who made a change and the reason given are passed on as the
 * Guardrails page shows them (modeChangeBy); `showEmail`: the viewer is one
 * of the deployment's guardrail administrators (defaults to no).
 */
export function modeHistory(
  changes: readonly GuardrailModeChange[],
  since: Date,
  limit: number,
  showEmail = false,
): { shown: ModeChangeRow[]; inPeriod: number; total: number } {
  const rows = changes.map(
    (c): ModeChangeRow => ({
      version: c.version,
      at: c.createdAt.toISOString(),
      from: c.previousMode,
      to: c.mode,
      switchBackAt:
        c.mode === "enforce" && c.revertAt ? c.revertAt.toISOString() : null,
      ...modeChangeBy(c, showEmail),
      inPeriod: c.createdAt.getTime() >= since.getTime(),
    }),
  );
  return {
    shown: rows.reverse().slice(0, limit),
    inPeriod: rows.filter((r) => r.inPeriod).length,
    total: rows.length,
  };
}

// ------------------------------------------------------------------- trial

export type TrialOutcome =
  /** Served as enforce now, until its switch-back time. */
  | "running"
  /** Served as record now; no later version is recorded yet. */
  | "servedAsRecord"
  /** The automatic switch-back was recorded. */
  | "automatic"
  /** A later change of mode, or of the switch-back time, was recorded. */
  | "changed";

export type LastTrial = {
  startedAt: string;
  switchBackAt: string;
  /** The planned length, in minutes. */
  minutes: number;
  outcome: TrialOutcome;
  /** For "automatic" and "changed": when the next change was recorded. */
  endedAt: string | null;
  /** For "automatic" and "changed": the mode it changed to. */
  endedTo: GuardrailMode | null;
};

/**
 * The newest enforce trial in the mode history (an enforce change with a
 * switch-back time), and what the history records after it. `trialEndsAt`
 * is the trial served now (overviewMode), so "running" agrees with the mode
 * the page shows.
 */
export function lastTrial(
  changes: readonly GuardrailModeChange[],
  trialEndsAt: string | null,
): LastTrial | null {
  let index = -1;
  changes.forEach((c, i) => {
    if (c.mode === "enforce" && c.revertAt !== null) index = i;
  });
  const trial = changes[index];
  if (!trial || !trial.revertAt) return null;
  const next = changes[index + 1];
  const switchBackAt = trial.revertAt.toISOString();
  const outcome: TrialOutcome = next
    ? next.automatic || next.createdBy === AUTOMATIC_CREATOR
      ? "automatic"
      : "changed"
    : trialEndsAt === switchBackAt
      ? "running"
      : "servedAsRecord";
  return {
    startedAt: trial.createdAt.toISOString(),
    switchBackAt,
    minutes: Math.round(
      (trial.revertAt.getTime() - trial.createdAt.getTime()) / 60_000,
    ),
    outcome,
    endedAt: next ? next.createdAt.toISOString() : null,
    endedTo: next ? next.mode : null,
  };
}

// ------------------------------------------------------- guardrail pods

/**
 * A pod-status row as the page reads it: the version the pod applied and
 * when it pulled. The pod's name is not read (owner decision, 2026-10-07).
 */
export type PodRow = {
  appliedVersion: number | null;
  lastSyncAt: Date;
};

/**
 * The guardrail pods' agreement, as counts only: the pods are counted,
 * never named, as the gateway replicas are.
 */
export type PodAgreement = {
  /** Pods that reported within the stale window. */
  reporting: number;
  /** Of those, the pods on the version in force. */
  onCurrent: number;
  /** Of those, the pods on another version. */
  older: number;
  /** Of those, the pods that reported before their first settings. */
  unknown: number;
  /** Pods that stopped reporting; not counted in the agreement. */
  stale: number;
  currentVersion: number | null;
  staleAfterSeconds: number;
  /**
   * Every reporting pod applied the version in force. Null when no pod
   * reported, or no settings are stored, so there is nothing to agree on.
   */
  agree: boolean | null;
};

/**
 * Whether the guardrail pods agree: each pod reports the settings version it
 * applied, and is stale after POD_STALE_AFTER_SECONDS without a report, as
 * on the Guardrails page (listReportingPods). A pod reports a version, not a
 * mode. Counts only: nothing that names a pod is passed on.
 */
export function podAgreement(
  rows: readonly PodRow[],
  currentVersion: number | null,
  now: Date,
): PodAgreement {
  const cutoff = now.getTime() - POD_STALE_AFTER_SECONDS * 1000;
  const counts = { onCurrent: 0, older: 0, unknown: 0, stale: 0 };
  for (const r of rows) {
    if (r.lastSyncAt.getTime() < cutoff) counts.stale += 1;
    else if (r.appliedVersion === null) counts.unknown += 1;
    else if (r.appliedVersion === currentVersion) counts.onCurrent += 1;
    else counts.older += 1;
  }
  const reporting = rows.length - counts.stale;
  return {
    reporting,
    ...counts,
    currentVersion,
    staleAfterSeconds: POD_STALE_AFTER_SECONDS,
    agree:
      currentVersion === null || reporting === 0
        ? null
        : counts.onCurrent === reporting,
  };
}

// ------------------------------------------------------- gateway replicas

/** A gateway replica's latest report, as listReportingGateways returns it. */
export type GatewayReport = {
  pod: string;
  mode: GuardrailMode | null;
  settingsVersion: number | null;
  lastSeenAt: Date;
};

export type GatewayAgreement = {
  /** Replicas seen with a decision in this project in the window. */
  replicas: number;
  /** By the mode each reported with its latest decision. */
  byMode: { enforce: number; record: number; notReported: number };
  /** The settings versions the replicas reported, ascending. */
  versions: number[];
  /** Every replica reported the same mode. Null without replicas. */
  sameMode: boolean | null;
  /**
   * Every replica whose latest decision came after the last change of mode
   * reported the mode EYEON serves now. Null when there is none to compare.
   */
  matchesServed: boolean | null;
  /** Replicas last seen before the last change of mode: not compared. */
  beforeLastChange: number;
  lastSeenAt: string | null;
};

/**
 * Whether the gateway replicas agree on the mode. Each replica reports its
 * effective mode with every decision; its latest report is "last seen", not
 * a heartbeat. Counts only: the replicas' names are not passed on.
 */
export function gatewayAgreement(
  reports: readonly GatewayReport[],
  served: GuardrailMode | null,
  lastChangeAt: string | null,
): GatewayAgreement {
  const byMode = { enforce: 0, record: 0, notReported: 0 };
  for (const r of reports) {
    if (r.mode === "enforce") byMode.enforce += 1;
    else if (r.mode === "record") byMode.record += 1;
    else byMode.notReported += 1;
  }
  const changedAt = lastChangeAt ? new Date(lastChangeAt).getTime() : null;
  const comparable = reports.filter(
    (r) => changedAt === null || r.lastSeenAt.getTime() >= changedAt,
  );
  const first = reports[0];
  const newest = reports.reduce<Date | null>(
    (latest, r) =>
      latest === null || r.lastSeenAt.getTime() > latest.getTime()
        ? r.lastSeenAt
        : latest,
    null,
  );
  return {
    replicas: reports.length,
    byMode,
    versions: [
      ...new Set(
        reports.flatMap((r) =>
          r.settingsVersion === null ? [] : [r.settingsVersion],
        ),
      ),
    ].sort((a, b) => a - b),
    sameMode: first
      ? first.mode !== null && reports.every((r) => r.mode === first.mode)
      : null,
    matchesServed:
      served === null || comparable.length === 0
        ? null
        : comparable.every((r) => r.mode === served),
    beforeLastChange: reports.length - comparable.length,
    lastSeenAt: newest ? newest.toISOString() : null,
  };
}

// ---------------------------------------------------------------- policies

function emptySplit(): ModeSplit {
  return { enforced: 0, notEnforced: 0 };
}

function addSplit(a: ModeSplit, b: ModeSplit): ModeSplit {
  return {
    enforced: a.enforced + b.enforced,
    notEnforced: a.notEnforced + b.notEnforced,
  };
}

/** A policy's refusals in the period, applied and recorded only. */
type PolicyRefusals = ModeSplit & { prompts: number; answers: number };

export type PoliciesInForce = {
  /** The settings version in force, and when it was saved. */
  version: number;
  savedAt: string;
  jailbreak: { enabled: boolean; refusals: PolicyRefusals };
  topical: { enabled: boolean; refusals: PolicyRefusals };
  personalData: {
    /** The personal-data types selected (configuration, not findings). */
    entities: string[];
    /** How many types this console can select. */
    available: number;
    redactions: ModeSplit;
  };
  /** Refusals of text too large to check; its limit is not stored here. */
  oversized: { refusals: PolicyRefusals };
  /** Refusals under any other label, by the scorecard's type names. */
  other: { refusals: PolicyRefusals; types: string[] };
};

function refusalsOf(types: readonly RefusalType[]): PolicyRefusals {
  return types.reduce<PolicyRefusals>(
    (sum, t) => ({
      ...addSplit(sum, t.split),
      prompts: sum.prompts + t.prompts,
      answers: sum.answers + t.answers,
    }),
    { ...emptySplit(), prompts: 0, answers: 0 },
  );
}

/**
 * What EYEON stores about the guardrail policies (the settings in force:
 * the jailbreak and topic checks on or off, the personal-data types), each
 * with what it flagged in the period. Refusals are matched to a policy by
 * the Applications scorecard's mapping of the policy label (refusalsByType);
 * the label itself is never passed on. Null when no settings are stored.
 */
export function policiesInForce(
  settings: GuardrailSettingsVersion | null,
  refusals: readonly RefusalType[],
  redactions: ModeSplit,
  availableEntities: number,
): PoliciesInForce | null {
  if (!settings) return null;
  const of = (type: RefusalType["type"]) =>
    refusalsOf(refusals.filter((r) => r.type === type));
  const others = refusals.filter(
    (r) => !["jailbreak", "offTopic", "oversized"].includes(r.type),
  );
  return {
    version: settings.version,
    savedAt: settings.createdAt.toISOString(),
    jailbreak: {
      enabled: settings.jailbreakEnabled,
      refusals: of("jailbreak"),
    },
    topical: { enabled: settings.topicalEnabled, refusals: of("offTopic") },
    personalData: {
      entities: [...settings.piiEntities],
      available: availableEntities,
      redactions: { ...redactions },
    },
    oversized: { refusals: of("oversized") },
    other: {
      refusals: refusalsOf(others),
      types: others.map((r) => r.label),
    },
  };
}
