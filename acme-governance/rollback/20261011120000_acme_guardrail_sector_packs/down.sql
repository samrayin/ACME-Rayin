-- Rollback of 20261011120000_acme_guardrail_sector_packs (CHG-2026-151).
--   npx prisma db execute --file acme-governance/rollback/20261011120000_acme_guardrail_sector_packs/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- Drops the sectors column and its CHECK constraint, and removes the
-- migration's row from _prisma_migrations. Loses the sector selection stored
-- with each version; every version row stays, with its other columns
-- unchanged, and the audit-log entries keep each change's before and after,
-- the packs included. See ROLLBACK.md beside this file.
--
-- rayin-guardrails reads a settings version without "sectors" as all six
-- packs. So while the version in force narrows the packs, dropping the column
-- would widen the answer scope with no audited version behind it. The first
-- check refuses in that case and nothing changes: save a version with all six
-- packs in the console first (ROLLBACK.md, step 1), then run this again.
--
-- One transaction: if the check refuses, nothing changes, whichever runner
-- is used (`psql -v ON_ERROR_STOP=1 -f`, plain `psql -f`, or
-- `prisma db execute --file`). Run as the table owner, the admin login that
-- applies migrations. The append-only triggers block UPDATE, DELETE and
-- TRUNCATE, not ALTER TABLE.
BEGIN;

DO $$
DECLARE
  narrowed boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'acme_guardrail_settings'
      AND column_name = 'sectors'
  ) THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM "acme_guardrail_settings"
        WHERE "version" = (SELECT max("version") FROM "acme_guardrail_settings")
          AND NOT ("sectors" @> ARRAY['banking', 'government', 'healthcare', 'hr', 'retail_telecom', 'education']::TEXT[])
      )
    $q$ INTO narrowed;
  END IF;
  IF narrowed THEN
    RAISE EXCEPTION
      'The guardrail settings version in force does not enable all six sector packs. Without the column rayin-guardrails would apply all six with no audited version. Save a version with all six packs in the console first, then roll back.';
  END IF;
END $$;

ALTER TABLE "acme_guardrail_settings" DROP CONSTRAINT IF EXISTS "acme_guardrail_settings_sectors_check";
ALTER TABLE "acme_guardrail_settings" DROP COLUMN IF EXISTS "sectors";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261011120000_acme_guardrail_sector_packs';

COMMIT;
