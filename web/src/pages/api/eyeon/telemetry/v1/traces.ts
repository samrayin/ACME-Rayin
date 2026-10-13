/**
 * ACME addition (CHG-2026-155, ADR-0006 addendum): the EYEON telemetry ingest.
 * `POST /api/eyeon/telemetry/v1/traces` receives standard OTLP/HTTP traces from a
 * server-side application, authenticated with that application's own gateway
 * key, and writes ONLY allowlisted metadata to the tracing engine (default-deny,
 * metadata mode). The pipeline is in `server/telemetry/telemetryIngest.ts`; the
 * wiring (clients, engine handoff) is in `telemetryRuntime.ts`.
 *
 * Off by default: while EYEON_TELEMETRY_INGEST_ENABLED is not exactly "true"
 * this route answers 404, as if it did not exist, and does nothing else. No
 * database client is built, no connection is opened, nothing is read or counted.
 *
 * This is NOT the engine's own OTLP route (`/api/public/otel/v1/traces`), which
 * is untouched. The body is read by the ingest itself, after authentication,
 * with its own size limits before and after gunzip, so Next's body parser is off.
 *
 * Pre-auth size and per-IP limits belong to the ingress / WAF in front of this
 * route, not to this process. That is a listed pre-real-data item: until it
 * exists the route is for synthetic data only (CHG-2026-062's rule).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { logger } from "@langfuse/shared/src/server";
import { telemetryIngestEnabled } from "@/src/features/acme-enhancements/server/telemetry/telemetryFlags";
import { handleTelemetryRequest } from "@/src/features/acme-enhancements/server/telemetry/telemetryIngest";
import {
  adaptNextRequest,
  getTelemetryRuntime,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryRuntime";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!telemetryIngestEnabled()) {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    const result = await handleTelemetryRequest(
      adaptNextRequest(req),
      getTelemetryRuntime().deps,
    );
    if (result.closeConnection) {
      // The oversize body was not fully read. Drain what remains while closing
      // this connection, as the engine's own route does.
      req.resume();
      res.setHeader("Connection", "close");
    }
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      res.setHeader(name, value);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    // The error NAME only. A driver or Prisma message can echo a connection
    // string or a value, and nothing from a request may reach a log line.
    logger.error("telemetry ingest failed", {
      errorName: error instanceof Error ? error.name : "Error",
    });
    return res
      .status(503)
      .json({ message: "Temporarily unable to accept telemetry" });
  }
}
