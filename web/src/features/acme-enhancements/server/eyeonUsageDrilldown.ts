/**
 * ACME (ADR-0027): the EYEON Usage drill-down page's figures.
 *
 * Three levels, each one query away from the last: applications (calls,
 * tokens, cost, guardrail flags), then the people using one application
 * (calls, cost, flags), then the types of prompt one person sent that the
 * guardrails flagged (jailbreak or misuse, personal data and so on).
 *
 * Pure functions only, so they are tested without a database. Every input is
 * metadata: counts and sums from the gateway request-log mirror, counts from
 * the guardrail decisions, and the caller-asserted user id both carry. No
 * prompt or answer text, redacted text, findings or encrypted content is an
 * input here. The type of a flagged prompt is decided from the guardrail's
 * policy label by the same mapping the Applications scorecard uses.
 */
import {
  THREAT_TYPES,
  THREAT_TYPE_LABEL,
  type ThreatType,
  threatType,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { type ApplicationRef } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";

/** How many rows each level lists; the database caps the read. */
export const USAGE_ROWS_SHOWN = 100;

/** The user id a drill-down request carries for calls with no user id. */
export const NO_USER = "";

export type RequestAliasRow = {
  alias: string;
  calls: number;
  failed: number;
  spend: number;
  totalTokens: number;
};

export type DecisionAliasRow = {
  alias: string;
  checks: number;
  /** Prompts the guardrails refused or redacted (direction input). */
  flagged: number;
};

export type UsageApplicationRow = {
  /** Null for calls made with keys that no longer belong to an application. */
  lineageId: string | null;
  name: string;
  calls: number;
  failed: number;
  spendUsd: number;
  totalTokens: number;
  checks: number;
  flagged: number;
};

/** Label of the row that sums keys with no application. */
export const OTHER_KEYS = "Keys no longer in use";

/**
 * One row per application: every generation of its key summed, with the
 * guardrail flags of the same aliases. Aliases that resolve to no application
 * are summed into one row, so the totals still agree with the Spend page.
 * Costliest first, then by name.
 */
export function usageByApplication(
  requests: RequestAliasRow[],
  decisions: DecisionAliasRow[],
  byAlias: Map<string, ApplicationRef>,
): UsageApplicationRow[] {
  const rows = new Map<string, UsageApplicationRow>();
  const rowFor = (alias: string): UsageApplicationRow => {
    const app = byAlias.get(alias);
    const key = app ? app.lineageId : "";
    let row = rows.get(key);
    if (!row) {
      row = {
        lineageId: app ? app.lineageId : null,
        name: app ? app.name : OTHER_KEYS,
        calls: 0,
        failed: 0,
        spendUsd: 0,
        totalTokens: 0,
        checks: 0,
        flagged: 0,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const r of requests) {
    const row = rowFor(r.alias);
    row.calls += r.calls;
    row.failed += r.failed;
    row.spendUsd += r.spend;
    row.totalTokens += r.totalTokens;
  }
  for (const d of decisions) {
    const row = rowFor(d.alias);
    row.checks += d.checks;
    row.flagged += d.flagged;
  }
  return [...rows.values()].sort(
    (a, b) => b.spendUsd - a.spendUsd || a.name.localeCompare(b.name),
  );
}

export type RequestUserRow = {
  user: string | null;
  calls: number;
  failed: number;
  spend: number;
  totalTokens: number;
};

export type DecisionUserRow = {
  user: string | null;
  checks: number;
  flagged: number;
};

export type UsageUserRow = {
  /** NO_USER for calls and checks that carried no user id. */
  user: string;
  calls: number;
  failed: number;
  spendUsd: number;
  totalTokens: number;
  checks: number;
  flagged: number;
};

const userKey = (user: string | null): string =>
  user === null || user.trim() === "" ? NO_USER : user;

/**
 * One row per user of one application, from the request log and the
 * guardrail decisions joined on the user id both record. Costliest first,
 * then most flagged, then by id.
 */
export function usageByUser(
  requests: RequestUserRow[],
  decisions: DecisionUserRow[],
): UsageUserRow[] {
  const rows = new Map<string, UsageUserRow>();
  const rowFor = (user: string | null): UsageUserRow => {
    const key = userKey(user);
    let row = rows.get(key);
    if (!row) {
      row = {
        user: key,
        calls: 0,
        failed: 0,
        spendUsd: 0,
        totalTokens: 0,
        checks: 0,
        flagged: 0,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const r of requests) {
    const row = rowFor(r.user);
    row.calls += r.calls;
    row.failed += r.failed;
    row.spendUsd += r.spend;
    row.totalTokens += r.totalTokens;
  }
  for (const d of decisions) {
    const row = rowFor(d.user);
    row.checks += d.checks;
    row.flagged += d.flagged;
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.spendUsd - a.spendUsd ||
      b.flagged - a.flagged ||
      a.user.localeCompare(b.user),
  );
}

/** One policy label, verdict and count, as the type query returns it. */
export type PromptTypeRow = {
  policyTriggered: string | null;
  action: "allow" | "block" | "redact" | "unavailable";
  count: number;
};

export type PromptTypeCount = {
  type: ThreatType;
  label: string;
  blocked: number;
  redacted: number;
  total: number;
};

export type PromptTypes = {
  /** Flagged prompts by type, most frequent first. */
  types: PromptTypeCount[];
  /** Prompts checked and allowed through unflagged. */
  clean: number;
  /** Prompts checked and given no verdict. */
  noVerdict: number;
  /** Every prompt checked: the base of the shares. */
  checked: number;
};

/**
 * The prompts one user sent, grouped by what the guardrails found. Only a
 * refusal or a redaction carries a policy label; the label is caller-set
 * text, so it is never shown as such, only mapped to a type (an unknown or
 * missing label counts as "Other").
 */
export function promptTypes(rows: PromptTypeRow[]): PromptTypes {
  const byType = new Map<ThreatType, PromptTypeCount>();
  let clean = 0;
  let noVerdict = 0;
  let checked = 0;
  for (const r of rows) {
    checked += r.count;
    if (r.action === "allow") {
      clean += r.count;
      continue;
    }
    if (r.action === "unavailable") {
      noVerdict += r.count;
      continue;
    }
    const type = threatType(r.policyTriggered);
    let entry = byType.get(type);
    if (!entry) {
      entry = {
        type,
        label: THREAT_TYPE_LABEL[type],
        blocked: 0,
        redacted: 0,
        total: 0,
      };
      byType.set(type, entry);
    }
    if (r.action === "block") entry.blocked += r.count;
    else entry.redacted += r.count;
    entry.total += r.count;
  }
  const order = (t: ThreatType) => THREAT_TYPES.indexOf(t);
  const types = [...byType.values()].sort(
    (a, b) => b.total - a.total || order(a.type) - order(b.type),
  );
  return { types, clean, noVerdict, checked };
}
