/**
 * ACME addition (EYEON telemetry ingest, LLD section 5, step D): the filter.
 *
 * A PURE FUNCTION: decoded OTLP resource spans in, filtered spans and drop
 * counts out. No I/O, no clock, no logger. It never logs, so a value cannot
 * reach a log line from here, and it can be tested without a database.
 *
 * Default-deny. Nothing is copied through. The output is BUILT from scratch out
 * of the pieces this file decides to keep, so a field this code does not know
 * about cannot survive by being left in place.
 *
 * What is kept: ids (as fixed-length hex), times, kind, status CODE, a
 * normalised name, allowlisted attributes in their allowed shapes, and an
 * `exception` event reduced to `exception.type`. What is dropped: every other
 * attribute, every other event, all links, trace state, the status message,
 * scope attributes, resource attributes outside the allowlist.
 *
 * Ids are validated as hex of the exact length because the engine takes any
 * string id verbatim (OtelIngestionProcessor.parseId): a free-text id would be
 * stored as the id, which is a content channel that no attribute rule closes.
 */
import { createHmac } from "crypto";
import {
  COST_KEYS,
  CONTENT_KEY_HINT,
  EXCEPTION_EVENT_NAME,
  EXCEPTION_TYPE_KEY,
  EXCEPTION_TYPE_PATTERN,
  EXTRA_KEY_PATTERN,
  EXTRA_VALUE_RULE,
  MAX_ATTRIBUTES_SCANNED_PER_SPAN,
  MAX_EVENTS_SCANNED_PER_SPAN,
  MAX_EXCEPTION_EVENTS_PER_SPAN,
  MAX_EXTRA_KEYS,
  MAX_RAW_STRING_LENGTH,
  MAX_USAGE_KEYS_PER_SPAN,
  RESERVED_PREFIXES,
  RESOURCE_ATTRIBUTE_RULES,
  SCOPE_VERSION_PATTERN,
  SPAN_ATTRIBUTE_RULES,
  SPAN_KIND_NAMES,
  SPAN_NAME_PATTERN,
  SPAN_NAME_REPLACEMENT,
  STATUS_CODE_NAMES,
  USAGE_KEY_PATTERN,
  USAGE_VALUE_RULE,
  USER_ID_KEYS,
  type ValueRule,
} from "./telemetryAllowlist";

export type UserIdMode = "hash" | "drop" | "pass";

export type FilterOptions = {
  userIdMode: UserIdMode;
  /** Per-project secret for the end-user id hash. Never logged, never emitted. */
  userHashSalt: string;
  /** `attribute_allowlist_extra`: validated again here, whatever the caller did. */
  extraAllowlist: readonly string[];
};

export type OtlpAttribute = { key: string; value: Record<string, unknown> };

export type FilteredEvent = {
  name: string;
  timeUnixNano: string;
  attributes: OtlpAttribute[];
};

export type FilteredSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes: OtlpAttribute[];
  events: FilteredEvent[];
  status: { code: number };
  /** Internal: consumed by telemetryStamp, never serialised. */
  userHash?: string;
};

export type FilteredResourceSpans = {
  resource: { attributes: OtlpAttribute[] };
  scopeSpans: {
    scope: { name?: string; version?: string };
    spans: FilteredSpan[];
  }[];
};

/** Attribute drops by reason. Counts only: never a key, never a value. */
export type DropCounts = {
  notAllowlisted: number;
  reserved: number;
  cost: number;
  content: number;
  badValue: number;
  userId: number;
};

export type FilterCounts = {
  spansIn: number;
  spansOut: number;
  /** Spans dropped whole: an id or start time that is not usable. */
  spansDropped: number;
  attrsIn: number;
  attrsKept: number;
  attrsDropped: number;
  drops: DropCounts;
  eventsDropped: number;
  linksDropped: number;
  namesNormalised: number;
};

