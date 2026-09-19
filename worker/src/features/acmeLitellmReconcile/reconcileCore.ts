/**
 * ACME addition (ADR-0003 §4.4, CHG-2026-008): reconciliation of CAIRO's
 * request-log mirror against LiteLLM's own spend logs. Pure logic with
 * injected I/O, so it is unit-tested without LiteLLM, Redis or a database.
 *
 * Why it exists: the push path is fast but lossy by design (the gateway drops
 * events rather than block traffic). A silent gap is worse than no mirror, so
 * every pass records how many requests LiteLLM had that the mirror did not.
 *
 * Matching: a spend-log row is "present" if the mirror has its request_id OR
 * its litellm_call_id. The second key matters on cache hits, where LiteLLM
 * appends "_cache_hit<time>" to the id independently on the push path and the
 * spend-log path, so the two request_ids differ for the same request
 * (verified in the 1.100.1 source, 2026-09-19).
 *
 * Only an allow-list of metadata fields is kept. Spend logs on this gateway
 * hold no prompt or response text, and none would be copied if they did.
 */
import { z } from "zod";
import { type Prisma } from "@prisma/client";

export const PAGE_SIZE = 100;
export const MAX_PAGES_PER_RUN = 200;
/** Rows younger than this are left for the push to deliver first. */
export const SETTLE_MS = 2 * 60_000;
/** Each window starts this far before the previous one ended. */
export const OVERLAP_MS = 15 * 60_000;
/** First ever run: how far back to look. */
export const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 3_600_000;

const nstr = z.string().nullish();
const nnum = z.number().nullish();

// Lenient on purpose: this is CAIRO reading LiteLLM, and LiteLLM adds fields
// freely. Unknown fields are dropped. Strictness lives on the inbound receiver.
export const spendLogRowSchema = z.object({
  request_id: z.string().min(1),
  startTime: z.string().min(1),
  endTime: nstr,
  status: nstr,
  call_type: nstr,
  model: nstr,
  model_group: nstr,
  custom_llm_provider: nstr,
  api_key: nstr,
  team_id: nstr,
  end_user: nstr,
  requester_ip_address: nstr,
  prompt_tokens: nnum,
  completion_tokens: nnum,
  total_tokens: nnum,
  spend: nnum,
  cache_hit: z.union([z.boolean(), z.string()]).nullish(),
  metadata: z
    .object({
      litellm_call_id: nstr,
      status: nstr,
      user_api_key_alias: nstr,
      user_api_key_team_id: nstr,
      requester_ip_address: nstr,
      error_information: z.object({ error_class: nstr }).nullish(),
    })
    .nullish(),
});
export type SpendLogRow = z.infer<typeof spendLogRowSchema>;

export const spendLogsPageSchema = z.object({
  data: z.array(z.unknown()),
  total_pages: z.number().nullish(),
});

export type KeyOwner = { cairoKeyId: string; orgId: string; projectId: string };

