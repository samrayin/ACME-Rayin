/**
 * ACME addition (ADR-0003 §4, CHG-2026-008): receives the LiteLLM gateway's
 * logging callback and writes CAIRO's append-only mirror of gateway requests.
 *
 * What this module guarantees:
 *  - CLOSED SCHEMA. A record is the LiteLLM 1.100.1 StandardLoggingPayload and
 *    nothing else: an unknown field, a wrong type or an unknown status rejects
 *    THAT RECORD. It is never coerced. Rejections are counted and returned;
 *    reconciliation recovers the request from LiteLLM's spend logs, and the
 *    gap count makes the rejection visible.
 *  - METADATA ONLY. The payload also carries prompt and response text, model
 *    parameters, error messages and tracebacks (which can quote a prompt),
 *    requester headers, auth metadata and user emails. Those fields are
 *    recognised so the record validates, and then DISCARDED. Only the
 *    allow-list in `toRequestLogRow` is ever persisted.
 *  - THE PROJECT IS DERIVED, NEVER TRUSTED. It comes from matching the
 *    payload's key hash to acme_litellm_keys. Project, org and team fields in
 *    the payload are ignored. No match = stored with no project.
 *  - IDEMPOTENT on request_id via the unique index + skipDuplicates, written
 *    through the INSERT-only rayin_litellm_writer role (no SELECT needed).
 *  - FAST. Validate, one key lookup, one bulk insert. Nothing here calls
 *    LiteLLM or anything else.
 */
import { timingSafeEqual, createHash } from "crypto";
import { z } from "zod";
import { type Prisma } from "@prisma/client";

export const MAX_RECORDS_PER_REQUEST = 512; // LiteLLM's DEFAULT_BATCH_SIZE
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** Constant-time comparison of the presented bearer token with the secret. */
export function isAuthorizedIngestRequest(
  authorizationHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32) return false; // an unset or weak secret authorises nobody
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  // Hash both sides so the comparison is constant-time for any input length.
  const presented = createHash("sha256")
    .update(authorizationHeader.slice("Bearer ".length))
    .digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(presented, expected);
}

// ---------------------------------------------------------------------------
// Rate limiting: per pod, fixed window. The only legitimate caller is one
// gateway sending at most one batch every ~5 s, so this is a ceiling against
// a runaway or hostile caller, not a fairness mechanism.
// ---------------------------------------------------------------------------

export function createFixedWindowLimiter(
  maxPerWindow: number,
  windowMs: number,
) {
  let windowStart = 0;
  let count = 0;
  return function allow(nowMs: number): boolean {
    if (nowMs - windowStart >= windowMs) {
      windowStart = nowMs;
      count = 0;
    }
    count += 1;
    return count <= maxPerWindow;
  };
}

// ---------------------------------------------------------------------------
// Closed schema: LiteLLM 1.100.1 StandardLoggingPayload (read from the
// running gateway's own type definitions, 2026-09-19).
// ---------------------------------------------------------------------------

const str = z.string().max(2_000);
const nstr = str.nullish();
const nnum = z.number().nullish();
/** Present in the payload, never inspected, never stored. */
const discarded = z.unknown().optional();

const metadataSchema = z
  .object({
    user_api_key_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullish(),
    user_api_key_alias: nstr,
    user_api_key_team_id: nstr,
    user_api_key_end_user_id: nstr,
    requester_ip_address: nstr,
    // Recognised and discarded:
    user_api_key_spend: discarded,
    user_api_key_max_budget: discarded,
    user_api_key_budget_reset_at: discarded,
    user_api_key_user_spend: discarded,
    user_api_key_user_max_budget: discarded,
    user_api_key_team_spend: discarded,
    user_api_key_team_max_budget: discarded,
    user_api_key_org_id: discarded,
    user_api_key_org_alias: discarded,
    user_api_key_project_id: discarded,
    user_api_key_project_alias: discarded,
    user_api_key_user_id: discarded,
    user_api_key_user_email: discarded,
    user_api_key_team_alias: discarded,
    user_api_key_request_route: discarded,
    user_api_key_auth_metadata: discarded,
    spend_logs_metadata: discarded,
    user_agent: discarded,
    requester_metadata: discarded,
    requester_custom_headers: discarded,
    prompt_management_metadata: discarded,
    mcp_tool_call_metadata: discarded,
    vector_store_request_metadata: discarded,
    routing_decision: discarded,
    applied_guardrails: discarded,
    usage_object: discarded,
    cold_storage_object_key: discarded,
    team_alias: discarded,
    team_id: discarded,
  })
  .strict();

