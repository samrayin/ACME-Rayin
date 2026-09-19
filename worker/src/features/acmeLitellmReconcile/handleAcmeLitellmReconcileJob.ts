/**
 * ACME addition (ADR-0003 §4.4, CHG-2026-008): wires reconcileCore to the real
 * LiteLLM gateway and database. Same isolation rule as the web receiver: rows
 * are written ONLY through a separate PrismaClient bound to
 * RAYIN_LITELLM_WRITER_DATABASE_URL (the INSERT-only rayin_litellm_writer
 * role), and the code refuses to fall back to the general connection.
 */
import { PrismaClient } from "@prisma/client";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { env } from "../../env";
import { reconcileOnce, type KeyOwner } from "./reconcileCore";

let writerClient: PrismaClient | null = null;

function getWriterClient(): PrismaClient {
  if (!env.RAYIN_LITELLM_WRITER_DATABASE_URL) {
    throw new Error(
      "RAYIN_LITELLM_WRITER_DATABASE_URL is not configured -- refusing to fall " +
        "back to the general database connection for the append-only LiteLLM record.",
    );
  }
  if (writerClient === null) {
    writerClient = new PrismaClient({
      datasourceUrl: env.RAYIN_LITELLM_WRITER_DATABASE_URL,
    });
  }
  return writerClient;
}

function redact(text: string): string {
  const masterKey = env.LITELLM_MASTER_KEY;
  const withoutMaster =
    masterKey && masterKey.length > 0
      ? text.split(masterKey).join("[REDACTED]")
      : text;
  return withoutMaster.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[REDACTED]");
}

export async function handleAcmeLitellmReconcileJob() {
  if (env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED !== "true") {
    return { skipped: "CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED is off" };
  }
  const baseUrl = env.LITELLM_BASE_URL?.replace(/\/+$/, "");
  const masterKey = env.LITELLM_MASTER_KEY;
  if (!baseUrl || !masterKey) {
    logger.error(
      "[AcmeLitellmReconcileJob] LITELLM_BASE_URL / LITELLM_MASTER_KEY are not set; nothing reconciled",
    );
    return { skipped: "LiteLLM is not configured" };
  }
  const writer = getWriterClient();

  const outcome = await reconcileOnce({
    now: () => new Date(),
    redact,
    lastSuccessfulWindowEnd: async () => {
      const last = await prisma.acmeLitellmReconcileRun.findFirst({
        where: { status: "success" },
        orderBy: { finishedAt: "desc" },
        select: { windowEnd: true },
      });
      return last?.windowEnd ?? null;
    },
    fetchSpendLogsPage: async ({ startDate, endDate, page, pageSize }) => {
      const url = new URL(`${baseUrl}/spend/logs/v2`);
      url.searchParams.set("start_date", startDate);
      url.searchParams.set("end_date", endDate);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(pageSize));
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(`LiteLLM returned ${res.status} for /spend/logs/v2`);
      }
      return res.json();
    },
    findExisting: async ({ requestIds, callIds }) => {
      const rows = await prisma.acmeLitellmRequestLog.findMany({
        where: {
          OR: [
            { requestId: { in: requestIds } },
            ...(callIds.length > 0 ? [{ litellmCallId: { in: callIds } }] : []),
          ],
        },
        select: { requestId: true, litellmCallId: true },
      });
      return {
        requestIds: new Set(rows.map((r) => r.requestId)),
        callIds: new Set(
          rows
            .map((r) => r.litellmCallId)
            .filter((c): c is string => c !== null),
        ),
      };
    },
    lookupKeyOwners: async (hashes) => {
      const keys = await prisma.acmeLitellmKey.findMany({
        where: { tokenHash: { in: hashes } },
        select: { id: true, orgId: true, projectId: true, tokenHash: true },
      });
      const owners = new Map<string, KeyOwner>();
      for (const k of keys) {
        if (k.tokenHash) {
          owners.set(k.tokenHash, {
            cairoKeyId: k.id,
            orgId: k.orgId,
            projectId: k.projectId,
          });
        }
      }
      return owners;
    },
    insertRows: async (rows) => {
      if (rows.length === 0) return 0;
      // createMany, not create: no RETURNING, so the writer needs no SELECT.
      const written = await writer.acmeLitellmRequestLog.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return written.count;
    },
    recordRun: async (run) => {
      await writer.acmeLitellmReconcileRun.createMany({ data: [run] });
    },
  });

  const summary = {
    status: outcome.status,
    rowsChecked: outcome.rowsChecked,
    gapCount: outcome.gapCount,
    inserted: outcome.inserted,
    unreadableRows: outcome.unreadableRows,
  };
  if (outcome.status === "success" && outcome.gapCount === 0) {
    logger.info("[AcmeLitellmReconcileJob] finished", summary);
  } else {
    logger.warn(
      "[AcmeLitellmReconcileJob] finished with a gap or a problem",
      summary,
    );
  }
  return outcome;
}
