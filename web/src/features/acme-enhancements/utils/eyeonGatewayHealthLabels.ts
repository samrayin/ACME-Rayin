/**
 * ACME (CHG-2026-139, ADR-0027): the EYEON Gateway health page's wording.
 *
 * Model health is point in time: EYEON keeps only the latest health check,
 * so nothing here speaks of a model's health over time. A failed call is a
 * request-log fact, from the gateway's own error class; the error text is
 * not stored (the ingest discards it, as it can quote a prompt), so a class
 * is described, never quoted. Pure functions and tables, safe in the
 * browser and on the server, tested without either.
 */

/** The periods the failure analysis offers, as the prototype does. */
export const GATEWAY_HEALTH_WINDOWS = ["24h", "7d", "30d"] as const;
export type GatewayHealthWindow = (typeof GATEWAY_HEALTH_WINDOWS)[number];

export const WINDOW_WORDS: Record<
  GatewayHealthWindow,
  { option: string; period: string; bucket: string }
> = {
  "24h": { option: "Last 24 hours", period: "24 hours", bucket: "UTC hour" },
  "7d": { option: "Last 7 days", period: "7 days", bucket: "6 hours (UTC)" },
  "30d": { option: "Last 30 days", period: "30 days", bucket: "UTC day" },
};

/** A model's state at its last health check. */
export type ModelHealthStatus = "healthy" | "unhealthy" | "unknown";

/**
 * Why a model failed its last health check, sorted from the provider's
 * message. The message itself is not returned to this page: it can carry
 * provider detail, and the LLM Gateway page shows it to the same roles.
 */
export type HealthCause =
  | "keyOrCredit"
  | "rateLimited"
  | "notFound"
  | "timeout"
  | "unreachable"
  | "providerError"
  | "unknown";

export const HEALTH_CAUSE: Record<
  HealthCause,
  { label: string; means: string; steps: readonly string[] }
> = {
  keyOrCredit: {
    label: "Key or credit refused",
    means:
      "The provider refused the gateway's call to this model: its key was rejected, or the account has no credit left. Calls to this model fail until it is fixed.",
    steps: [
      "Check the provider account behind this model: credit balance and billing status.",
      "Check that the provider key the gateway uses for this model is still valid: not expired, revoked or replaced.",
      "Once fixed, check health again from the LLM Gateway page.",
      "Tell the owners of the applications that call this model: their calls fail until then.",
    ],
  },
  rateLimited: {
    label: "Rate limited",
    means:
      "The provider throttled the health call: the account is over a rate limit or a quota.",
    steps: [
      "Check the provider account's rate limits and quota.",
      "Look for rate-limited calls from applications in the failure analysis below.",
      "Check health again once the limit resets.",
    ],
  },
  notFound: {
    label: "Model not found or retired",
    means:
      "The provider does not serve this model name, so every call to it fails.",
    steps: [
      "Confirm the model's status on the provider's model list.",
      "Choose a replacement and update the gateway's model list.",
      "Move the applications that call this name to the replacement.",
      "Remove the old name from the gateway, then check health again.",
    ],
  },
  timeout: {
    label: "Timed out",
    means: "The provider did not answer the health call in time.",
    steps: [
      "Check the provider's own status page.",
      "Check health again in a few minutes.",
    ],
  },
  unreachable: {
    label: "Provider not reachable",
    means: "The gateway could not reach the provider's endpoint.",
    steps: [
      "Check the model's endpoint on the LLM Gateway page.",
      "Check the provider's status page and the network path from the gateway.",
      "Check health again once the provider is reachable.",
    ],
  },
  providerError: {
    label: "Provider error",
    means: "The provider answered the health call with a server error.",
    steps: [
      "Check the provider's own status page.",
      "Look for recent model changes in the audit log.",
      "Check health again when the provider recovers.",
    ],
  },
  unknown: {
    label: "Failed its health check",
    means: "The model did not pass its last health check.",
    steps: [
      "Read the provider's message on the LLM Gateway page.",
      "Check the provider's own status page.",
      "Look for recent model or key changes in the audit log.",
      "Check health again once it is fixed.",
    ],
  },
};

/**
 * A failed call's error class, grouped. Each group lists the gateway's own
 * class names it holds; anything else is "Other class", and a failed call
 * logged without a class is "No class reported".
 */
export type ErrorClassGroup =
  | "auth"
  | "rateLimited"
  | "budget"
  | "timeout"
  | "provider"
  | "rejected"
  | "connection"
  | "other"
  | "notReported";

export const ERROR_CLASS_ORDER: readonly ErrorClassGroup[] = [
  "auth",
  "rateLimited",
  "budget",
  "timeout",
  "provider",
  "rejected",
  "connection",
  "other",
  "notReported",
];

export const ERROR_CLASS: Record<
  ErrorClassGroup,
  { label: string; means: string; classes: readonly string[] }