/** LiteLLM returns timestamps without a zone; they are UTC. */
export function parseUtc(value: string): Date | null {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasZone ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatForLitellm(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const SHA256 = /^[0-9a-f]{64}$/;
const int = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;

/** The ONLY place a spend-log row becomes persisted data: an allow-list. */
export function rowFromSpendLog(
  r: SpendLogRow,
  owners: ReadonlyMap<string, KeyOwner>,
): Prisma.AcmeLitellmRequestLogCreateManyInput | null {
  const startTime = parseUtc(r.startTime);
  if (!startTime) return null;
  // The master key and internal callers are not virtual keys: no hash.
  const apiKeyHash = r.api_key && SHA256.test(r.api_key) ? r.api_key : null;
  const owner = apiKeyHash ? owners.get(apiKeyHash) : undefined;
  const cacheHit =
    typeof r.cache_hit === "boolean"
      ? r.cache_hit
      : typeof r.cache_hit === "string"
        ? r.cache_hit.toLowerCase() === "true"
        : null;
  return {
    requestId: r.request_id,
    litellmCallId: r.metadata?.litellm_call_id ?? null,
    source: "RECONCILE",
    startTime,
    endTime: r.endTime ? parseUtc(r.endTime) : null,
    status: r.status ?? r.metadata?.status ?? "unknown",
    callType: r.call_type ?? null,
    model: r.model ?? null,
    modelGroup: r.model_group ?? null,
    provider: r.custom_llm_provider ?? null,
    apiKeyHash,
    keyAlias: r.metadata?.user_api_key_alias ?? null,
    litellmTeamId: r.team_id ?? r.metadata?.user_api_key_team_id ?? null,
    endUser: r.end_user ?? null,
    requesterIp:
      r.requester_ip_address ?? r.metadata?.requester_ip_address ?? null,
    promptTokens: int(r.prompt_tokens),
    completionTokens: int(r.completion_tokens),
    totalTokens: int(r.total_tokens),
    spend: r.spend ?? null,
    cacheHit,
    errorClass: r.metadata?.error_information?.error_class ?? null,
    // Derived from CAIRO's own key table, never from LiteLLM's row.
    orgId: owner?.orgId ?? null,
    projectId: owner?.projectId ?? null,
    cairoKeyId: owner?.cairoKeyId ?? null,
  };
}

export type ReconcileDeps = {
  now: () => Date;
  /** The end of the last SUCCESSFUL run's window, or null if there is none. */
  lastSuccessfulWindowEnd: () => Promise<Date | null>;
  /** One page of LiteLLM /spend/logs/v2. Throws if LiteLLM cannot be read. */
  fetchSpendLogsPage: (p: {
    startDate: string;
    endDate: string;
    page: number;
    pageSize: number;
  }) => Promise<unknown>;
  /** Which of these ids the mirror already holds (read connection). */
  findExisting: (p: {
    requestIds: string[];
    callIds: string[];
  }) => Promise<{ requestIds: Set<string>; callIds: Set<string> }>;
  lookupKeyOwners: (hashes: string[]) => Promise<ReadonlyMap<string, KeyOwner>>;
  /** createMany + skipDuplicates through the INSERT-only writer. Returns count. */
  insertRows: (
    rows: Prisma.AcmeLitellmRequestLogCreateManyInput[],
  ) => Promise<number>;
  /** Append one run record through the INSERT-only writer. */
  recordRun: (
    run: Prisma.AcmeLitellmReconcileRunCreateManyInput,
  ) => Promise<void>;
  redact: (text: string) => string;
};

export type ReconcileOutcome = {
  status: "success" | "partial" | "failure";
  rowsChecked: number;
  gapCount: number;
  inserted: number;
  unreadableRows: number;
  windowStart: Date;
  windowEnd: Date;
};

export async function reconcileOnce(
  deps: ReconcileDeps,
): Promise<ReconcileOutcome> {
  const startedAt = deps.now();
  const windowEnd = new Date(startedAt.getTime() - SETTLE_MS);
  const last = await deps.lastSuccessfulWindowEnd();
  const windowStart = last
    ? new Date(Math.min(last.getTime() - OVERLAP_MS, windowEnd.getTime()))
    : new Date(windowEnd.getTime() - FIRST_RUN_LOOKBACK_MS);

  let rowsChecked = 0;
  let gapCount = 0;
  let inserted = 0;
  let unreadableRows = 0;
  let status: ReconcileOutcome["status"] = "success";
  let errorMessage: string | null = null;

  try {
    let page = 1;
    for (; page <= MAX_PAGES_PER_RUN; page++) {
      const raw = await deps.fetchSpendLogsPage({
        startDate: formatForLitellm(windowStart),
        endDate: formatForLitellm(windowEnd),
        page,
        pageSize: PAGE_SIZE,
      });
      const parsedPage = spendLogsPageSchema.parse(raw);
      const rows: SpendLogRow[] = [];
      for (const item of parsedPage.data) {
        const r = spendLogRowSchema.safeParse(item);
        if (r.success) rows.push(r.data);
        else unreadableRows += 1;
      }
      rowsChecked += parsedPage.data.length;

      if (rows.length > 0) {
        const callIds = rows
          .map((r) => r.metadata?.litellm_call_id)
          .filter((c): c is string => Boolean(c));
        const existing = await deps.findExisting({
          requestIds: rows.map((r) => r.request_id),
          callIds,
        });
        const missing = rows.filter(
          (r) =>
            !existing.requestIds.has(r.request_id) &&
            !(
              r.metadata?.litellm_call_id &&
              existing.callIds.has(r.metadata.litellm_call_id)
            ),
        );
        if (missing.length > 0) {
          const hashes = [
            ...new Set(
              missing
                .map((r) => r.api_key)
                .filter((h): h is string => Boolean(h && SHA256.test(h))),
            ),
          ];
          const owners =
            hashes.length > 0
              ? await deps.lookupKeyOwners(hashes)
              : new Map<string, KeyOwner>();
          const toInsert = missing
            .map((r) => rowFromSpendLog(r, owners))
            .filter(
              (r): r is Prisma.AcmeLitellmRequestLogCreateManyInput =>
                r !== null,
            );
          unreadableRows += missing.length - toInsert.length;
          gapCount += missing.length;
          inserted += await deps.insertRows(toInsert);
        }
      }

      if (parsedPage.data.length < PAGE_SIZE) break;
      if (parsedPage.total_pages && page >= parsedPage.total_pages) break;
    }
    if (page > MAX_PAGES_PER_RUN) {
      // More rows than one run may read. Say so: a "success" here would hide a gap.
      status = "partial";
      errorMessage = `window holds more than ${MAX_PAGES_PER_RUN * PAGE_SIZE} rows; not all were checked`;
    } else if (unreadableRows > 0) {
      status = "partial";
      errorMessage = `${unreadableRows} spend-log row(s) could not be read and were not mirrored`;
    }
  } catch (e) {
    status = "failure";
    errorMessage = deps
      .redact(e instanceof Error ? e.message : String(e))
      .slice(0, 500);
  }

  // The run record is what the UI shows. Written for failures too: a run that
  // could not read LiteLLM must be visible, not absent.
  await deps.recordRun({
    startedAt,
    windowStart,
    windowEnd,
    rowsChecked,
    gapCount,
    inserted,
    status,
    errorMessage,
  });

  return {
    status,
    rowsChecked,
    gapCount,
    inserted,
    unreadableRows,
    windowStart,
    windowEnd,
  };
}
