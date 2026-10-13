/**
 * ACME addition (EYEON telemetry ingest): the metadata-mode allowlist.
 *
 * DEFAULT-DENY. An attribute is kept only if its exact key is listed here (or
 * matches one of the two usage prefix rules), AND its value has the shape its
 * rule allows. Everything else is dropped and counted, never logged.
 *
 * Why shapes and not just names: the engine stores some attribute values and
 * ALL attribute keys it keeps, so a listed key is still a channel. Each rule
 * bounds the value (a short ASCII charset or a number), which also means Arabic
 * text and free prose cannot ride on a listed key. A bound is not a guarantee:
 * a listed string key is an app-asserted label, and a short ASCII string that
 * fits the rule will be kept. The ingest stamps `eyeon.trust = asserted` for
 * that reason.
 *
 * Bump ALLOWLIST_VERSION on ANY change in this file. It is stamped on every
 * span (`eyeon.allowlist_version`), and a change needs a change record.
 */
export const ALLOWLIST_VERSION = "2026-10-13.1";

export type ValueRule =
  | { kind: "string"; pattern: RegExp }
  | { kind: "number"; min: number; max: number; integer: boolean }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "stringList"; pattern: RegExp; maxItems: number };

const ident = (max: number): ValueRule => ({
  kind: "string",
  pattern: new RegExp(`^[A-Za-z0-9_.-]{1,${max}}$`),
});

const modelName: ValueRule = {
  kind: "string",
  pattern: /^[A-Za-z0-9_.:/@+-]{1,128}$/,
};

const label: ValueRule = {
  kind: "string",
  pattern: /^[A-Za-z0-9_.:/@+ -]{1,128}$/,
};

/** LLD 5.1, span attributes. Exact keys. */
export const SPAN_ATTRIBUTE_RULES: ReadonlyMap<string, ValueRule> = new Map<
  string,
  ValueRule
>([
  // Operation and model.
  ["gen_ai.operation.name", ident(64)],
  ["gen_ai.system", ident(64)],
  ["gen_ai.provider.name", ident(64)],
  ["gen_ai.request.model", modelName],
  ["gen_ai.response.model", modelName],
  ["llm.model_name", modelName],
  ["llm.response.model", modelName],
  [
    "openinference.span.kind",
    {
      kind: "enum",
      values: [
        "LLM",
        "CHAIN",
        "TOOL",
        "AGENT",
        "EMBEDDING",
        "RETRIEVER",
        "RERANKER",
        "GUARDRAIL",
        "EVALUATOR",
        "PROMPT",
        "UNKNOWN",
      ],
    },
  ],
  // Request parameters.
  [
    "gen_ai.request.max_tokens",
    { kind: "number", min: 0, max: 10_000_000, integer: true },
  ],
  [
    "gen_ai.request.temperature",
    { kind: "number", min: 0, max: 10, integer: false },
  ],
  ["gen_ai.request.top_p", { kind: "number", min: 0, max: 1, integer: false }],
  [
    "gen_ai.response.finish_reasons",
    { kind: "stringList", pattern: /^[A-Za-z0-9_.-]{1,32}$/, maxItems: 8 },
  ],
  // Tool: the name only. Arguments and results are never listed.
  ["gen_ai.tool.name", { kind: "string", pattern: /^[A-Za-z0-9_.:/-]{1,64}$/ }],
  // Grouping.
  ["session.id", { kind: "string", pattern: /^[A-Za-z0-9_.:-]{1,64}$/ }],
  [
    "gen_ai.conversation.id",
    { kind: "string", pattern: /^[A-Za-z0-9_.:-]{1,64}$/ },
  ],
  // HTTP. Never the URL, query string or headers.
  ["http.request.method", { kind: "string", pattern: /^[A-Z]{1,16}$/ }],
  [
    "http.response.status_code",
    { kind: "number", min: 100, max: 599, integer: true },
  ],
  ["server.address", { kind: "string", pattern: /^[A-Za-z0-9_.:-]{1,253}$/ }],
]);

/** LLD 5.1, resource attributes. Exact keys. */
export const RESOURCE_ATTRIBUTE_RULES: ReadonlyMap<string, ValueRule> = new Map<
  string,
  ValueRule
