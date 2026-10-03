/**
 * ACME: which rayin-guardrails buffer events the pull path may persist into
 * acme_guardrail_events.
 *
 * Moved from web/ to shared/ under CHG-2026-098 so the worker's scheduled
 * backfill and the console's on-page pull apply exactly the same rules. Two
 * copies of this selection logic would drift, and the thing that would drift
 * is which audit records get written.
 *
 * The pull path (acmeGuardrailsRouter.recentEvents) predates the durable
 * push and is now only a fallback for events whose push failed. It carries
 * metadata only -- no redacted text, findings or encrypted content -- so it
 * must never win a race against the push for the same event: the unique
 * indexes plus skipDuplicates keep whichever row lands first, and a pull row
 * landing first would silently discard the richer push row.
 *
 * Two rules close that:
 *  - Only events carrying an event_id are persisted, so pull and push rows
 *    for the same event collide on event_id (not just on the coarser
 *    composite key), including when they would be filed under different
 *    projects.
 *  - Only events older than PULL_BACKFILL_MIN_AGE_MS are persisted. A push
 *    has finished -- succeeded or given up -- well inside that window
 *    (rayin_push.py: 3 attempts x 5 s timeout, plus 0.5 s and 2 s backoff,
 *    ~17.5 s worst case), so by then pull is only ever filling a real gap.
 */
import { z } from "zod";
import { type Prisma } from "../../db";

export const PULL_BACKFILL_MIN_AGE_MS = 60_000;

// event_id, user_id and client_host are optional: older rayin-guardrails
// builds don't include them in the buffer. Kept (not stripped) so pull rows
// dedupe against push rows on event_id.
const PulledGuardrailsEventSchema = z.object({
  event_id: z.string().nullish(),
  user_id: z.string().nullish(),
  client_host: z.string().nullish(),
  time: z.string(),
  agent_id: z.string(),
  trace_id: z.string().nullable(),
  direction: z.enum(["input", "output"]),
  policy_triggered: z.string().nullable(),
  action: z.enum(["allow", "redact", "block", "unavailable"]),
});

/**
 * The buffer's events, each checked on its own (security review P2-269-1):
 * one event this build cannot read (an unknown action from a newer
 * rayin-guardrails, say) is dropped and counted, and never stops the others
 * from being backfilled.
 */
export function parseBufferedEvents(raw: unknown): {
  events: PulledGuardrailsEvent[];
  dropped: number;
} {
  const list = Array.isArray(raw) ? raw : [];
  const events: PulledGuardrailsEvent[] = [];
  let dropped = 0;
  for (const item of list) {
    const parsed = PulledGuardrailsEventSchema.safeParse(item);
    if (parsed.success) events.push(parsed.data);
    else dropped += 1;
  }
  return { events, dropped };
}

export type PulledGuardrailsEvent = {
  event_id?: string | null;
  time: string;
  agent_id: string;
  trace_id: string | null;
  user_id?: string | null;
  client_host?: string | null;
  direction: "input" | "output";
  policy_triggered: string | null;
  action: "allow" | "redact" | "block" | "unavailable";
};

const PULLED_ACTION_TO_DB: Record<
  string,
  "ALLOW" | "REDACT" | "BLOCK" | "UNAVAILABLE"
> = {
  allow: "ALLOW",
  redact: "REDACT",
  block: "BLOCK",
  unavailable: "UNAVAILABLE",
};

export function selectPullBackfillRows(
  events: PulledGuardrailsEvent[],
  projectId: string,
  now: Date,
): Prisma.AcmeGuardrailEventCreateManyInput[] {
  return events
    .filter((event) => {
      if (!event.event_id) return false;
      // An action this build does not know is skipped, never stored as
      // something else (an older build stored every unknown action as a
      // block).
      if (!Object.hasOwn(PULLED_ACTION_TO_DB, event.action)) return false;
      const eventTime = new Date(event.time).getTime();
      if (Number.isNaN(eventTime)) return false;
      return now.getTime() - eventTime >= PULL_BACKFILL_MIN_AGE_MS;
    })
    .map((event) => ({
      projectId,
      eventId: event.event_id,
      eventTime: new Date(event.time),
      agentId: event.agent_id,
      traceId: event.trace_id,
      userId: event.user_id ?? null,
      clientHost: event.client_host ?? null,
      direction: event.direction === "input" ? "INPUT" : "OUTPUT",
      policyTriggered: event.policy_triggered,
      action: PULLED_ACTION_TO_DB[event.action],
      source: "PULL",
    }));
}
