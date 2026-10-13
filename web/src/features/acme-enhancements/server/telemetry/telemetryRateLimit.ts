/**
 * ACME addition (EYEON telemetry ingest, LLD section 5, step C): a per-key
 * fixed-window limiter.
 *
 * In memory, per pod: a console running N replicas allows up to N times the
 * configured rate in total for one key. That is stated, not hidden, and it is
 * enough to stop a runaway or hostile caller from filling the queue. It is a
 * separate budget from the key's LLM requests-per-minute: telemetry traffic
 * never consumes the key's model-call limit, because it never reaches the
 * gateway.
 */
export type RateDecision = { allowed: boolean; retryAfterSec: number };

export function createKeyedRateLimiter(
  limitPerWindow: number,
  windowMs = 60_000,
  maxKeys = 10_000,
) {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    check(key: string, nowMs: number): RateDecision {
      let w = windows.get(key);
      if (w === undefined || nowMs - w.start >= windowMs) {
        w = { start: nowMs, count: 0 };
        windows.delete(key);
        windows.set(key, w);
        while (windows.size > maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
      }
      if (w.count >= limitPerWindow) {
        const remainingMs = Math.max(0, w.start + windowMs - nowMs);
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)),
        };
      }
      w.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}