>([
  ["service.name", label],
  ["service.version", label],
  ["deployment.environment", label],
  ["deployment.environment.name", label],
]);

/**
 * Usage prefix rules (amended after SP-4a): `gen_ai.usage.*` except
 * `gen_ai.usage.cost`, and `llm.token_count.*`. NUMERIC VALUES ONLY. The suffix
 * is bounded to a short snake_case token because the KEY is kept by the engine
 * (it becomes a usage type name), so it is a channel exactly like a value.
 */
export const USAGE_KEY_PATTERN =
  /^(?:gen_ai\.usage|llm\.token_count)\.[a-z0-9_.]{1,48}$/;
export const USAGE_VALUE_RULE: ValueRule = {
  kind: "number",
  min: 0,
  max: 1e12,
  integer: false,
};
/** Cap on kept usage keys per span (the engine reads a handful). */
export const MAX_USAGE_KEYS_PER_SPAN = 16;

/** Cost, whoever sends it, is dropped (DEC-8): the gateway's spend is the only source. */
export const COST_KEYS: ReadonlySet<string> = new Set([
  "gen_ai.usage.cost",
  "llm.cost.total",
  "langfuse.observation.cost_details",
]);

/** Keys the app may never set: server-stamped or engine-reserved. */
export const RESERVED_PREFIXES: readonly string[] = [
  "langfuse.",
  "eyeon.",
  "user.",
];

/** The two keys the end-user id rule consumes. */
export const USER_ID_KEYS: ReadonlySet<string> = new Set([
  "user.id",
  "langfuse.user.id",
]);

/**
 * Only used to NAME a drop reason in the counters and to refuse a per-project
 * extra that looks like content. It is not the mechanism: the mechanism is
 * default-deny above.
 */
export const CONTENT_KEY_HINT =
  /(?:^|[._])(?:input|output|message|messages|prompt|completion|content|argument|arguments|result|results|body|text|query|instruction|instructions|choice|response_body|request_body)(?:$|[._])/i;

/** Per-project extras (`attribute_allowlist_extra`): key and value bounds. */
export const EXTRA_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
export const EXTRA_VALUE_RULE: ValueRule = label;
export const MAX_EXTRA_KEYS = 32;

/** Exception events are reduced to this one attribute. */
export const EXCEPTION_EVENT_NAME = "exception";
export const EXCEPTION_TYPE_KEY = "exception.type";
export const EXCEPTION_TYPE_PATTERN = /^[A-Za-z0-9_.:$]{1,128}$/;
export const MAX_EXCEPTION_EVENTS_PER_SPAN = 3;

/** Span name: kept only if it fits, else replaced (LLD 5.1). */
export const SPAN_NAME_PATTERN = /^[A-Za-z0-9_.:/ -]{1,64}$/;
export const SPAN_NAME_REPLACEMENT = "span";

/** Instrumentation scope: name and version only, same style of bound. */
export const SCOPE_VERSION_PATTERN = /^[A-Za-z0-9_.+-]{1,32}$/;

/** Bounds applied while scanning, so a hostile body cannot burn CPU. */
export const MAX_ATTRIBUTES_SCANNED_PER_SPAN = 256;
export const MAX_EVENTS_SCANNED_PER_SPAN = 64;
export const MAX_RAW_STRING_LENGTH = 512;
export const MAX_SPANS_PER_BATCH = 5000;

export const SPAN_KIND_NAMES: ReadonlyMap<string, number> = new Map([
  ["SPAN_KIND_UNSPECIFIED", 0],
  ["SPAN_KIND_INTERNAL", 1],
  ["SPAN_KIND_SERVER", 2],
  ["SPAN_KIND_CLIENT", 3],
  ["SPAN_KIND_PRODUCER", 4],
  ["SPAN_KIND_CONSUMER", 5],
]);

export const STATUS_CODE_NAMES: ReadonlyMap<string, number> = new Map([
  ["STATUS_CODE_UNSET", 0],
  ["STATUS_CODE_OK", 1],
  ["STATUS_CODE_ERROR", 2],
]);
