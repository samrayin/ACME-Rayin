-- Rollback of 20260919120000_add_acme_litellm_management (CHG-2026-005).
-- Run with:
--   npx prisma db execute --file acme-governance/rollback/20260919120000_add_acme_litellm_management/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- DATA-DESTROYING: drops acme_litellm_events, the append-only record of
-- every gateway management action. Export it first -- see ROLLBACK.md.
-- The virtual keys themselves live in LiteLLM and keep working.
--
-- Must run as the table owner / admin login (the runtime role cannot DROP).

BEGIN;

-- Order guard: CHG-2026-008's tables are written by the same writer role.
-- Roll that migration back first, or this script would strip its grants.
DO $$
BEGIN
  IF to_regclass('public.acme_litellm_request_logs') IS NOT NULL
     OR to_regclass('public.acme_litellm_reconcile_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'Roll back the CHG-2026-008 migration (add_acme_litellm_request_logs) before this one.';
  END IF;
END
$$;

-- Part 2 in reverse: grants, then roles.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_litellm_retention_purger') THEN
    REVOKE ALL ON "acme_litellm_events" FROM rayin_litellm_retention_purger;
    REVOKE USAGE ON SCHEMA public FROM rayin_litellm_retention_purger;
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM rayin_litellm_retention_purger', current_database());
    DROP ROLE rayin_litellm_retention_purger;
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_litellm_writer') THEN
    REVOKE ALL ON "acme_litellm_events" FROM rayin_litellm_writer;
    REVOKE USAGE ON SCHEMA public FROM rayin_litellm_writer;
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM rayin_litellm_writer', current_database());
    DROP ROLE rayin_litellm_writer;
  END IF;
END
$$;

-- Part 1 in reverse. Dropping a table drops its indexes and the grants held
-- on it by rayin_app_runtime.
DROP TABLE "acme_litellm_events";
DROP TABLE "acme_litellm_spend_snapshots";
DROP TABLE "acme_litellm_teams";
DROP TABLE "acme_litellm_keys";

DROP TYPE "AcmeLitellmEventOutcome";
DROP TYPE "AcmeLitellmEventPhase";
DROP TYPE "AcmeLitellmTeamStatus";
DROP TYPE "AcmeLitellmKeyStatus";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260919120000_add_acme_litellm_management';

COMMIT;
