-- ACME: EYEON telemetry ingest (ADR-0006 addendum; LLD section 6).
-- Additive: three new tables, three trigger functions and two roles. No change
-- to any upstream table and no change to any existing ACME table (the key table
-- gets a column-level SELECT grant for the reader role, nothing else).

-- ---------------------------------------------------------------------------
-- Policy: what a project allows an application to send through the gateway key.
-- One row per project. No row, or enabled = false, means the ingest refuses
-- (403). The default for an unconfigured project is therefore "off".
-- ---------------------------------------------------------------------------
CREATE TABLE "acme_telemetry_policy" (
    "project_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "content_mode" TEXT NOT NULL DEFAULT 'metadata',
    "user_id_mode" TEXT NOT NULL DEFAULT 'hash',
    "attribute_allowlist_extra" TEXT[] NOT NULL DEFAULT '{}',
    "retention_days" INTEGER,
    -- Per-project secret for the end-user id HMAC (DEC-2). 64 hex characters
    -- from two random UUIDs. Never copied to the history table.
    "user_hash_salt" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_telemetry_policy_pkey" PRIMARY KEY ("project_id"),
    CONSTRAINT "acme_telemetry_policy_content_mode_check"
        CHECK ("content_mode" IN ('metadata', 'redacted', 'full')),
    CONSTRAINT "acme_telemetry_policy_user_id_mode_check"
        CHECK ("user_id_mode" IN ('hash', 'drop', 'pass')),
    CONSTRAINT "acme_telemetry_policy_retention_check"
        CHECK ("retention_days" IS NULL OR "retention_days" > 0),
    CONSTRAINT "acme_telemetry_policy_extra_size_check"
        CHECK (cardinality("attribute_allowlist_extra") <= 32)
);

-- ---------------------------------------------------------------------------
-- History: every insert, update and delete of a policy row, written by a
-- trigger so it holds for every login, including the admin login the console
-- still uses until the least-privilege cutover (P0-5). Append-only for the
-- same reason, by triggers. Only a superuser disabling them can bypass this.
-- ---------------------------------------------------------------------------
CREATE TABLE "acme_telemetry_policy_history" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "content_mode" TEXT NOT NULL,
    "user_id_mode" TEXT NOT NULL,
    "attribute_allowlist_extra" TEXT[] NOT NULL,
    "retention_days" INTEGER,
    "updated_by_user_id" TEXT,
    "recorded_by_db_user" TEXT NOT NULL DEFAULT CURRENT_USER,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_telemetry_policy_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "acme_telemetry_policy_history_operation_check"
        CHECK ("operation" IN ('INSERT', 'UPDATE', 'DELETE'))
);

CREATE INDEX "acme_telemetry_policy_history_project_id_recorded_at_idx"
    ON "acme_telemetry_policy_history"("project_id", "recorded_at");

CREATE FUNCTION acme_telemetry_policy_history_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'acme_telemetry_policy_history is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER acme_telemetry_policy_history_no_update_delete
  BEFORE UPDATE OR DELETE ON "acme_telemetry_policy_history"
  FOR EACH ROW EXECUTE FUNCTION acme_telemetry_policy_history_append_only();

CREATE TRIGGER acme_telemetry_policy_history_no_truncate
  BEFORE TRUNCATE ON "acme_telemetry_policy_history"
  FOR EACH STATEMENT EXECUTE FUNCTION acme_telemetry_policy_history_append_only();

-- On update: the version moves up by one, the time is set, and the project id
-- and the salt cannot be changed (changing the salt would silently re-key every
-- end-user hash for the project; that needs its own decision).
CREATE FUNCTION acme_telemetry_policy_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."project_id" := OLD."project_id";
  NEW."user_hash_salt" := OLD."user_hash_salt";
  NEW."version" := OLD."version" + 1;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acme_telemetry_policy_before_update
  BEFORE UPDATE ON "acme_telemetry_policy"
  FOR EACH ROW EXECUTE FUNCTION acme_telemetry_policy_before_update();

-- Copy each change to the history. The salt is not copied.
CREATE FUNCTION acme_telemetry_policy_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "acme_telemetry_policy"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
  ELSE
    r := NEW;
  END IF;
  INSERT INTO "acme_telemetry_policy_history"
    ("project_id", "version", "operation", "enabled", "content_mode",
     "user_id_mode", "attribute_allowlist_extra", "retention_days",
     "updated_by_user_id")
  VALUES
    (r."project_id", r."version", TG_OP, r."enabled", r."content_mode",
     r."user_id_mode", r."attribute_allowlist_extra", r."retention_days",
     r."updated_by_user_id");
  RETURN NULL;
END;
$$;

CREATE TRIGGER acme_telemetry_policy_record
  AFTER INSERT OR UPDATE OR DELETE ON "acme_telemetry_policy"
  FOR EACH ROW EXECUTE FUNCTION acme_telemetry_policy_record();

