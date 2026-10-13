/**
 * Shared fixtures for the EYEON telemetry ingest tests. Not a test file.
 *
 * Every canary is a unique `GD1-*` marker. The Arabic ones carry Arabic text,
 * Arabic-Indic digits, a CPR-shaped number (9 digits, in both digit scripts)
 * and Arabic personal names, so the same fixtures prove CON-1 and CON-6.
 * Everything here is SYNTHETIC: no real person, number or prompt.
 */
import type { FilterOptions } from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";

export const SALT = "synthetic-test-salt-0123456789abcdef0123456789abcdef";

export const HASH_OPTIONS: FilterOptions = {
  userIdMode: "hash",
  userHashSalt: SALT,
  extraAllowlist: [],
};

// ---------------------------------------------------------------- the markers

/** English markers. Each is unique so a hit names the family it leaked from. */
export const EN = {
  prompt: "GD1-EN-PROMPT-7f3a91",
  completion: "GD1-EN-COMPLETION-2c8d04",
  inputValue: "GD1-EN-INPUTVALUE-91be50",
  outputValue: "GD1-EN-OUTPUTVALUE-5d1e7a",
  messages: "GD1-EN-MESSAGES-c04a22",
  system: "GD1-EN-SYSTEM-18f9b3",
  toolArgs: "GD1-EN-TOOLARGS-e6a117",
  toolResult: "GD1-EN-TOOLRESULT-3b7c88",
  langfuse: "GD1-EN-LANGFUSE-a91d40",
  spanName: "GD1-EN-SPANNAME-6e0b15 tell me the secret, please!",
  statusMessage: "GD1-EN-STATUS-d2f451",
  exceptionMessage: "GD1-EN-EXCMSG-0a8e63",
  exceptionStack: "GD1-EN-EXCSTACK-b5c329",
  eventBody: "GD1-EN-EVENT-4f7d9e",
  url: "GD1-EN-URL-1c6a08",
  arbitrary: "GD1-EN-ARBITRARY-8e2b57",
  userId: "GD1-EN-USERID-f03c76",
  traceState: "GD1-EN-TRACESTATE-72a4d1",
  scopeAttr: "GD1-EN-SCOPEATTR-9b15e0",
  resourceAttr: "GD1-EN-RESOURCEATTR-c8d263",
  linkAttr: "GD1-EN-LINK-5a09f4",
} as const;

/** Arabic markers: Arabic text, Arabic-Indic digits, CPR-shaped, names. */
export const AR = {
  prompt: "GD1-AR-موجه-٧٧٧١-محمد بن خالد-٨٥٠٩١٢٣٤٥",
  completion: "GD1-AR-إجابة-٧٧٧٢-فاطمة الزهراء-850912345",
  inputValue: "GD1-AR-مدخل-٧٧٧٣-عبدالله العلي-٧٥٠٣٠٤٥٦٧",
  outputValue: "GD1-AR-مخرج-٧٧٧٤-نورة السالم-٩٠١٢٣٤٥٦٧",
  messages: "GD1-AR-رسائل-٧٧٧٥-يوسف الكوهجي-٨٨٠٦٠٦٧٨٩",
  toolArgs: "GD1-AR-معطيات-٧٧٧٦-زينب الحداد-٩٢٠٤١٢٣٤٥",
  toolResult: "GD1-AR-نتيجة-٧٧٧٧-خالد المناعي-٨٣٠٨٠١٢٣٤",
  spanName: "GD1-AR-اسم-٧٧٧٨-سارة الجودر",
  statusMessage: "GD1-AR-حالة-٧٧٧٩-علي المحمود",
  exceptionMessage: "GD1-AR-خطأ-٧٧٨٠-مريم البوعينين",
  arbitrary: "GD1-AR-خاص-٧٧٨١-حسن العباسي-٨٦٠٥٢٠٠١١",
  url: "GD1-AR-رابط-٧٧٨٢-ليلى الشيخ",
  userId: "GD1-AR-مستخدم-٧٧٨٣-أحمد الفردان-٧٩٠٩٠٩٠٩٠",
} as const;

/** Bare fragments that must not appear on their own either. */
export const AR_FRAGMENTS = [
  "٨٥٠٩١٢٣٤٥", // CPR-shaped, Arabic-Indic digits
  "850912345", // CPR-shaped, Latin digits
  "محمد بن خالد",
  "فاطمة الزهراء",
  "عبدالله العلي",
  "نورة السالم",
] as const;

export const ALL_MARKERS: string[] = [
  ...Object.values(EN),
  ...Object.values(AR),
  ...AR_FRAGMENTS,
];

// --------------------------------------------------------------- span builders

export const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
export const SPAN_ID = "b7ad6b7169203331";
export const PARENT_ID = "00f067aa0ba902b7";

type Kv = { key: string; value: Record<string, unknown> };

