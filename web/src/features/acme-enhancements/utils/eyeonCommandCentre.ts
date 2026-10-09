/**
 * ACME (CHG-2026-147, ADR-0030): the EYEON command centre's words and
 * figures: the briefing, the "Needs your attention" queue, the three rings
 * and the links. Written for an executive and a security lead: are we safe,
 * what does it cost, what needs me.
 *
 * Pure functions over what the EYEON pages' own summaries return (the
 * overview, Spend, Gateway health, Guardrail decisions, and Enforcement and
 * policy), so every figure here is the figure the linked page shows. Nothing
 * here reads data; a source this viewer may not open, or whose page is
 * switched off, is absent, and the words say so rather than showing a zero.
 */
import { type RouterOutputs } from "@/src/utils/api";
import { SCORECARD_THRESHOLDS } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import {
  formatCount,
  formatPct,
  formatUsd,
  monthName,
} from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";
import { formatRate } from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";

type Enabled<T> = Extract<T, { enabled: true }>;

export type HomeOverview = Enabled<RouterOutputs["eyeonOverview"]["summary"]>;
type SpendEnabled = Enabled<RouterOutputs["eyeonSpend"]["summary"]>;
/**
 * Spend with its request log on: the figures the widgets read. While the
 * request log is off, Spend answers with none of them, and the page treats
 * the source as not recorded.
 */
export type HomeSpend = SpendEnabled & {
  month: NonNullable<SpendEnabled["month"]>;
  period: NonNullable<SpendEnabled["period"]>;
  breakdown: NonNullable<SpendEnabled["breakdown"]>;
  budgets: NonNullable<SpendEnabled["budgets"]>;
};
export type HomeHealth = Enabled<
  RouterOutputs["eyeonGatewayHealth"]["summary"]
>;
export type HomeDecisions = Enabled<
  RouterOutputs["eyeonGuardrailDecisions"]["summary"]
>;
export type HomeEnforcement = Enabled<
  RouterOutputs["eyeonEnforcement"]["summary"]
>;

/**
 * One source of the page. "off": its page is switched off on this
 * deployment, so nothing was read (or, with a reason, what it needs is not
 * recorded). "noAccess": this viewer's role cannot
 * open its page, so it was never asked for.
 */
export type HomeSource<T> =
  | { state: "ready"; data: T }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "off"; reason?: string }
  | { state: "noAccess" };

export type CommandCentreInput = {
  projectId: string;
  windowDays: 7 | 30;
  overview: HomeSource<HomeOverview>;
  spend: HomeSource<HomeSpend>;
  health: HomeSource<HomeHealth>;
  decisions: HomeSource<HomeDecisions>;
  enforcement: HomeSource<HomeEnforcement>;
};

export function ready<T>(source: HomeSource<T>): T | null {
  return source.state === "ready" ? source.data : null;
}

export type CommandLinks = {
  decisions: string;
  enforcement: string;
  guardrails: string;
  /** Null for a role that cannot open Spend, or while it is switched off. */
  spend: string | null;
  health: string;
  /** Null while gateway management is off: there are no applications. */
  applications: string | null;
};

/**
 * Where each figure leads: the EYEON page while it is on and open to this
 * viewer, otherwise the classic page the overview already links to.
 */
export function commandLinks(input: CommandCentreInput): CommandLinks {
  const base = `/project/${input.projectId}/acme-enhancements`;
  const overview = ready(input.overview);
  return {
    decisions: ready(input.decisions)
      ? `${base}/guardrail-decisions`
      : `${base}/security-logs?tab=guardrails`,
    enforcement: ready(input.enforcement)
      ? `${base}/enforcement`
      : `${base}/guardrails`,
    guardrails: `${base}/guardrails`,
    spend: ready(input.spend) ? `${base}/spend` : null,
    health: ready(input.health)
      ? `${base}/gateway-health`
      : `${base}/llm-gateway`,
    applications: overview?.applications ? `${base}/applications` : null,
  };
}

