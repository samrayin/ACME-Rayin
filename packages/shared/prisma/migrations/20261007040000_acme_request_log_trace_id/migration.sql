-- ACME (CHG-2026-126, ADR-0023 §3.6): each gateway request's OpenTelemetry
-- trace id, so a request on the application detail screen leads to its
-- trace. Additive: one nullable column, one CHECK constraint and one index on
-- an ACME table. No row, default or upstream table changes.
--
-- The gateway reports the id in its request log; older gateways send none,
-- so existing and future rows may stay NULL. The CHECK accepts only NULL or
-- 32 lowercase hex characters (the W3C trace-id form), whatever the writer.
--
-- Adding a nullable column without a default is a catalogue change. The
-- CHECK is verified against existing rows (all NULL) while the table is
-- locked, which is quick at today's sizes. The index is a plain CREATE INDEX,
-- not CONCURRENTLY: Prisma sends a migration's statements together, which
-- Postgres runs as one transaction block, where CONCURRENTLY is refused. On
-- a large table build the index concurrently by hand first; IF NOT EXISTS
-- then makes this migration a no-op for it.

-- AlterTable
ALTER TABLE "acme_litellm_request_logs" ADD COLUMN "otel_trace_id" TEXT;

ALTER TABLE "acme_litellm_request_logs" ADD CONSTRAINT "acme_litellm_request_logs_otel_trace_id_check" CHECK ("otel_trace_id" IS NULL OR "otel_trace_id" ~ '^[0-9a-f]{32}$');

-- Look a request up from a trace.
CREATE INDEX IF NOT EXISTS "acme_litellm_request_logs_otel_trace_id_idx" ON "acme_litellm_request_logs"("otel_trace_id");