export type FilterResult = {
  resourceSpans: FilteredResourceSpans[];
  counts: FilterCounts;
};

/** The batch is not shaped like OTLP. Answered 400; never retried. */
export class MalformedTelemetryError extends Error {
  constructor(message = "Not a valid OTLP trace export") {
    super(message);
    this.name = "MalformedTelemetryError";
  }
}

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function emptyCounts(): FilterCounts {
  return {
    spansIn: 0,
    spansOut: 0,
    spansDropped: 0,
    attrsIn: 0,
    attrsKept: 0,
    attrsDropped: 0,
    drops: {
      notAllowlisted: 0,
      reserved: 0,
      cost: 0,
      content: 0,
      badValue: 0,
      userId: 0,
    },
    eventsDropped: 0,
    linksDropped: 0,
    namesNormalised: 0,
  };
}

/** Number of spans in a decoded batch, without allocating a filtered copy. */
export function countSpans(resourceSpans: unknown): number {
  if (!Array.isArray(resourceSpans)) return 0;
  let n = 0;
  for (const rs of resourceSpans) {
    if (!isRecord(rs) || !Array.isArray(rs.scopeSpans)) continue;
    for (const ss of rs.scopeSpans) {
      if (isRecord(ss) && Array.isArray(ss.spans)) n += ss.spans.length;
    }
  }
  return n;
}

/**
 * HMAC-SHA256(per-project salt, value), first 16 hex characters. DEC-2.
 * Exported so the tests (and nothing else) can compute the expected value.
 */