-- ---------------------------------------------------------------------------
-- Counters: minute buckets per project and key lineage. Counts only.
-- lineage_id is '-' for a request that never reached a project.
-- ---------------------------------------------------------------------------
CREATE TABLE "acme_telemetry_ingest_stats" (
    "project_id" TEXT NOT NULL,
    "lineage_id" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "spans_in" INTEGER NOT NULL DEFAULT 0,
    "spans_out" INTEGER NOT NULL DEFAULT 0,
    "attrs_dropped" INTEGER NOT NULL DEFAULT 0,
    "dropped_not_allowlisted" INTEGER NOT NULL DEFAULT 0,
    "dropped_reserved" INTEGER NOT NULL DEFAULT 0,
    "dropped_cost" INTEGER NOT NULL DEFAULT 0,
    "dropped_content" INTEGER NOT NULL DEFAULT 0,
    "dropped_bad_value" INTEGER NOT NULL DEFAULT 0,
    "dropped_user_id" INTEGER NOT NULL DEFAULT 0,
    "dropped_spans" INTEGER NOT NULL DEFAULT 0,
    "dropped_events" INTEGER NOT NULL DEFAULT 0,
    "dropped_links" INTEGER NOT NULL DEFAULT 0,
    "names_normalised" INTEGER NOT NULL DEFAULT 0,
    "rejected_malformed" INTEGER NOT NULL DEFAULT 0,
    "rejected_filter" INTEGER NOT NULL DEFAULT 0,
    "rejected_handoff" INTEGER NOT NULL DEFAULT 0,
    "rejected_auth" INTEGER NOT NULL DEFAULT 0,
    "rejected_disabled" INTEGER NOT NULL DEFAULT 0,
    "rejected_size" INTEGER NOT NULL DEFAULT 0,
    "rejected_type" INTEGER NOT NULL DEFAULT 0,
    "rejected_rate" INTEGER NOT NULL DEFAULT 0,
    "rejected_engine" INTEGER NOT NULL DEFAULT 0,
    "policy_downgraded" INTEGER NOT NULL DEFAULT 0,
    "last_received_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acme_telemetry_ingest_stats_pkey"
        PRIMARY KEY ("project_id", "lineage_id", "bucket_start")
);

-- Supports a purge by age. A scheduled purge is not part of this change
-- (RET-6); the rows are small, and carry no content.
CREATE INDEX "acme_telemetry_ingest_stats_bucket_start_idx"
    ON "acme_telemetry_ingest_stats"("bucket_start");

-- ---------------------------------------------------------------------------
-- Roles and grants (the rayin_* pattern, migration 20260919120000).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_telemetry_writer') THEN
    CREATE ROLE rayin_telemetry_writer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rayin_telemetry_writer', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO rayin_telemetry_writer;

-- The counter writer: INSERT and UPDATE (the upsert), and SELECT because the
-- upsert's "counter = counter + n" reads the stored value. It touches the
-- counters table and nothing else; it cannot read policy, keys or telemetry.
REVOKE ALL ON "acme_telemetry_ingest_stats" FROM rayin_telemetry_writer;
GRANT SELECT, INSERT, UPDATE ON "acme_telemetry_ingest_stats" TO rayin_telemetry_writer;

-- The reader: the ingest's two lookups, a presented key's row and a project's
-- policy row. Column-level SELECT on the key table, so even a defect in the
-- ingest cannot read a budget, a model list, a creator or a rotation link. It
-- cannot write anything, and it cannot read the history or the counters.
-- The key table comes from migration 20260919120000; fail loudly if it is not
-- there rather than skip the grant.
DO $$
BEGIN
  IF to_regclass('public.acme_litellm_keys') IS NULL THEN
    RAISE EXCEPTION 'table acme_litellm_keys is missing: apply 20260919120000_add_acme_litellm_management first';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_telemetry_reader') THEN
    CREATE ROLE rayin_telemetry_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rayin_telemetry_reader', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO rayin_telemetry_reader;

REVOKE ALL ON "acme_litellm_keys" FROM rayin_telemetry_reader;
GRANT SELECT ("id", "org_id", "project_id", "lineage_id", "display_name",
              "token_hash", "status", "expires_at", "revoked_at")
  ON "acme_litellm_keys" TO rayin_telemetry_reader;

REVOKE ALL ON "acme_telemetry_policy" FROM rayin_telemetry_reader;
GRANT SELECT ON "acme_telemetry_policy" TO rayin_telemetry_reader;

-- The console's runtime role reads all three; nobody but the admin login
-- (the owner's SQL) writes policy. A later change that adds a policy editor
-- grants what it needs. Guarded so this applies where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_app_runtime') THEN
    REVOKE ALL ON "acme_telemetry_policy" FROM rayin_app_runtime;
    GRANT SELECT ON "acme_telemetry_policy" TO rayin_app_runtime;
    REVOKE ALL ON "acme_telemetry_policy_history" FROM rayin_app_runtime;
    GRANT SELECT ON "acme_telemetry_policy_history" TO rayin_app_runtime;
    REVOKE ALL ON "acme_telemetry_ingest_stats" FROM rayin_app_runtime;
    GRANT SELECT ON "acme_telemetry_ingest_stats" TO rayin_app_runtime;
  END IF;
END
$$;
