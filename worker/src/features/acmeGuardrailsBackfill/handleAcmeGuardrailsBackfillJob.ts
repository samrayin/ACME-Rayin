/**
 * ACME addition (CHG-2026-098, Ledger P0-10): drains rayin-guardrails'
 * in-memory event buffer into acme_guardrail_events on a schedule.
 *
 * Until this job, `persistPullBackfill` ran only inside two tRPC procedures
 * -- i.e. only when a human opened the Guardrails page. A decision whose
 * push had failed was therefore recovered only if somebody happened to look
 * before the 200-entry buffer rotated or the pod restarted.
 *
 * Deliberately shares `selectPullBackfillRows` with the console path rather
 * than reimplementing it: two copies of that selection logic would drift,
 * and what would drift is which audit records get written. It carries the
 * same two rules, for the same reasons -- only events with an event_id, so
 * a pull row collides with the richer push row rather than silently winning
 * the race; and only events older than PULL_BACKFILL_MIN_AGE_MS, so a push
 * that is merely still in flight is not pre-empted.
 */
import {
  logger,
  parseBufferedEvents,
  selectPullBackfillRows,
} from "@langfuse/shared/src/server";
import { prisma } from "@langfuse/shared/src/db";
import { env } from "../../env";

/** Matches the console path: the whole buffer, newest first. */
const BUFFER_FETCH_LIMIT = 200;
const FETCH_TIMEOUT_MS = 5_000;

export const handleAcmeGuardrailsBackfillJob = async () => {
  const baseUrl = env.RAYIN_GUARDRAILS_URL;
  const secret = env.RAYIN_GUARDRAILS_CONFIG_SECRET;
  const projectId = env.CAIRO_GUARDRAIL_BACKFILL_PROJECT_ID;

  // All three are required and none has a safe default. projectId in
  // particular cannot be inferred: buffer events carry no project at all.
  // The push path attributes them from the authenticated key's scope
  // (auth.scope.projectId), and a scheduled job has no key -- so it must be
  // told, and guessing would file audit records against the wrong project.
  if (!baseUrl || !secret || !projectId) {
    logger.warn(
      "[AcmeGuardrailsBackfillJob] Not configured; skipping. Needs RAYIN_GUARDRAILS_URL, RAYIN_GUARDRAILS_CONFIG_SECRET and CAIRO_GUARDRAIL_BACKFILL_PROJECT_ID.",
    );
    return { skipped: true as const };
  }

  const res = await fetch(
    `${baseUrl}/v1/events?limit=${BUFFER_FETCH_LIMIT}&include_no_verdict=true`,
    {
      headers: { "X-Config-Secret": secret },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    // Thrown, not swallowed: unlike the console path there is no user
    // waiting on a page render, so a failure here should be visible as a
    // failed job rather than a log line nobody reads.
    throw new Error(
      `rayin-guardrails returned ${res.status} fetching /v1/events`,
    );
  }

  const body = (await res.json()) as { events?: unknown };
  const { events, dropped } = parseBufferedEvents(body.events);
  if (dropped > 0) {
    logger.warn(
      `[AcmeGuardrailsBackfillJob] ${dropped} buffered event(s) this build cannot read were skipped`,
    );
  }

  const rows = selectPullBackfillRows(events, projectId, new Date());
  if (rows.length === 0) {
    return { skipped: false as const, scanned: events.length, recovered: 0 };
  }

  const written = await prisma.acmeGuardrailEvent.createMany({
    data: rows,
    skipDuplicates: true,
  });

  // `written.count` is the number of records that existed ONLY in the
  // buffer -- every one of them is a decision the durable push lost and
  // this job recovered. A non-zero count here is not routine: it is the
  // P0-10 failure happening, and is worth an alert once one exists.
  if (written.count > 0) {
    logger.warn(
      `[AcmeGuardrailsBackfillJob] Recovered ${written.count} guardrail decision(s) whose push had failed`,
      { projectId, scanned: events.length, candidates: rows.length },
    );
  }

  return {
    skipped: false as const,
    scanned: events.length,
    recovered: written.count,
  };
};