export function hashEndUserId(salt: string, value: string): string {
  return createHmac("sha256", salt)
    .update(value, "utf8")
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------- id and time

/** OTLP id -> lower-case hex of exactly `bytes` bytes, or undefined if unusable. */
function normaliseId(value: unknown, bytes: number): string | undefined {
  let hex: string | undefined;
  if (typeof value === "string") {
    if (value.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(value)) {
      hex = value.toLowerCase();
    }
  } else if (value instanceof Uint8Array) {
    if (value.length === bytes) hex = Buffer.from(value).toString("hex");
  } else if (Array.isArray(value)) {
    if (
      value.length === bytes &&
      value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    ) {
      hex = Buffer.from(value as number[]).toString("hex");
    }
  } else if (isRecord(value) && value.type === "Buffer") {
    return normaliseId(value.data, bytes);
  }
  if (hex === undefined || /^0+$/.test(hex)) return undefined;
  return hex;
}

/** Unix-nano timestamp as a digit string, or undefined. */
function normaliseNano(value: unknown): string | undefined {
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

// --------------------------------------------------------------------- values

function stringOf(v: unknown): string | undefined {
  if (!isRecord(v) || typeof v.stringValue !== "string") return undefined;
  return v.stringValue.length > MAX_RAW_STRING_LENGTH
    ? undefined
    : v.stringValue;
}

function numberOf(v: unknown): number | undefined {
  if (!isRecord(v)) return undefined;
  const iv = v.intValue;
  if (typeof iv === "number" && Number.isFinite(iv)) return iv;
  if (typeof iv === "string" && /^-?[0-9]{1,18}$/.test(iv)) return Number(iv);
  const dv = v.doubleValue;
  if (typeof dv === "number" && Number.isFinite(dv)) return dv;
  return undefined;
}

function stringListOf(v: unknown): string[] | undefined {
  if (!isRecord(v) || !isRecord(v.arrayValue)) return undefined;
  const values = v.arrayValue.values;
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  for (const item of values) {
    const s = stringOf(item);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

/** Apply a rule. Returns the value to emit, or undefined to drop it. */
function applyRule(
  rule: ValueRule,
  raw: unknown,
): Record<string, unknown> | undefined {
  switch (rule.kind) {
    case "string": {
      const s = stringOf(raw);
      return s !== undefined && rule.pattern.test(s)
        ? { stringValue: s }
        : undefined;
    }
    case "enum": {
      const s = stringOf(raw);
      return s !== undefined && rule.values.includes(s)
        ? { stringValue: s }
        : undefined;
    }
    case "number": {
      const n = numberOf(raw);
      if (n === undefined || n < rule.min || n > rule.max) return undefined;
      if (rule.integer && !Number.isInteger(n)) return undefined;
      return Number.isInteger(n) ? { intValue: String(n) } : { doubleValue: n };
    }
    case "stringList": {
      const list = stringListOf(raw);
      if (
        list === undefined ||
        list.length > rule.maxItems ||
        !list.every((s) => rule.pattern.test(s))
      ) {
        return undefined;
      }
      return { arrayValue: { values: list.map((s) => ({ stringValue: s })) } };
    }
  }
}

// ----------------------------------------------------------------- attributes

type DropReason = keyof DropCounts;

function classifyDrop(key: string): DropReason {
  if (COST_KEYS.has(key)) return "cost";
  if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) return "reserved";
  if (CONTENT_KEY_HINT.test(key)) return "content";
  return "notAllowlisted";
}

/** Extras the caller supplied, re-validated: never trust the policy row's shape. */
function buildExtras(extra: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of extra) {
    if (out.size >= MAX_EXTRA_KEYS) break;
    if (typeof key !== "string" || !EXTRA_KEY_PATTERN.test(key)) continue;
    if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (COST_KEYS.has(key) || CONTENT_KEY_HINT.test(key)) continue;
    if (SPAN_ATTRIBUTE_RULES.has(key) || RESOURCE_ATTRIBUTE_RULES.has(key)) {
      continue;
    }
    if (USAGE_KEY_PATTERN.test(key)) continue;
    out.add(key);
  }
  return out;
}

type AttributeContext = {
  counts: FilterCounts;
  extras: ReadonlySet<string>;
  options: FilterOptions;
};

/**
 * Filter one attribute list. `rules` is the exact-key table for this level
 * (span or resource). Returns the kept attributes and, for spans, the end-user
 * id candidate that was consumed.
 */
function filterAttributes(
  raw: unknown,
  rules: ReadonlyMap<string, ValueRule>,
  ctx: AttributeContext,
  allowUsageAndExtras: boolean,
): { kept: OtlpAttribute[]; userValue?: string } {
  const kept: OtlpAttribute[] = [];
  let userValue: string | undefined;
  if (raw === undefined || raw === null) return { kept };
  if (!Array.isArray(raw)) {
    throw new MalformedTelemetryError("attributes is not a list");
  }
  const seen = new Set<string>();
  let usageKept = 0;

  raw.forEach((entry, index) => {
    ctx.counts.attrsIn += 1;
    const drop = (reason: DropReason) => {
      ctx.counts.attrsDropped += 1;
      ctx.counts.drops[reason] += 1;
    };
    if (index >= MAX_ATTRIBUTES_SCANNED_PER_SPAN) return drop("notAllowlisted");
    if (!isRecord(entry) || typeof entry.key !== "string") {
      return drop("notAllowlisted");
    }
    const key = entry.key;
    if (key.length === 0 || key.length > 128) return drop("notAllowlisted");

    // The end-user id is consumed, never forwarded raw.
    if (allowUsageAndExtras && USER_ID_KEYS.has(key)) {
      const candidate = stringOf(entry.value);
      if (
        userValue === undefined &&
        candidate !== undefined &&
        candidate !== ""
      ) {
        userValue = candidate;
      }
      return drop("userId");
    }

    if (seen.has(key)) return drop("badValue");

    let rule: ValueRule | undefined = rules.get(key);
    if (rule === undefined && allowUsageAndExtras) {
      if (USAGE_KEY_PATTERN.test(key) && !COST_KEYS.has(key)) {
        if (usageKept >= MAX_USAGE_KEYS_PER_SPAN) return drop("badValue");
        rule = USAGE_VALUE_RULE;
      } else if (ctx.extras.has(key)) {
        rule = EXTRA_VALUE_RULE;
      }
    }
    if (rule === undefined) return drop(classifyDrop(key));

    const value = applyRule(rule, entry.value);
    if (value === undefined) return drop("badValue");

    seen.add(key);
    if (rule === USAGE_VALUE_RULE) usageKept += 1;
    ctx.counts.attrsKept += 1;
    kept.push({ key, value });
  });

  return { kept, userValue };
}

// ---------------------------------------------------------------------- spans

function normaliseName(raw: unknown, counts: FilterCounts): string {
  if (typeof raw === "string" && SPAN_NAME_PATTERN.test(raw)) return raw;
  counts.namesNormalised += 1;
  return SPAN_NAME_REPLACEMENT;
}

function normaliseKind(raw: unknown): number {
  if (
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= 0 &&
    raw <= 5
  ) {
    return raw;
  }
  if (typeof raw === "string") return SPAN_KIND_NAMES.get(raw) ?? 0;
  return 0;
}

function normaliseStatusCode(raw: unknown): number {
  const code = isRecord(raw) ? raw.code : undefined;
  if (
    typeof code === "number" &&
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 2
  ) {
    return code;
  }
  if (typeof code === "string") return STATUS_CODE_NAMES.get(code) ?? 0;
  return 0;
}

function filterEvents(
  raw: unknown,
  fallbackTime: string,
  counts: FilterCounts,
): FilteredEvent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new MalformedTelemetryError("events is not a list");
  }
  const kept: FilteredEvent[] = [];
  raw.forEach((event, index) => {
    if (
      index < MAX_EVENTS_SCANNED_PER_SPAN &&
      kept.length < MAX_EXCEPTION_EVENTS_PER_SPAN &&
      isRecord(event) &&
      event.name === EXCEPTION_EVENT_NAME
    ) {
      let type: string | undefined;
      if (Array.isArray(event.attributes)) {
        for (const a of event.attributes) {
          if (isRecord(a) && a.key === EXCEPTION_TYPE_KEY) {
            const s = stringOf(a.value);
            if (s !== undefined && EXCEPTION_TYPE_PATTERN.test(s)) type = s;
            break;
          }
        }
      }
      kept.push({
        name: EXCEPTION_EVENT_NAME,
        timeUnixNano: normaliseNano(event.timeUnixNano) ?? fallbackTime,
        attributes:
          type === undefined
            ? []
            : [{ key: EXCEPTION_TYPE_KEY, value: { stringValue: type } }],
      });
      return;
    }
    counts.eventsDropped += 1;
  });
  return kept;
}

