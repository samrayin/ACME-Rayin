-- Rollback of 20261007040000_acme_request_log_trace_id (CHG-2026-126).
--   npx prisma db execute --file acme-governance/rollback/20261007040000_acme_request_log_trace_id/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- Loses the recorded trace ids only: every request log row stays, with every
-- other column unchanged. The gateway hook keeps writing the id into its
-- request log, where the console ignores it again. Run as the table owner or
-- admin login, after the console is back on a release without the column.

BEGIN;

DROP INDEX IF EXISTS "acme_litellm_request_logs_otel_trace_id_idx";
ALTER TABLE "acme_litellm_request_logs" DROP CONSTRAINT IF EXISTS "acme_litellm_request_logs_otel_trace_id_check";
ALTER TABLE "acme_litellm_request_logs" DROP COLUMN IF EXISTS "otel_trace_id";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261007040000_acme_request_log_trace_id';

COMMIT;
