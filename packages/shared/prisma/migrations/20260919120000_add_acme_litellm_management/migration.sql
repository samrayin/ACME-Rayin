-- ACME: CAIRO management of the LiteLLM gateway (ADR-0003, CHG-2026-005).
-- Additive only. Two parts, both idempotent where Postgres allows it:
--   1. Tables: CAIRO's projection of what it issued in LiteLLM (mutable),
--      and acme_litellm_events, the append-only record of every mutating
--      action.
--   2. Roles and grants: append-only is enforced HERE, at database level,
--      following 20260917090000_add_acme_guardrail_events_push_support.
--      Roles are created WITHOUT a password, so they exist but cannot log
--      in until an environment sets one (acme-rayin-ops).
-- Rollback: acme-governance/rollback/20260919120000_add_acme_litellm_management/

-- =====================================================================
-- Part 1: Tables
-- =====================================================================

-- CreateEnum
CREATE TYPE "AcmeLitellmKeyStatus" AS ENUM ('pending', 'active', 'revoked', 'rotated', 'rotation_partial', 'failed');

-- CreateEnum
CREATE TYPE "AcmeLitellmTeamStatus" AS ENUM ('pending', 'active', 'deleted', 'failed');

-- CreateEnum
CREATE TYPE "AcmeLitellmEventPhase" AS ENUM ('intent', 'outcome');

-- CreateEnum
CREATE TYPE "AcmeLitellmEventOutcome" AS ENUM ('success', 'failure', 'partial');

-- CreateTable
CREATE TABLE "acme_litellm_keys" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "lineage_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "display_name" TEXT NOT NULL,
    "litellm_key_alias" TEXT NOT NULL,
    "token_hash" TEXT,
    "litellm_team_id" TEXT,
    "status" "AcmeLitellmKeyStatus" NOT NULL DEFAULT 'pending',
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_budget" DOUBLE PRECISION,
    "budget_duration" TEXT,
    "rpm_limit" INTEGER,
    "tpm_limit" INTEGER,
    "expires_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "rotated_to_key_id" TEXT,

    CONSTRAINT "acme_litellm_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acme_litellm_teams" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "team_alias" TEXT NOT NULL,
    "status" "AcmeLitellmTeamStatus" NOT NULL DEFAULT 'pending',
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_budget" DOUBLE PRECISION,
    "budget_duration" TEXT,
    "rpm_limit" INTEGER,
    "tpm_limit" INTEGER,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "acme_litellm_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acme_litellm_spend_snapshots" (
    "cache_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_litellm_spend_snapshots_pkey" PRIMARY KEY ("cache_key")
);

-- CreateTable
CREATE TABLE "acme_litellm_events" (
    "id" TEXT NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT NOT NULL,
    "phase" "AcmeLitellmEventPhase" NOT NULL,
    "outcome" "AcmeLitellmEventOutcome",
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_org_role" TEXT,
    "actor_project_role" TEXT,
    "before" JSONB,
    "after" JSONB,
    "error_message" TEXT,

    CONSTRAINT "acme_litellm_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acme_litellm_keys_token_hash_key" ON "acme_litellm_keys"("token_hash");

-- CreateIndex
CREATE INDEX "acme_litellm_keys_project_id_status_idx" ON "acme_litellm_keys"("project_id", "status");

-- CreateIndex
CREATE INDEX "acme_litellm_keys_lineage_id_idx" ON "acme_litellm_keys"("lineage_id");

-- CreateIndex
CREATE INDEX "acme_litellm_teams_project_id_status_idx" ON "acme_litellm_teams"("project_id", "status");

-- CreateIndex
CREATE INDEX "acme_litellm_events_project_id_event_time_idx" ON "acme_litellm_events"("project_id", "event_time");

-- CreateIndex
CREATE INDEX "acme_litellm_events_correlation_id_idx" ON "acme_litellm_events"("correlation_id");

-- =====================================================================
-- Part 2: Roles and grants
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_litellm_writer') THEN
    CREATE ROLE rayin_litellm_writer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_litellm_retention_purger') THEN
    CREATE ROLE rayin_litellm_retention_purger WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
  END IF;
  -- current_database(), not a hardcoded name: the earlier roles migration
  -- hardcoded "langfuse", recorded as a gap in acme-rayin-ops (TF-22).
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rayin_litellm_writer', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rayin_litellm_retention_purger', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO rayin_litellm_writer;
GRANT USAGE ON SCHEMA public TO rayin_litellm_retention_purger;

-- General runtime role. Granted explicitly rather than relying on the
-- ALTER DEFAULT PRIVILEGES set up for rayin_migrator: those only fire for
-- tables rayin_migrator creates, and where start-up migrations still run as
-- the admin login the new tables would otherwise be invisible to
-- rayin_app_runtime after the least-privilege cutover.
GRANT SELECT, INSERT, UPDATE, DELETE ON "acme_litellm_keys" TO rayin_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "acme_litellm_teams" TO rayin_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "acme_litellm_spend_snapshots" TO rayin_app_runtime;

-- Append-only: the runtime role may READ the event record and nothing else.
-- REVOKE ALL first so this holds whichever role owns the table and whatever
-- default privileges fired at CREATE time.
REVOKE ALL ON "acme_litellm_events" FROM rayin_app_runtime;
GRANT SELECT ON "acme_litellm_events" TO rayin_app_runtime;

-- The only role that writes the record. INSERT and nothing else -- no
-- SELECT: nothing it does needs to read the table back.
GRANT INSERT ON "acme_litellm_events" TO rayin_litellm_writer;

-- Retention: a scheduled job only, never a request path.
GRANT SELECT, DELETE ON "acme_litellm_events" TO rayin_litellm_retention_purger;

-- Same honestly-flagged limitation as acme_guardrail_events: the table's
-- owner (and any superuser / admin login) can still change or re-grant.
-- This is a real control against application bugs and injection through the
-- runtime connection; it is NOT a boundary against the admin credential,
-- and it does nothing at all in an environment whose application still
-- connects as the admin login.