function filterSpan(
  raw: unknown,
  ctx: AttributeContext,
): FilteredSpan | undefined {
  const { counts, options } = ctx;
  counts.spansIn += 1;
  if (!isRecord(raw)) {
    counts.spansDropped += 1;
    return undefined;
  }
  const traceId = normaliseId(raw.traceId, 16);
  const spanId = normaliseId(raw.spanId, 8);
  const start = normaliseNano(raw.startTimeUnixNano);
  if (traceId === undefined || spanId === undefined || start === undefined) {
    // Count what was inside it, so attrsIn still reconciles with the drops.
    if (Array.isArray(raw.attributes)) {
      counts.attrsIn += raw.attributes.length;
      counts.attrsDropped += raw.attributes.length;
      counts.drops.notAllowlisted += raw.attributes.length;
    }
    counts.spansDropped += 1;
    return undefined;
  }

  // Parent: absent or empty means root. Present but unusable is dropped to
  // root rather than losing the span.
  let parentSpanId: string | undefined;
  const rawParent = raw.parentSpanId;
  const emptyParent =
    rawParent === undefined ||
    rawParent === null ||
    rawParent === "" ||
    (rawParent instanceof Uint8Array && rawParent.length === 0) ||
    (Array.isArray(rawParent) && rawParent.length === 0);
  if (!emptyParent) parentSpanId = normaliseId(rawParent, 8);

  const { kept, userValue } = filterAttributes(
    raw.attributes,
    SPAN_ATTRIBUTE_RULES,
    ctx,
    true,
  );

  const span: FilteredSpan = {
    traceId,
    spanId,
    name: normaliseName(raw.name, counts),
    kind: normaliseKind(raw.kind),
    startTimeUnixNano: start,
    attributes: kept,
    events: filterEvents(raw.events, start, counts),
    status: { code: normaliseStatusCode(raw.status) },
  };
  if (parentSpanId !== undefined) span.parentSpanId = parentSpanId;
  const end = normaliseNano(raw.endTimeUnixNano);
  if (end !== undefined) span.endTimeUnixNano = end;

  if (Array.isArray(raw.links)) counts.linksDropped += raw.links.length;

  if (userValue !== undefined) {
    if (options.userIdMode === "hash") {
      span.userHash = hashEndUserId(options.userHashSalt, userValue);
    } else if (
      options.userIdMode === "pass" &&
      /^[A-Za-z0-9_.:@+-]{1,128}$/.test(userValue)
    ) {
      // Owner opt-in. Still app-asserted: eyeon.trust says so on every span.
      span.attributes.push({
        key: "user.id",
        value: { stringValue: userValue },
      });
    }
  }

  counts.spansOut += 1;
  return span;
}