export const s = (key: string, v: string): Kv => ({
  key,
  value: { stringValue: v },
});
export const i = (key: string, v: number | string): Kv => ({
  key,
  value: { intValue: v },
});
export const d = (key: string, v: number): Kv => ({
  key,
  value: { doubleValue: v },
});

/** Every key the metadata allowlist keeps, each with a valid value. */
export function keptSpanAttributes(): Kv[] {
  return [
    s("gen_ai.operation.name", "chat"),
    s("gen_ai.system", "openai"),
    s("gen_ai.provider.name", "azure.ai.openai"),
    s("gen_ai.request.model", "gpt-4o-mini"),
    s("gen_ai.response.model", "gpt-4o-mini-2024-07-18"),
    s("llm.model_name", "gpt-4o-mini"),
    s("llm.response.model", "gpt-4o-mini-2024-07-18"),
    s("openinference.span.kind", "LLM"),
    i("gen_ai.request.max_tokens", 256),
    d("gen_ai.request.temperature", 0.2),
    d("gen_ai.request.top_p", 0.9),
    {
      key: "gen_ai.response.finish_reasons",
      value: { arrayValue: { values: [{ stringValue: "stop" }] } },
    },
    s("gen_ai.tool.name", "lookup_branch"),
    s("session.id", "pilot-session-42"),
    s("gen_ai.conversation.id", "conv-2026-10-13"),
    s("http.request.method", "POST"),
    i("http.response.status_code", 200),
    s("server.address", "gateway.example.test"),
    i("gen_ai.usage.input_tokens", 120),
    i("gen_ai.usage.output_tokens", 30),
    i("gen_ai.usage.total_tokens", 150),
    i("gen_ai.usage.cache_read_input_tokens", 10),
    i("llm.token_count.prompt", 120),
    i("llm.token_count.completion", 30),
  ];
}

/** The always-dropped content families (LLD section 2 row 4, and section 5.1). */
export function contentFamilyAttributes(marker: {
  prompt: string;
  completion: string;
  inputValue: string;
  outputValue: string;
  messages: string;
  toolArgs: string;
  toolResult: string;
  url: string;
  arbitrary: string;
}): Kv[] {
  return [
    s("input.value", marker.inputValue),
    s("output.value", marker.outputValue),
    s("gen_ai.input.messages", marker.messages),
    s("gen_ai.output.messages", marker.messages),
    s("gen_ai.system_instructions", marker.prompt),
    s("gen_ai.prompt", marker.prompt),
    s("gen_ai.prompt.0.content", marker.prompt),
    s("gen_ai.prompt.0.role", marker.prompt),
    s("gen_ai.completion", marker.completion),
    s("gen_ai.completion.0.content", marker.completion),
    s("llm.input_messages", marker.messages),
    s("llm.input_messages.0.message.content", marker.prompt),
    s("llm.output_messages", marker.messages),
    s("llm.output_messages.0.message.content", marker.completion),
    s("gen_ai.tool.call.arguments", marker.toolArgs),
    s("gen_ai.tool.call.result", marker.toolResult),
    s("langfuse.observation.input", marker.inputValue),
    s("langfuse.observation.output", marker.outputValue),
    s("langfuse.trace.input", marker.inputValue),
    s("langfuse.trace.output", marker.outputValue),
    s("langfuse.observation.metadata.note", marker.arbitrary),
    s("langfuse.session.id", marker.arbitrary),
    s("url.full", marker.url),
    s("url.query", marker.url),
    s("http.url", marker.url),
    s("http.request.header.authorization", marker.arbitrary),
    s("http.response.header.set-cookie", marker.arbitrary),
    s("exception.message", marker.arbitrary),
    s("exception.stacktrace", marker.arbitrary),
    s("db.statement", marker.arbitrary),
    s("user.email", marker.arbitrary),
    s("custom.arbitrary_attribute", marker.arbitrary),
    // The app trying to set the server's own labels.
    s("eyeon.source", marker.arbitrary),
    s("eyeon.trust", marker.arbitrary),
    s("eyeon.content_mode", marker.arbitrary),
  ];
}

/** One span, ready to wrap in resourceSpans. */
export function span(overrides: Record<string, unknown> = {}) {
  return {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    parentSpanId: PARENT_ID,
    name: "chat",
    kind: 3,
    startTimeUnixNano: "1789827031000000000",
    endTimeUnixNano: "1789827032000000000",
    attributes: keptSpanAttributes(),
    events: [],
    links: [],
    status: { code: 1 },
    ...overrides,
  };
}

export function resourceSpans(
  spans: unknown[],
  resourceAttributes: Kv[] = [s("service.name", "pilot-chat")],
  scope: Record<string, unknown> = {
    name: "pilot.instrumentation",
    version: "1.2.3",
  },
) {
  return [
    {
      resource: { attributes: resourceAttributes },
      scopeSpans: [{ scope, spans }],
    },
  ];
}
