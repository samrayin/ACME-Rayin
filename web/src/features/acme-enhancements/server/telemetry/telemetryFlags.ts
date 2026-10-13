/**
 * ACME addition (EYEON telemetry ingest): the switches, read at request time.
 *
 * Deliberately read from `process.env` here and NOT declared in web/src/env.mjs:
 * env.mjs is an upstream file on the pending v4.50.0 sync's conflict list, and
 * four variables would add eight lines to it. These are server-only, never
 * NEXT_PUBLIC_, and they are read per request so no build step bakes them in.
 * Moving them into env.mjs is a mechanical follow-up once the sync has landed.
 *
 * Every default is the safe one: ingest off, content modes off.
 */

/** Per-key requests per minute above which the route answers 429. */
export const DEFAULT_RATE_PER_KEY_PER_MIN = 600;

type Env = Record<string, string | undefined>;

/** EYEON_TELEMETRY_INGEST_ENABLED: only the exact string "true" turns it on. */
export function telemetryIngestEnabled(env: Env = process.env): boolean {
  return env.EYEON_TELEMETRY_INGEST_ENABLED === "true";
}

/**
 * EYEON_TELEMETRY_CONTENT_MODES_ENABLED: the gate for `redacted` and `full`.
 * Read and reported, but this change implements no content mode, so even with
 * the gate on a policy value other than `metadata` is still handled as
 * `metadata` (see telemetryPolicy.ts).
 */
export function contentModesGateEnabled(env: Env = process.env): boolean {
  return env.EYEON_TELEMETRY_CONTENT_MODES_ENABLED === "true";
}

/**
 * EYEON_TELEMETRY_MAX_BODY_BYTES: may only LOWER the upstream OTLP limit, never
 * raise it. Unset, zero, negative or not a whole number: the upstream limit.
 */
export function telemetryMaxBodyBytes(
  upstreamLimit: number,
  env: Env = process.env,
): number {
  const raw = env.EYEON_TELEMETRY_MAX_BODY_BYTES;
  if (raw === undefined || !/^[0-9]{1,12}$/.test(raw)) return upstreamLimit;
  const configured = Number(raw);
  if (!Number.isSafeInteger(configured) || configured <= 0)
    return upstreamLimit;
  return Math.min(configured, upstreamLimit);
}

/** EYEON_TELEMETRY_RATE_PER_KEY_PER_MIN: a positive whole number, else 600. */
export function telemetryRatePerKeyPerMin(env: Env = process.env): number {
  const raw = env.EYEON_TELEMETRY_RATE_PER_KEY_PER_MIN;
  if (raw === undefined || !/^[0-9]{1,6}$/.test(raw)) {
    return DEFAULT_RATE_PER_KEY_PER_MIN;
  }
  const configured = Number(raw);
  return configured > 0 ? configured : DEFAULT_RATE_PER_KEY_PER_MIN;
}

/**
 * RAYIN_TELEMETRY_WRITER_DATABASE_URL: connection string for the
 * rayin_telemetry_writer role (counters only). Unset: counters are kept in
 * memory and not persisted. There is no fallback to the general connection.
 */
export function telemetryWriterDatabaseUrl(
  env: Env = process.env,
): string | undefined {
  const raw = env.RAYIN_TELEMETRY_WRITER_DATABASE_URL;
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * RAYIN_TELEMETRY_READER_DATABASE_URL: connection string for the
 * rayin_telemetry_reader role (SELECT on the key columns the ingest needs and on
 * the policy table, nothing else). Unset: the ingest answers 503. There is no
 * fallback to the console's general connection, because that is the admin login
 * until the least-privilege cutover (P0-5).
 */
export function telemetryReaderDatabaseUrl(
  env: Env = process.env,
): string | undefined {
  const raw = env.RAYIN_TELEMETRY_READER_DATABASE_URL;
  return raw && raw.length > 0 ? raw : undefined;
}