/**
 * The filter. `input` is the decoded `resourceSpans` array (protobuf decoded to
 * an object, or the parsed OTLP/JSON). Throws MalformedTelemetryError when the
 * shape is not OTLP; any other throw is a filter defect and the caller drops
 * the whole batch.
 */
export function filterResourceSpans(
  input: unknown,
  options: FilterOptions,
): FilterResult {
  if (!Array.isArray(input)) throw new MalformedTelemetryError();
  const counts = emptyCounts();
  const ctx: AttributeContext = {
    counts,
    extras: buildExtras(options.extraAllowlist),
    options,
  };
  const out: FilteredResourceSpans[] = [];

  for (const rs of input) {
    if (!isRecord(rs)) throw new MalformedTelemetryError();
    const resourceAttrs = isRecord(rs.resource)
      ? filterAttributes(
          rs.resource.attributes,
          RESOURCE_ATTRIBUTE_RULES,
          ctx,
          false,
        ).kept
      : [];
    const scopes = rs.scopeSpans;
    if (scopes !== undefined && scopes !== null && !Array.isArray(scopes)) {
      throw new MalformedTelemetryError("scopeSpans is not a list");
    }
    const filteredScopes: FilteredResourceSpans["scopeSpans"] = [];
    for (const ss of scopes ?? []) {
      if (!isRecord(ss)) throw new MalformedTelemetryError();
      if (
        ss.spans !== undefined &&
        ss.spans !== null &&
        !Array.isArray(ss.spans)
      ) {
        throw new MalformedTelemetryError("spans is not a list");
      }
      const scope: { name?: string; version?: string } = {};
      if (isRecord(ss.scope)) {
        const n = ss.scope.name;
        if (typeof n === "string" && SPAN_NAME_PATTERN.test(n)) scope.name = n;
        const v = ss.scope.version;
        if (typeof v === "string" && SCOPE_VERSION_PATTERN.test(v)) {
          scope.version = v;
        }
      }
      const spans: FilteredSpan[] = [];
      for (const raw of (ss.spans as unknown[] | undefined) ?? []) {
        const span = filterSpan(raw, ctx);
        if (span !== undefined) spans.push(span);
      }
      if (spans.length > 0) filteredScopes.push({ scope, spans });
    }
    if (filteredScopes.length > 0) {
      out.push({
        resource: { attributes: resourceAttrs },
        scopeSpans: filteredScopes,
      });
    }
  }
  return { resourceSpans: out, counts };
}