> = {
  auth: {
    label: "Key or permission refused",
    means:
      "The provider rejected the gateway's key for the model, or the key may not use it.",
    classes: ["AuthenticationError", "PermissionDeniedError"],
  },
  rateLimited: {
    label: "Rate limited",
    means: "The provider or the gateway throttled calls above a limit.",
    classes: ["RateLimitError"],
  },
  budget: {
    label: "Budget exceeded",
    means:
      "The gateway refused the call because a key's or a team's budget was spent.",
    classes: ["BudgetExceededError"],
  },
  timeout: {
    label: "Timed out",
    means: "No answer arrived before the timeout.",
    classes: ["Timeout", "APITimeoutError"],
  },
  provider: {
    label: "Provider error or unavailable",
    means: "The provider returned a server error or was down.",
    classes: [
      "ServiceUnavailableError",
      "InternalServerError",
      "BadGatewayError",
      "APIError",
    ],
  },
  rejected: {
    label: "Rejected request",
    means:
      "The provider refused the request itself, for example an unknown model name or input longer than the model accepts.",
    classes: [
      "BadRequestError",
      "NotFoundError",
      "UnprocessableEntityError",
      "ContextWindowExceededError",
      "ContentPolicyViolationError",
      "UnsupportedParamsError",
      "InvalidRequestError",
      "RejectedRequestError",
    ],
  },
  connection: {
    label: "Connection error",
    means: "The gateway could not reach the provider.",
    classes: ["APIConnectionError"],
  },
  other: {
    label: "Other class",
    means:
      "A class EYEON does not group. The Gateway requests log shows each call's class.",
    classes: [],
  },
  notReported: {
    label: "No class reported",
    means: "The gateway logged the call as failed without an error class.",
    classes: [],
  },
};

/** The groups counted as the gateway or a provider refusing on a limit. */
export const LIMIT_GROUPS: readonly ErrorClassGroup[] = [
  "rateLimited",
  "budget",
];

/** Whether the request-log mirror is as complete as it should be. */
export type MirrorState = "withinLag" | "behind" | "noReconciliation";

export const MIRROR_STATE: Record<
  MirrorState,
  { label: string; tone: "good" | "bad" | "neutral" }
> = {
  withinLag: { label: "Within the expected lag", tone: "good" },
  behind: { label: "Behind: completeness unknown", tone: "bad" },
  noReconciliation: { label: "No reconciliation recorded", tone: "neutral" },
};

/** A time as "2026-10-07 12:04 UTC". */
export function utcTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** How long ago `iso` was, from `nowIso`, in words. */
export function ageText(iso: string, nowIso: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.parse(nowIso) - Date.parse(iso)) / 60_000),
  );
  if (minutes < 1) return "under a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** A call's duration: "820 ms", "1.4 s" or "2.5 min". */
export function formatDurationMs(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** A share of calls in percent, one decimal; never rounded to 0% or 100%. */
export function formatCallShare(part: number, whole: number): string {
  if (whole <= 0) return "–";
  const pct = (100 * part) / whole;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  if (pct > 99.9 && pct < 100) return ">99.9%";
  return `${pct.toFixed(1)}%`;
}

/**
 * The failed calls against the previous period of the same length, in
 * words, with whether the change is good or bad news.
 */
export function failedDelta(
  current: number,
  previous: { calls: number; failed: number },
  window: GatewayHealthWindow,
): { text: string; tone: "good" | "bad" | "neutral" } {
  const before = `the previous ${WINDOW_WORDS[window].period}`;
  if (previous.calls === 0)
    return { text: `No calls in ${before}`, tone: "neutral" };
  if (previous.failed === 0) {
    return current === 0
      ? { text: `None failed in ${before} either`, tone: "neutral" }
      : { text: `Up from none in ${before}`, tone: "bad" };
  }
  const change = (100 * (current - previous.failed)) / previous.failed;
  if (Math.abs(change) < 0.5)
    return { text: `About the same as ${before}`, tone: "neutral" };
  const sign = change > 0 ? "+" : "−";
  return {
    text: `${sign}${Math.abs(Math.round(change))}% against ${before} (${previous.failed.toLocaleString()})`,
    tone: change > 0 ? "bad" : "good",
  };
}

/**
 * The page's one-line answer about model health, split as the prototype
 * draws it: the failing count (`lead`, drawn in the block colour) and the
 * rest. "Right now" only while the last check is fresh; an expired check
 * says what it found. Models left out of the check are named in the
 * sentence below the headline, not here (CHG-2026-139 follow-up).
 */
export function routeHeadline(
  health: {
    checkedAt: string | null;
    fresh: boolean;
    counts: { total: number; healthy: number; unhealthy: number };
  } | null,
): { lead: string | null; rest: string } {
  if (!health)
    return {
      lead: null,
      rest: "Gateway management is switched off on this deployment, so EYEON holds no model health.",
    };
  if (!health.checkedAt)
    return { lead: null, rest: "No model health check is recorded yet." };
  const { total, healthy, unhealthy } = health.counts;
  if (total === 0)
    return { lead: null, rest: "The last health check listed no models." };
  const models = total === 1 ? "model" : "models";
  if (unhealthy > 0)
    return {
      lead: `${unhealthy.toLocaleString()} of ${total.toLocaleString()} ${models}`,
      rest: !health.fresh
        ? "failed the last health check."
        : unhealthy === 1
          ? "is failing right now."
          : "are failing right now.",
    };
  if (healthy === total)
    return {
      lead: null,
      rest: `All ${total.toLocaleString()} ${models} answered the last health check.`,
    };
  return {
    lead: null,
    rest: `${healthy.toLocaleString()} of ${total.toLocaleString()} models answered the last health check.`,
  };
}