const errorInformationSchema = z
  .object({
    error_code: nstr,
    error_class: nstr,
    llm_provider: discarded,
    traceback: discarded, // can quote request content
    error_message: discarded, // can quote request content
    error_rate_limit_category: discarded,
    error_rate_limit_type: discarded,
    error_budget_entity_type: discarded,
    error_budget_entity_id: discarded,
    error_budget_limit: discarded,
    error_budget_spend: discarded,
  })
  .strict()
  .nullish();

// Epoch seconds. 2020-01-01 .. 2100-01-01: rejects milliseconds and junk.
const epochSeconds = z.number().min(1_577_836_800).max(4_102_444_800);

export const standardLoggingPayloadSchema = z
  .object({
    id: z.string().min(1).max(300),
    litellm_call_id: nstr,
    call_type: str,
    status: z.enum(["success", "failure"]),
    startTime: epochSeconds,
    endTime: epochSeconds,
    model: nstr,
    model_group: nstr,
    custom_llm_provider: nstr,
    total_tokens: z.number().int().min(0).nullish(),
    prompt_tokens: z.number().int().min(0).nullish(),
    completion_tokens: z.number().int().min(0).nullish(),
    response_cost: nnum,
    cache_hit: z.boolean().nullish(),
    end_user: nstr,
    requester_ip_address: nstr,
    metadata: metadataSchema,
    error_information: errorInformationSchema,
    // Recognised and discarded. `messages`, `response`, `model_parameters` and
    // `error_str` are the content fields; the rest is not needed.
    messages: discarded,
    response: discarded,
    model_parameters: discarded,
    error_str: discarded,
    trace_id: discarded,
    session_id: discarded,
    stream: discarded,
    cost_breakdown: discarded,
    autorouter_savings: discarded,
    response_cost_failure_debug_info: discarded,
    status_fields: discarded,
    completionStartTime: discarded,
    response_time: discarded,
    model_map_information: discarded,
    model_id: discarded,
    api_base: discarded,
    cache_key: discarded,
    saved_cache_cost: discarded,
    request_tags: discarded,
    request_model_access_groups: discarded,
    user_agent: discarded,
    hidden_params: discarded,
    guardrail_information: discarded,
    standard_built_in_tools_params: discarded,
  })
  .strict();

export type StandardLoggingPayload = z.infer<
  typeof standardLoggingPayloadSchema
>;

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

export type KeyOwner = { cairoKeyId: string; orgId: string; projectId: string };
export type KeyOwnerLookup = ReadonlyMap<string, KeyOwner>;

/** Fields shared by both capture paths. */
export type RequestLogFacts = {
  requestId: string;
  litellmCallId: string | null;
  startTime: Date;
  endTime: Date | null;
  status: string;
  callType: string | null;
  model: string | null;
  modelGroup: string | null;
  provider: string | null;
  apiKeyHash: string | null;
  keyAlias: string | null;
  litellmTeamId: string | null;
  endUser: string | null;
  requesterIp: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  spend: number | null;
  cacheHit: boolean | null;
  errorClass: string | null;
};

/** The ONLY place a payload becomes persisted data: an explicit allow-list. */
export function factsFromPushPayload(
  p: StandardLoggingPayload,
): RequestLogFacts {
  return {
    requestId: p.id,
    litellmCallId: p.litellm_call_id ?? null,
    startTime: new Date(p.startTime * 1000),
    endTime: new Date(p.endTime * 1000),
    status: p.status,
    callType: p.call_type,
    model: p.model ?? null,
    modelGroup: p.model_group ?? null,
    provider: p.custom_llm_provider ?? null,
    apiKeyHash: p.metadata.user_api_key_hash ?? null,
    keyAlias: p.metadata.user_api_key_alias ?? null,
    litellmTeamId: p.metadata.user_api_key_team_id ?? null,
    endUser: p.end_user ?? p.metadata.user_api_key_end_user_id ?? null,
    requesterIp:
      p.requester_ip_address ?? p.metadata.requester_ip_address ?? null,
    promptTokens: p.prompt_tokens ?? null,
    completionTokens: p.completion_tokens ?? null,
    totalTokens: p.total_tokens ?? null,
    spend: p.response_cost ?? null,
    cacheHit: p.cache_hit ?? null,
    errorClass: p.error_information?.error_class ?? null,
  };
}