/** "1 application" or "3 applications". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export type AttentionItem = {
  id: string;
  /** "act": a control is not holding or a limit is passed. "watch": drifting. */
  severity: "act" | "watch";
  title: string;
  detail: string;
  href: string | null;
  linkLabel: string;
};

/**
 * What needs a person now, most serious first, each with the page that
 * shows the evidence. Only what the sources prove: an absent source adds
 * nothing, and an empty queue means every check below is within its
 * threshold, not that nothing was checked.
 */
export function attentionItems(input: CommandCentreInput): AttentionItem[] {
  const links = commandLinks(input);
  const items: AttentionItem[] = [];
  const period = `in the last ${input.windowDays} days`;
  const overview = ready(input.overview);
  const health = ready(input.health);
  const enforcement = ready(input.enforcement);
  const spend = ready(input.spend);

  if (overview) {
    const d = overview.decisions;
    const notStopped =
      d.promptsRefused.notEnforced + d.answersWithheld.notEnforced;
    if (notStopped > 0) {
      items.push({
        id: "notStopped",
        severity: "act",
        title: `${plural(notStopped, "risky prompt or answer", "risky prompts and answers")} not stopped`,
        detail: `The guardrails would have refused or withheld them ${period}, but the gateway was not in enforce mode, so they reached the model or the user.`,
        href: links.enforcement,
        linkLabel: "Review enforcement",
      });
    }
    if (overview.judge.alert) {
      items.push({
        id: "judge",
        severity: "act",
        title: `The guardrail judge could not decide ${formatRate(overview.judge.rate ?? 0)} of checks`,
        detail: `${plural(overview.judge.noVerdict, "check")} of ${overview.judge.checks.toLocaleString("en-US")} got no verdict in the last ${overview.judge.windowHours} hours, above the alert level of ${formatRate(overview.judge.alertRate)}.`,
        href: links.decisions,
        linkLabel: "Open guardrail decisions",
      });
    }
    const apps = overview.applications;
    if (apps && apps.byOverall.red > 0) {
      items.push({
        id: "appsAction",
        severity: "act",
        title: `${plural(apps.byOverall.red, "application needs", "applications need")} action`,
        detail: `Rated "Act now" on the Applications scorecard ${period}.`,
        href: links.applications,
        linkLabel: "Open Applications",
      });
    }
  }

  if (health?.health && health.health.counts.unhealthy > 0) {
    const failing = health.health.models
      .filter((m) => m.status === "unhealthy")
      .map((m) => m.model);
    const named = failing.slice(0, 3).join(", ");
    const more = failing.length > 3 ? ` and ${failing.length - 3} more` : "";
    items.push({
      id: "modelsFailing",
      severity: "act",
      title: `${health.health.counts.unhealthy.toLocaleString("en-US")} of ${plural(health.health.counts.total, "model")} failing`,
      detail: `${named}${more} failed the last health check.`,
      href: links.health,
      linkLabel: "Open Gateway health",
    });
  }

  if (enforcement) {
    const pods = enforcement.pods;
    const notCurrent = pods.older + pods.unknown;
    if (pods.agree === false && notCurrent > 0) {
      items.push({
        id: "podsBehind",
        severity: "act",
        title: `${notCurrent.toLocaleString("en-US")} of ${plural(pods.reporting, "guardrail pod")} not on the current settings`,
        detail:
          pods.currentVersion === null
            ? "The pods do not report the settings in force."
            : `Settings version ${pods.currentVersion} is in force; these pods report another or none.`,
        href: links.enforcement,
        linkLabel: "Review enforcement",
      });
    }
    if (enforcement.gateways.matchesServed === false) {
      items.push({
        id: "gatewaysDisagree",
        severity: "act",
        title: "A gateway replica reports a different mode",
        detail:
          "At least one gateway replica's latest decision used a mode other than the one EYEON serves.",
        href: links.enforcement,
        linkLabel: "Review enforcement",
      });
    }
    if (pods.stale > 0) {
      items.push({
        id: "podsStale",
        severity: "watch",
        title: `${plural(pods.stale, "guardrail pod")} stopped reporting`,
        detail: `No report for more than ${Math.round(pods.staleAfterSeconds / 60)} minutes.`,
        href: links.enforcement,
        linkLabel: "Review enforcement",
      });
    }
  }

  if (spend) {
    const over = spend.budgets.shown.filter((b) => b.usedPct >= 100);
    const close = spend.budgets.shown.filter(
      (b) =>
        b.usedPct >= SCORECARD_THRESHOLDS.spendPct.amber && b.usedPct < 100,
    );
    if (over.length > 0) {
      items.push({
        id: "overBudget",
        severity: "act",
        title: `${plural(over.length, "key")} over budget`,
        detail: `${over
          .slice(0, 3)
          .map((b) => b.name)
          .join(", ")}${over.length > 3 ? " and more" : ""}.`,
        href: links.spend,
        linkLabel: "Open Spend",
      });
    }
    if (close.length > 0) {
      items.push({
        id: "nearBudget",
        severity: "watch",
        title: `${plural(close.length, "key")} past ${SCORECARD_THRESHOLDS.spendPct.amber}% of budget`,
        detail: `${close
          .slice(0, 3)
          .map((b) => `${b.name} (${Math.round(b.usedPct)}%)`)
          .join(", ")}.`,
        href: links.spend,
        linkLabel: "Open Spend",
      });
    }
  }

  if (overview) {
    const notRedacted = overview.decisions.redactions.notEnforced;
    if (notRedacted > 0) {
      items.push({
        id: "notRedacted",
        severity: "watch",
        title: `Personal data not redacted in ${plural(notRedacted, "prompt or answer", "prompts and answers")}`,
        detail: `Found ${period}; the redaction was recorded but not applied outside enforce mode.`,
        href: links.decisions,
        linkLabel: "Open guardrail decisions",
      });
    }
    const missing = overview.applications?.missingBudget ?? 0;
    if (missing > 0) {
      items.push({
        id: "noBudget",
        severity: "watch",
        title: `${plural(missing, "application has", "applications have")} no spending limit`,
        detail:
          "Their gateway keys carry no budget, so nothing caps their spend.",
        href: links.applications,
        linkLabel: "Open Applications",
      });
    }
  }

  if (health?.failures) {
    const { calls, failed } = health.failures;
    const pct = calls > 0 ? (100 * failed) / calls : 0;
    if (
      calls >= SCORECARD_THRESHOLDS.minCallsForRates &&
      pct >= SCORECARD_THRESHOLDS.errorPct.amber
    ) {
      items.push({
        id: "failedCalls",
        severity: pct >= SCORECARD_THRESHOLDS.errorPct.red ? "act" : "watch",
        title: `${formatPct(pct)} of gateway calls failed`,
        detail: `${plural(failed, "call")} of ${calls.toLocaleString("en-US")} ${period}.`,
        href: links.health,
        linkLabel: "Open Gateway health",
      });
    }
  }
  if (health?.mirror && health.mirror.state === "behind") {
    items.push({
      id: "mirrorBehind",
      severity: "watch",
      title: "Gateway records are behind",
      detail:
        "The request log has not been reconciled recently, so call and spend figures may be missing calls.",
      href: links.health,
      linkLabel: "Open Gateway health",
    });
  }

  // Most serious first; within a severity, the order above.
  return [
    ...items.filter((i) => i.severity === "act"),
    ...items.filter((i) => i.severity === "watch"),
  ];
}

