/**
 * ACME: which rayin-guardrails buffer events the dashboard's pull path may
 * persist into acme_guardrail_events.
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
import { type Prisma } from "@langfuse/shared/src/db";

export const PULL_BACKFILL_MIN_AGE_MS = 60_000;

export type PulledGuardrailsEvent = {
  event_id?: string | null;
  time: string;
  agent_id: string;
  trace_id: string | null;
  user_id?: string | null;
  client_host?: string | null;
  direction: "input" | "output";
  policy_triggered: string | null;
  action: "allow" | "redact" | "block";
};

export function selectPullBackfillRows(
  events: PulledGuardrailsEvent[],
  projectId: string,
  now: Date,
): Prisma.AcmeGuardrailEventCreateManyInput[] {
  return events
    .filter((event) => {
      if (!event.event_id) return false;
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
      action:
        event.action === "allow"
          ? "ALLOW"
          : event.action === "redact"
            ? "REDACT"
            : "BLOCK",
      source: "PULL",
    }));
}
