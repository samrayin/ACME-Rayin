/**
 * ACME addition (ADR-0003 §4.1, CHG-2026-008): receives the LiteLLM gateway's
 * `generic_api` logging callback (a JSON array of StandardLoggingPayload
 * records) and appends CAIRO's mirror of gateway requests.
 *
 * Auth: a dedicated bearer secret (CAIRO_LITELLM_INGEST_SECRET), compared in
 * constant time. Deliberately NOT a project API key: one gateway serves every
 * project, so no project key is the right identity -- and the project is
 * never taken from the caller anyway, it is derived from the key hash.
 *
 * Off by default: while CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED is not
 * "true" this route answers 404, as if it did not exist.
 *
 * Status codes: as configured by default, LiteLLM 1.100.1's generic_api
 * logger does not retry and drops a batch whose POST fails with ANY status
 * (verified in its source). So a batch with SOME bad records is answered 200
 * with the counts, and the good records are written: a 4xx would make the
 * gateway throw all of them away. 503 is still returned when the database is
 * unavailable, because it is the truth and a logger configured with retries
 * (CHG-2026-009 option) would act on it; today that batch is simply lost to
 * the push path and recovered by reconciliation.
 */
import { type NextApiRequest, type NextApiResponse } from "next";
import { env } from "@/src/env.mjs";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { getLitellmWriterClient } from "@/src/features/acme-enhancements/server/litellm/acmeLitellmEventWriter";
import {
  createFixedWindowLimiter,
  describeErrorForLog,
  IngestBodyError,
  ingestPushBatch,
  isAuthorizedIngestRequest,
  type KeyOwner,
} from "@/src/features/acme-enhancements/server/litellm/acmeLitellmRequestLogIngest";

// Body bound. Next.js answers 413 by itself beyond this.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// One gateway sends at most one batch every ~5 s (12/min). 240/min per pod
// leaves room for retries and a second gateway, and stops a runaway caller.
const allowRequest = createFixedWindowLimiter(240, 60_000);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (env.CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED !== "true") {
    return res.status(404).json({ message: "Not found" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }
  // Authenticate BEFORE anything else looks at the body.
  if (
    !isAuthorizedIngestRequest(
      req.headers.authorization,
      env.CAIRO_LITELLM_INGEST_SECRET,
    )
  ) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!allowRequest(Date.now())) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ message: "Rate limit exceeded" });
  }

  try {
    const result = await ingestPushBatch(req.body, {
      lookupKeyOwners: async (hashes) => {
        const keys = await prisma.acmeLitellmKey.findMany({
          where: { tokenHash: { in: hashes } },
          select: { id: true, orgId: true, projectId: true, tokenHash: true },
        });
        const owners = new Map<string, KeyOwner>();
        for (const k of keys) {
          if (k.tokenHash)
            owners.set(k.tokenHash, {
              cairoKeyId: k.id,
              orgId: k.orgId,
              projectId: k.projectId,
            });
        }
        return owners;
      },
      insertRows: async (rows) => {
        // createMany + skipDuplicates = INSERT ... ON CONFLICT DO NOTHING:
        // no RETURNING, so the INSERT-only writer role needs no SELECT.
        const written =
          await getLitellmWriterClient().acmeLitellmRequestLog.createMany({
            data: rows,
            skipDuplicates: true,
          });
        return written.count;
      },
    });

    if (result.rejected > 0) {
      // Paths and codes only -- never values. Reconciliation recovers these
      // requests from LiteLLM's spend logs and the gap count shows them.
      logger.error(
        "acmeLitellm ingest: rejected records that do not match the closed schema",
        {
          received: result.received,
          rejected: result.rejected,
          reasons: result.rejectionReasons,
        },
      );
    }
    // Every record malformed: tell the caller plainly. 422 is not retried.
    const status =
      result.received > 0 && result.rejected === result.received ? 422 : 200;
    return res.status(status).json(result);
  } catch (e) {
    if (e instanceof IngestBodyError) {
      return res.status(e.httpStatus).json({ message: e.message });
    }
    // Database unavailable or the writer is not configured: a retry can help.
    // Name and code ONLY. Never e.message: a Prisma or driver error message
    // can echo the values it was given, and nothing from a request may reach
    // a log line, not even the allow-listed columns.
    logger.error("acmeLitellm ingest failed", describeErrorForLog(e));
    return res
      .status(503)
      .json({ message: "Temporarily unable to record request logs" });
  }
}