/** A piece of a briefing sentence; `strong` pieces are the figures. */
type BriefingPart = { text: string; strong?: boolean };

export type Briefing = {
  lead: string;
  tone: "act" | "watch" | "calm";
  sentences: BriefingPart[][];
};

const strong = (text: string): BriefingPart => ({ text, strong: true });
const plain = (text: string): BriefingPart => ({ text });

/** Spend's row for calls made with keys no longer in use (eyeonSpend.ts). */
export const RETIRED_APPLICATIONS = "app:retired";

/** The calls and applications of the period, from Spend or Gateway health. */
function activity(input: CommandCentreInput) {
  const spend = ready(input.spend);
  if (spend) {
    // "Keys no longer in use" is a row of calls, not an application.
    return {
      calls: spend.period.totals.calls,
      failed: spend.period.totals.failed,
      applications: spend.breakdown.application.rows.filter(
        (r) => r.id !== RETIRED_APPLICATIONS,
      ).length,
      moreApplications: spend.breakdown.application.rest.count,
    };
  }
  const failures = ready(input.health)?.failures;
  return failures
    ? {
        calls: failures.calls,
        failed: failures.failed,
        applications: null,
        moreApplications: 0,
      }
    : null;
}

/**
 * The briefing at the top of the page: one line on what needs the reader,
 * then a sentence each on activity, the guardrails, money and model health,
 * for the sources this viewer has.
 */
