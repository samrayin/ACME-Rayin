/**
 * Client-side masking for RAYIN's own internal AI traces (in-app-agent,
 * evals, playground), applied via the Langfuse SDK's `mask` option before
 * input/output ever reaches the trace body that gets persisted.
 *
 * This is the free, always-available "Layer 1" masking Langfuse's own docs
 * recommend as the default (https://langfuse.com/docs/observability/features/masking)
 * -- distinct from the Enterprise-gated server-side ingestion masking, which
 * is not licensed in this deployment. It only covers traces this repo itself
 * produces as a Langfuse SDK client (see getInternalTracingHandler.ts); it
 * cannot mask traces sent by external customer applications instrumented
 * with their own Langfuse SDK -- that has to be configured in their code, not
 * here (see ACME-CHANGELOG.md's PII/data-masking resolution entry).
 *
 * Pattern-based, same entity set rayin-guardrails' Presidio config already
 * redacts (EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD, IBAN_CODE, IP_ADDRESS),
 * for one consistent PII posture across the platform. Deliberately excludes
 * PERSON -- that needs real NER, not a regex, and a coarse safety net that
 * pretends to catch names would be worse than one that's honest it doesn't.
 */

const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Every separator sits between two digits (never trailing) so a run like
// "4111 1111 1111 1111 on file" can't absorb the space before "on" into the
// match -- {12,18} extra digits after the first gives 13-19 digits total.
const CREDIT_CARD_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Loose on purpose: catches common separators (+, -, spaces, parens) across
// 7-15 digits so it doesn't miss international formats, at the cost of
// occasionally matching non-phone digit runs -- acceptable for a coarse net.
// (?<!\w) rather than a leading \b: \b never holds between two non-word
// chars (e.g. a space then "+"), which would otherwise silently strip a
// leading "+" out of the match instead of including it.
const PHONE_PATTERN = /(?<!\w)\+?\d[\d\-. ()]{6,14}\d\b/g;

function maskString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[EMAIL_REDACTED]")
    .replace(IBAN_PATTERN, "[IBAN_REDACTED]")
    .replace(CREDIT_CARD_PATTERN, "[CARD_REDACTED]")
    .replace(IPV4_PATTERN, "[IP_REDACTED]")
    .replace(PHONE_PATTERN, "[PHONE_REDACTED]");
}

const MAX_DEPTH = 20;

function maskValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item, depth + 1));
  }
  const masked: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    masked[key] = maskValue(val, depth + 1);
  }
  return masked;
}

/**
 * Langfuse SDK `mask` option: receives the raw `input`/`output` value
 * (string, object, array -- whatever was passed to the trace/generation
 * call) and must return the replacement. Deliberately does NOT catch its own
 * errors: the SDK's maskEventBodyInPlace already treats a thrown mask() as
 * "replace the field with a fully-redacted placeholder" -- a fail-closed
 * default that's the right behavior for a PII mask, and swallowing errors
 * here would silently turn that into fail-open (raw data passed through)
 * instead.
 */
export function maskPii({ data }: { data: unknown }): unknown {
  return maskValue(data, 0);
}
