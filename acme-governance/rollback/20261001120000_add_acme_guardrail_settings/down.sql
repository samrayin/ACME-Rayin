-- Rollback of 20261001120000_add_acme_guardrail_settings (CHG-2026-089 part a).
--   npx prisma db execute --file acme-governance/rollback/20261001120000_add_acme_guardrail_settings/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- DATA-DESTROYING: drops the guardrail settings history (every version, who,
-- when and why), the pod-status table, and the settings_version and pod of
-- every guardrail event recorded since. Export first -- see ROLLBACK.md.
-- The audit-log rows for each change are in audit_logs and are NOT removed.
-- Run as the table owner or admin login. The append-only triggers block
-- UPDATE, DELETE and TRUNCATE, not DROP.

BEGIN;

DROP TRIGGER IF EXISTS acme_guardrail_settings_no_update_delete ON "acme_guardrail_settings";
DROP TRIGGER IF EXISTS acme_guardrail_settings_no_truncate ON "acme_guardrail_settings";
DROP FUNCTION IF EXISTS acme_guardrail_settings_append_only();

DROP TABLE "acme_guardrail_settings_pods";
DROP TABLE "acme_guardrail_settings";

ALTER TABLE "acme_guardrail_events" DROP COLUMN "pod";
ALTER TABLE "acme_guardrail_events" DROP COLUMN "settings_version";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261001120000_add_acme_guardrail_settings';

COMMIT;