export function briefing(
  input: CommandCentreInput,
  attention: AttentionItem[],
): Briefing {
  const act = attention.filter((i) => i.severity === "act").length;
  const watch = attention.length - act;
  const lead =
    act > 0
      ? `${plural(act, "thing needs", "things need")} your attention.`
      : watch > 0
        ? `Nothing urgent. ${plural(watch, "item")} to watch.`
        : "All clear: everything EYEON checks is within its thresholds.";
  const sentences: BriefingPart[][] = [];
  const period = `the last ${input.windowDays} days`;

  const a = activity(input);
  if (a) {
    const apps =
      a.applications === null
        ? []
        : [
            plain(" from "),
            strong(plural(a.applications + a.moreApplications, "application")),
          ];
    sentences.push([
      strong(formatCount(a.calls)),
      plain(a.calls === 1 ? " AI call" : " AI calls"),
      ...apps,
      plain(` went through the gateway in ${period}.`),
    ]);
  }

  const overview = ready(input.overview);
  if (overview) {
    const d = overview.decisions;
    if (d.checks === 0) {
      sentences.push([
        plain(`No guardrail checks were recorded in ${period}.`),
      ]);
    } else {
      const refused = d.promptsRefused.enforced + d.promptsRefused.notEnforced;
      const withheld =
        d.answersWithheld.enforced + d.answersWithheld.notEnforced;
      const redacted = d.redactions.enforced + d.redactions.notEnforced;
      const sentence: BriefingPart[] = [
        plain("Guardrails checked "),
        strong(formatCount(d.checks)),
        plain(" prompts and answers: "),
        strong(formatCount(refused)),
        plain(" prompts flagged to refuse, "),
        strong(formatCount(withheld)),
        plain(" answers to withhold and "),
        strong(formatCount(redacted)),
        plain(" with personal data to redact."),
      ];
      const notStopped =
        d.promptsRefused.notEnforced + d.answersWithheld.notEnforced;
      if (overview.mode.mode === "enforce" && notStopped === 0) {
        sentence.push(plain(" Enforce mode applied them."));
      } else if (notStopped > 0) {
        sentence.push(
          plain(" Outside enforce mode, "),
          strong(formatCount(notStopped)),
          plain(" of them were recorded but not stopped."),
        );
      }
      sentences.push(sentence);
    }
  }

  const spend = ready(input.spend);
  if (spend) {
    const m = spend.month;
    const name = monthName(m.month).split(" ")[0] ?? m.month;
    sentences.push(
      m.projectedUsd === null
        ? [strong(formatUsd(m.spentUsd)), plain(` spent so far in ${name}.`)]
        : [
            strong(formatUsd(m.spentUsd)),
            plain(` spent so far in ${name}, on pace for `),
            strong(formatUsd(m.projectedUsd)),
            plain(" by the month's end."),
          ],
    );
  }

  const health = ready(input.health)?.health;
  if (health) {
    const c = health.counts;
    if (health.checkedAt === null || c.total === 0) {
      sentences.push([plain("No model health check is recorded.")]);
    } else if (c.unhealthy > 0) {
      sentences.push([
        strong(`${c.unhealthy} of ${c.total}`),
        plain(" models failed the last health check."),
      ]);
    } else {
      sentences.push([
        plain("All "),
        strong(plural(c.healthy, "model")),
        plain(
          c.unknown > 0
            ? ` checked passed the last health check (${c.unknown} not checked).`
            : " passed the last health check.",
        ),
      ]);
    }
  }

  return {
    lead,
    tone: act > 0 ? "act" : watch > 0 ? "watch" : "calm",
    sentences,
  };
}