export function toRequestLogRow(
  facts: RequestLogFacts,
  source: "PUSH" | "RECONCILE",
  owners: KeyOwnerLookup,
): Prisma.AcmeLitellmRequestLogCreateManyInput {
  const owner = facts.apiKeyHash ? owners.get(facts.apiKeyHash) : undefined;
  return {
    ...facts,
    source,
    // Derived from CAIRO's own key table. Absent = not a CAIRO-issued key.
    orgId: owner?.orgId ?? null,
    projectId: owner?.projectId ?? null,
    cairoKeyId: owner?.cairoKeyId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Batch ingest
// ---------------------------------------------------------------------------

export type IngestDeps = {
  /** Reads acme_litellm_keys through the general (read) connection. */
  lookupKeyOwners: (hashes: string[]) => Promise<KeyOwnerLookup>;
  /** createMany + skipDuplicates through the INSERT-only writer connection. */
  insertRows: (
    rows: Prisma.AcmeLitellmRequestLogCreateManyInput[],
  ) => Promise<number>;
};

export type IngestResult = {
  received: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  /** First few reasons, field paths only. Never field values. */
  rejectionReasons: string[];
};

/**
 * What may be logged about a failure on this path: the error's class name and,
 * if it has one, a short machine code (Prisma "P2002", Postgres "42501", Node
 * "ECONNREFUSED"). NEVER the message, the stack or the error object: all three
 * can carry request values.
 */
export function describeErrorForLog(e: unknown): {
  errorName: string;
  errorCode: string | null;
} {
  const errorName =
    e instanceof Error && /^[A-Za-z0-9_]{1,80}$/.test(e.name)
      ? e.name
      : "UnknownError";
  const rawCode =
    typeof e === "object" && e !== null
      ? (e as { code?: unknown }).code
      : undefined;
  const errorCode =
    typeof rawCode === "string" && /^[A-Za-z0-9_]{1,40}$/.test(rawCode)
      ? rawCode
      : null;
  return { errorName, errorCode };
}

export class IngestBodyError extends Error {
  constructor(
    public readonly httpStatus: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "IngestBodyError";
  }
}

export async function ingestPushBatch(
  body: unknown,
  deps: IngestDeps,
): Promise<IngestResult> {
  if (!Array.isArray(body)) {
    throw new IngestBodyError(400, "Body must be a JSON array of log records.");
  }
  if (body.length > MAX_RECORDS_PER_REQUEST) {
    throw new IngestBodyError(
      413,
      `At most ${MAX_RECORDS_PER_REQUEST} records per request.`,
    );
  }

  const valid: RequestLogFacts[] = [];
  const reasons: string[] = [];
  let rejected = 0;
  for (const record of body) {
    const parsed = standardLoggingPayloadSchema.safeParse(record);
    if (parsed.success) {
      valid.push(factsFromPushPayload(parsed.data));
    } else {
      rejected += 1;
      if (reasons.length < 5) {
        // Paths and codes only: an issue's `message` can echo a value.
        reasons.push(
          parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".") || "(record)"}: ${i.code}`)
            .join("; "),
        );
      }
    }
  }

  let inserted = 0;
  if (valid.length > 0) {
    const hashes = [
      ...new Set(
        valid.map((f) => f.apiKeyHash).filter((h): h is string => h !== null),
      ),
    ];
    const owners =
      hashes.length > 0
        ? await deps.lookupKeyOwners(hashes)
        : new Map<string, KeyOwner>();
    inserted = await deps.insertRows(
      valid.map((f) => toRequestLogRow(f, "PUSH", owners)),
    );
  }

  return {
    received: body.length,
    inserted,
    duplicates: valid.length - inserted,
    rejected,
    rejectionReasons: reasons,
  };
}
