-- ACME: append-only mirror of LiteLLM gateway requests, and the record of
-- each reconciliation pass (ADR-0003, CHG-2026-008). Additive only.
-- Append-only is enforced HERE, by grants, following
-- 20260919120000_add_acme_litellm_management, which created the two roles.
-- Rollback: acme-governance/rollback/20260919180000_add_acme_litellm_request_logs/

-- CreateEnum
CREATE TYPE "AcmeLitellmRequestLogSource" AS ENUM ('push', 'reconcile');

-- CreateTable
CREATE TABLE "acme_litellm_request_logs" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "litellm_call_id" TEXT,
    "source" "AcmeLitellmRequestLogSource" NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "call_type" TEXT,
    "model" TEXT,
    "model_group" TEXT,
    "provider" TEXT,
    "api_key_hash" TEXT,
    "key_alias" TEXT,
    "litellm_team_id" TEXT,
    "end_user" TEXT,
    "requester_ip" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "spend" DOUBLE PRECISION,
    "cache_hit" BOOLEAN,
    "error_class" TEXT,
    "org_id" TEXT,
    "project_id" TEXT,
    "cairo_key_id" TEXT,

    CONSTRAINT "acme_litellm_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acme_litellm_reconcile_runs" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "rows_checked" INTEGER NOT NULL,
    "gap_count" INTEGER NOT NULL,
    "inserted" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,

    CONSTRAINT "acme_litellm_reconcile_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acme_litellm_request_logs_request_id_key" ON "acme_litellm_request_logs"("request_id");

-- CreateIndex
CREATE INDEX "acme_litellm_request_logs_project_id_start_time_idx" ON "acme_litellm_request_logs"("project_id", "start_time");

-- CreateIndex
CREATE INDEX "acme_litellm_request_logs_start_time_idx" ON "acme_litellm_request_logs"("start_time");

-- CreateIndex
CREATE INDEX "acme_litellm_request_logs_litellm_call_id_idx" ON "acme_litellm_request_logs"("litellm_call_id");

-- CreateIndex
CREATE INDEX "acme_litellm_request_logs_api_key_hash_idx" ON "acme_litellm_request_logs"("api_key_hash");

-- CreateIndex
CREATE INDEX "acme_litellm_reconcile_runs_finished_at_idx" ON "acme_litellm_reconcile_runs"("finished_at");

-- =====================================================================
-- Grants. The two roles are created by the previous ACME migration.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_litellm_writer')
     OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_litellm_retention_purger') THEN
    RAISE EXCEPTION 'roles rayin_litellm_writer / rayin_litellm_retention_purger are missing: apply 20260919120000_add_acme_litellm_management first';
  END IF;
END
$$;

-- General runtime role: READ only. REVOKE ALL first so this holds whichever
-- role owns the tables and whatever default privileges fired at CREATE time.
REVOKE ALL ON "acme_litellm_request_logs" FROM rayin_app_runtime;
REVOKE ALL ON "acme_litellm_reconcile_runs" FROM rayin_app_runtime;
GRANT SELECT ON "acme_litellm_request_logs" TO rayin_app_runtime;
GRANT SELECT ON "acme_litellm_reconcile_runs" TO rayin_app_runtime;

-- The only role that writes. INSERT and nothing else -- no SELECT:
-- idempotency is the request_id unique index + ON CONFLICT DO NOTHING.
GRANT INSERT ON "acme_litellm_request_logs" TO rayin_litellm_writer;
GRANT INSERT ON "acme_litellm_reconcile_runs" TO rayin_litellm_writer;

-- Retention: a scheduled job only, never a request path.
GRANT SELECT, DELETE ON "acme_litellm_request_logs" TO rayin_litellm_retention_purger;
GRANT SELECT, DELETE ON "acme_litellm_reconcile_runs" TO rayin_litellm_retention_purger;

-- Same limitation as the other append-only tables: the owner and any admin
-- login can still change rows. This does nothing in an environment whose
-- application connects as the admin login (Readiness Ledger P0-5).
