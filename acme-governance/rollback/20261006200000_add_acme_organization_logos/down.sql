-- Rollback of 20261006200000_add_acme_organization_logos (CHG-2026-124).
--   npx prisma db execute --file acme-governance/rollback/20261006200000_add_acme_organization_logos/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- DATA-DESTROYING: drops every organization's uploaded logo. The customer can
-- upload it again; there is no other copy in the database. The audit-log rows
-- for each upload and removal are in audit_logs and are NOT removed.
-- Run as the table owner or admin login, after the console has been rolled
-- back to a release without the logo feature (see ROLLBACK.md).

BEGIN;

DROP TABLE "acme_organization_logos";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006200000_add_acme_organization_logos';

COMMIT;