export type PostureRing = {
  key: "enforced" | "answered" | "healthy";
  label: string;
  /** 0..1; null when there is nothing to divide (no checks, no calls). */
  fraction: number | null;
  centerText: string;
  caption: string;
  tone: "allow" | "redact" | "block" | "neutral";
};

function ringTone(
  fraction: number | null,
  amber: number,
  red: number,
): PostureRing["tone"] {
  if (fraction === null) return "neutral";
  if (fraction < red) return "block";
  if (fraction < amber) return "redact";
  return "allow";
}

function pctText(fraction: number | null): string {
  if (fraction === null) return "–";
  const pct = 100 * fraction;
  if (pct > 99.5 && pct < 100) return ">99%";
  if (pct > 0 && pct < 0.5) return "<1%";
  return `${Math.round(pct)}%`;
}

/**
 * Three rings, each a share the linked page states exactly: checks decided
 * in enforce mode, gateway calls answered without error, and models that
 * passed the last health check. No score is made up from them.
 */
export function postureRings(input: CommandCentreInput): PostureRing[] {
  const rings: PostureRing[] = [];
  const overview = ready(input.overview);
  if (overview) {
    const pct = overview.decisions.enforcedPct;
    const fraction = pct === null ? null : pct / 100;
    rings.push({
      key: "enforced",
      label: "Enforced",
      fraction,
      centerText: pctText(fraction),
      caption:
        fraction === null
          ? "No guardrail checks in the period"
          : "of guardrail checks decided in enforce mode",
      tone: ringTone(fraction, 0.95, 0.5),
    });
  }
  const a = activity(input);
  if (a) {
    const fraction = a.calls > 0 ? (a.calls - a.failed) / a.calls : null;
    rings.push({
      key: "answered",
      label: "Answered",
      fraction,
      centerText: pctText(fraction),
      caption:
        fraction === null
          ? "No gateway calls in the period"
          : "of gateway calls answered without error",
      tone: ringTone(
        fraction,
        1 - SCORECARD_THRESHOLDS.errorPct.amber / 100,
        1 - SCORECARD_THRESHOLDS.errorPct.red / 100,
      ),
    });
  }
  const health = ready(input.health)?.health;
  if (health) {
    const checked = health.counts.healthy + health.counts.unhealthy;
    const fraction = checked > 0 ? health.counts.healthy / checked : null;
    rings.push({
      key: "healthy",
      label: "Healthy models",
      fraction,
      centerText:
        fraction === null
          ? "–"
          : `${health.counts.healthy}/${checked.toLocaleString("en-US")}`,
      caption:
        fraction === null
          ? "No model health check recorded"
          : "models passed the last health check",
      tone: ringTone(fraction, 1, 0.75),
    });
  }
  return rings;
}

/** "Good morning, Sam", by the viewer's own clock; no name, no comma. */
export function greeting(hour: number, name: string | null | undefined) {
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}
