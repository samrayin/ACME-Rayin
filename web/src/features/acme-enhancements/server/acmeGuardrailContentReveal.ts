/**
 * ACME (blocked-prompt review, piece 2): reading a blocked prompt's stored
 * content, one event at a time.
 *
 * The content was encrypted by the ingest (acmeGuardrailsEventsIngestService
 * buildEventRow) with GUARDRAILS_ENCRYPTION_KEY, a key separate from the
 * global ENCRYPTION_KEY. The console process already holds that key for the
 * ingest; this module is the only place it is used to decrypt.
 *
 * The order a reveal follows, in acmeGuardrails.revealBlockedContent (the
 * independent security review of 2026-10-26, SF-2026-048 to -053):
 *  1. an untraced procedure: tRPC spans never carry the reason or the text;
 *  2. the server-side flag, CAIRO_GUARDRAIL_CONTENT_REVEAL_ENABLED;
 *  3. the scope guardrailContent:read (Owner, Admin, Security Analyst,
 *     Auditor), and a real project member: an instance administrator who is
 *     not a member of the project is refused;
 *  4. the limits per person and per project (REVEAL_LIMITS);
 *  5. the event, by project and id: a block with stored content, no older
 *     than REVEAL_MAX_AGE_DAYS (the purge job that would delete older rows
 *     is not built yet);
 *  6. the audit record (who, which event, the purpose and the note; never
 *     the content), written before anything is decrypted: a reading that
 *     cannot be recorded is not served;
 *  7. one log line for the SIEM, without the content or the note;
 *  8. decrypt, return once. Never logged, never in the audit record.
 *
 * Pure functions only, so they are tested without a database.
 */
import {
  REVEAL_PURPOSES,
  RevealReasonSchema,
} from "@/src/features/acme-enhancements/utils/guardrailContentReveal";

export { REVEAL_PURPOSES, RevealReasonSchema };

/** Events older than this are not revealed until a retention job exists. */
export const REVEAL_MAX_AGE_DAYS = 30;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The limits a reveal is counted against (security review, SF-2026-051). */
export const REVEAL_LIMITS = [
  { scope: "user", windowMs: HOUR_MS, max: 20 },
  { scope: "user", windowMs: DAY_MS, max: 100 },
  { scope: "project", windowMs: DAY_MS, max: 200 },
] as const;

/**
 * Sliding-window counts of reveals per person and per project, in memory, on
 * each console pod. With more than one console replica the effective limit is
 * the per-pod limit times the replica count; a shared (Redis) counter is the
 * follow-up. It slows bulk reading; the audit log is the record of every
 * reading.
 */
export class RevealLimiter {
  private readonly times = new Map<string, number[]>();

  /**
   * True, and counted against every limit, when the person and the project
   * are under all of them; false, and nothing counted, otherwise.
   */
  tryTake(userId: string, projectId: string, now: number): boolean {
    const keys = REVEAL_LIMITS.map((l) => ({
      ...l,
      key: l.scope === "user" ? `u:${userId}` : `p:${projectId}`,
    }));
    for (const l of keys) {
      const recent = (this.times.get(l.key) ?? []).filter(
        (t) => now - t < l.windowMs,
      );
      if (recent.length >= l.max) return false;
    }
    for (const key of new Set(keys.map((l) => l.key))) {
      const kept = (this.times.get(key) ?? []).filter((t) => now - t < DAY_MS);
      kept.push(now);
      this.times.set(key, kept);
    }
    return true;
  }
}

/** True when the event is too old to reveal. */
export function tooOldToReveal(eventTime: Date, now: number): boolean {
  return now - eventTime.getTime() > REVEAL_MAX_AGE_DAYS * DAY_MS;
}

/**
 * True when the session is a member of the project in its own right. An
 * instance administrator reaches every project as a synthesized Owner; the
 * reveal refuses that, so the audit record never names a role the person
 * does not hold (SF-2026-050).
 */
export function isProjectMember(
  session: {
    user: {
      organizations?: { projects?: { id: string }[] }[];
    };
  },
  projectId: string,
): boolean {
  return (session.user.organizations ?? []).some((org) =>
    (org.projects ?? []).some((p) => p.id === projectId),
  );
}

/** The stored columns a reveal reads. */
export type RevealableEvent = {
  action: string;
  source: string | null;
  rawContentEncrypted: string | null;
  contentChars: number | null;
  contentTruncated: boolean | null;
  refusedWindowIndex: number | null;
  refusedWindowCount: number | null;
  refusedWindowStart: number | null;
  refusedWindowEnd: number | null;
  refusedWindowPositionsExact: boolean | null;
};

export type RevealedContent = {
  content: string;
  /** Characters in the stored content. */
  contentChars: number;
  /** True when only the head of a longer text was stored (a refusal for size). */
  truncated: boolean;
  /** The length of the whole text when only its head is stored. */
  originalChars: number | null;
  /**
   * How the event reached the console: "push" from rayin-guardrails, or
   * "pull" (the fallback). Shown so a reviewer can weigh where it came from.
   */
  source: "push" | "pull" | "unknown";
  /** The refused window, clipped to the stored content; null when unknown. */
  refusedWindow: {
    index: number;
    count: number;
    start: number;
    end: number;
    /** False when card masking changed the stored text's length. */
    positionsExact: boolean;
  } | null;
};

/**
 * Decrypts and shapes one event's stored content. Throws when the event has
 * none. `decryptFn` is passed in so tests need no key.
 */
export function revealContent(
  event: RevealableEvent,
  key: string,
  decryptFn: (cipherText: string, key: string) => string,
): RevealedContent {
  if (event.action !== "BLOCK" || event.rawContentEncrypted === null) {
    throw new Error("This event has no stored content.");
  }
  const content = decryptFn(event.rawContentEncrypted, key);
  const truncated = event.contentTruncated === true;
  const w = {
    index: event.refusedWindowIndex,
    count: event.refusedWindowCount,
    start: event.refusedWindowStart,
    end: event.refusedWindowEnd,
  };
  const refusedWindow =
    w.index !== null &&
    w.count !== null &&
    w.start !== null &&
    w.end !== null &&
    w.start < content.length &&
    w.end > w.start
      ? {
          index: w.index,
          count: w.count,
          start: w.start,
          end: Math.min(w.end, content.length),
          positionsExact: event.refusedWindowPositionsExact === true,
        }
      : null;
  return {
    content,
    contentChars: content.length,
    truncated,
    originalChars: truncated ? event.contentChars : null,
    source:
      event.source === "PUSH"
        ? "push"
        : event.source === "PULL"
          ? "pull"
          : "unknown",
    refusedWindow,
  };
}
