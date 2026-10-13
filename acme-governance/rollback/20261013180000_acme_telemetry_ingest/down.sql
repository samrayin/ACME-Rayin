-- Rollback of 20261013180000_acme_telemetry_ingest (EYEON telemetry ingest).
--   npx prisma db execute --file acme-governance/rollback/20261013180000_acme_telemetry_ingest/down.sql \
--     --schema packages/shared/prisma/schema.prisma
--
-- DATA-DESTROYING: drops the telemetry policy (and its salt), the policy
-- history (every change, who and when) and the counters, and drops the reader
-- and writer roles (and the reader's column grants on acme_litellm_keys).
-- Export first -- see ROLLBACK.md. Run as the table owner or admin login. The append-only triggers
-- block UPDATE, DELETE and TRUNCATE, not DROP.
--
-- Dropping the salt means that, if the migration is applied again, every
-- project gets a NEW salt and its end-user hashes will not match the old ones.

BEGIN;

DROP TRIGGER IF EXISTS acme_telemetry_policy_record ON "acme_telemetry_policy";
DROP TRIGGER IF EXISTS acme_telemetry_policy_before_update ON "acme_telemetry_policy";
DROP FUNCTION IF EXISTS acme_telemetry_policy_record();
DROP FUNCTION IF EXISTS acme_telemetry_policy_before_update();

DROP TRIGGER IF EXISTS acme_telemetry_policy_history_no_update_delete ON "acme_telemetry_policy_history";
DROP TRIGGER IF EXISTS acme_telemetry_policy_history_no_truncate ON "acme_telemetry_policy_history";
DROP FUNCTION IF EXISTS acme_telemetry_policy_history_append_only();

DROP TABLE "acme_telemetry_ingest_stats";
DROP TABLE "acme_telemetry_policy_history";
DROP TABLE "acme_telemetry_policy";

-- The reader role goes too. Its column grants on acme_litellm_keys are revoked
-- first (that table is not dropped; a table-level REVOKE also removes the
-- column privileges). Only if nothing else was ever granted to the role.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_telemetry_reader') THEN
    IF to_regclass('public.acme_litellm_keys') IS NOT NULL THEN
      REVOKE ALL ON "acme_litellm_keys" FROM rayin_telemetry_reader;
    END IF;
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM rayin_telemetry_reader', current_database());
    REVOKE ALL ON SCHEMA public FROM rayin_telemetry_reader;
    DROP ROLE rayin_telemetry_reader;
  END IF;
END
$$;

-- The writer role goes too, only if nothing else was ever granted to it.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_telemetry_writer') THEN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM rayin_telemetry_writer', current_database());
    REVOKE ALL ON SCHEMA public FROM rayin_telemetry_writer;
    DROP ROLE rayin_telemetry_writer;
  END IF;
END
$$;

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261013180000_acme_telemetry_ingest';

COMMIT;
