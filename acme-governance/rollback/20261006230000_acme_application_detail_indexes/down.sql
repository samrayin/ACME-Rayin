-- Rollback of 20261006230000_acme_application_detail_indexes (CHG-2026-125).
--   npx prisma db execute --file acme-governance/rollback/20261006230000_acme_application_detail_indexes/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- Drops the two indexes the migration created and removes its row from
-- _prisma_migrations. No data is lost: indexes hold no data of their own.
-- The application detail screen still works without them, more slowly on
-- large tables. Run as the table owner or admin login (see ROLLBACK.md).

BEGIN;

DROP INDEX IF EXISTS "acme_litellm_events_resource_id_idx";

DROP INDEX IF EXISTS "acme_litellm_request_logs_project_id_key_alias_start_time_idx";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006230000_acme_application_detail_indexes';

COMMIT;
