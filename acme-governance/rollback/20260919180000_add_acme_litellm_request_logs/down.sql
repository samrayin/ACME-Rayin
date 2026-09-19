-- Rollback of 20260919180000_add_acme_litellm_request_logs (CHG-2026-008).
--   npx prisma db execute --file acme-governance/rollback/20260919180000_add_acme_litellm_request_logs/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- DATA-DESTROYING: drops the request-log mirror and the reconcile history.
-- Export first -- see ROLLBACK.md. LiteLLM's own spend logs are untouched.
-- Run as the table owner / admin login. Leaves the two roles in place: they
-- belong to 20260919120000_add_acme_litellm_management.

BEGIN;

DROP TABLE "acme_litellm_reconcile_runs";
DROP TABLE "acme_litellm_request_logs";
DROP TYPE "AcmeLitellmRequestLogSource";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260919180000_add_acme_litellm_request_logs';

COMMIT;
