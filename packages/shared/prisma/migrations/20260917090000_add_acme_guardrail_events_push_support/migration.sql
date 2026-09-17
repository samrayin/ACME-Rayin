-- POSTGRES-COMPLIANCE-FRAMEWORK.md (repo root) is the design reference this
-- migration implements. Two parts, both idempotent so this migration is
-- safe on a brand-new environment's very first `prisma migrate deploy` (per
-- the framework doc's constraint: ships in the baseline, no manual step):
--
--   1. Role bootstrap (§2) -- four Postgres roles replacing the single
--      admin credential for app-level use. Roles are created WITHOUT a
--      password: a role with no password set cannot authenticate, so this
--      migration creates real, usable-once-configured roles without ever
--      putting a real credential in a file checked into git. Setting the
--      actual password is a separate, Terraform/secret-store-driven step
--      (see the framework doc's "Terraform/IaC follow-up" list, item #1) --
--      until that happens, these roles exist but nothing can log in as
--      them, which is a safe (if inert) default, not a broken one.
--
--   2. Schema changes (§1) -- tiered content columns on
--      acme_guardrail_events, and a real event_id as the primary
--      idempotency key. event_id is nullable during backfill (existing
--      rows predate it); Postgres unique indexes already treat NULL as
--      distinct from every other NULL, so a plain (non-partial) unique
--      index already gives the right semantics here -- multiple NULLs
--      allowed, non-null values enforced unique -- with no WHERE predicate
--      needed. (An earlier draft of this design used a partial index with
--      an explicit predicate and found a real Postgres gotcha in doing so
--      -- ON CONFLICT targets must restate a partial index's predicate
--      exactly, confirmed by a live test against a throwaway TEMP TABLE.
--      That finding is preserved in the framework doc for the historical
--      record, but the simpler plain-unique-index design here sidesteps
--      the whole issue rather than working around it.)

-- =====================================================================
-- Part 1: Role bootstrap
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_migrator') THEN
    CREATE ROLE rayin_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_app_runtime') THEN
    CREATE ROLE rayin_app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 100;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_guardrails_writer') THEN
    CREATE ROLE rayin_guardrails_writer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_retention_purger') THEN
    CREATE ROLE rayin_retention_purger WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
  END IF;
END
$$;

-- Correction from the framework doc's original draft: GRANT ALL PRIVILEGES
-- on the database/schema does NOT confer ownership of the ~400 tables that
-- already exist (all owned by `postgres` up to this point) -- ALTER TABLE
-- is an ownership-gated operation with no GRANT equivalent. Without this,
-- rayin_migrator could create new objects but could not run any future
-- migration that ALTERs an existing table. Confirmed against this exact
-- gotcha before being accepted as final; see the framework doc §2.3.
REASSIGN OWNED BY postgres TO rayin_migrator;

GRANT ALL PRIVILEGES ON DATABASE langfuse TO rayin_migrator;
GRANT ALL PRIVILEGES ON SCHEMA public TO rayin_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO rayin_migrator;

GRANT CONNECT ON DATABASE langfuse TO rayin_app_runtime;
GRANT USAGE ON SCHEMA public TO rayin_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rayin_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rayin_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rayin_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rayin_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rayin_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rayin_app_runtime;

GRANT CONNECT ON DATABASE langfuse TO rayin_guardrails_writer;
GRANT USAGE ON SCHEMA public TO rayin_guardrails_writer;
-- Narrow, explicit, one table -- the segregation-of-duties boundary this
-- role exists for. No SELECT: idempotency is enforced via the event_id
-- unique index + ON CONFLICT DO NOTHING, which needs no read access.
GRANT INSERT ON acme_guardrail_events TO rayin_guardrails_writer;

GRANT CONNECT ON DATABASE langfuse TO rayin_retention_purger;
GRANT USAGE ON SCHEMA public TO rayin_retention_purger;
GRANT SELECT, DELETE ON acme_guardrail_events TO rayin_retention_purger;

-- =====================================================================
-- Part 2: Schema changes
-- =====================================================================

ALTER TABLE "acme_guardrail_events"
  ADD COLUMN "event_id" TEXT,
  ADD COLUMN "redacted_text" TEXT,
  ADD COLUMN "pii_findings" JSONB,
  ADD COLUMN "raw_content_encrypted" TEXT,
  ADD COLUMN "user_id" TEXT;

-- Real idempotency key, generated by rayin-guardrails at decision time.
-- Plain (non-partial) unique index -- see the note at the top of this file
-- for why that's sufficient for the nullable-during-backfill case.
CREATE UNIQUE INDEX "acme_guardrail_events_event_id_key" ON "acme_guardrail_events"("event_id");

-- Append-only enforcement (framework doc §5 / decision on real DB-level
-- controls, not application-layer-only). Applied to rayin_app_runtime --
-- the general role -- as defense-in-depth for any existing code path that
-- queries this table through the general connection (e.g. the dashboard's
-- own reads in acmeGuardrailsRouter.ts), on top of rayin_guardrails_writer
-- above never having UPDATE/DELETE to begin with.
--
-- Honestly-flagged limitation (framework doc §2.1): rayin_migrator, the
-- role that just ran this REVOKE, retains ownership of this table and can
-- re-grant itself (or anyone) the revoked privilege -- this is real
-- defense-in-depth against application bugs and injection-class exploits
-- reachable through rayin_app_runtime's own connection, not a boundary
-- against a compromised holder of an admin-capable credential. A genuine
-- hard boundary needs the human/administrative credential separation
-- tracked separately (framework doc §3.1, Open Decisions #5).
REVOKE UPDATE, DELETE ON "acme_guardrail_events" FROM rayin_app_runtime;
