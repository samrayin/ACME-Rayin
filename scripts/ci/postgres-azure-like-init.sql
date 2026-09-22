-- CI-only Postgres bootstrap that models Azure Database for PostgreSQL
-- Flexible Server (CHG-2026-043). Mounted into /docker-entrypoint-initdb.d by
-- docker-compose.ci-azure-like.yml, which is layered on top of the dev compose
-- files in CI only. It does NOT run for a normal `docker compose up`.
--
-- WHY THIS EXISTS
-- ---------------
-- A stock postgres image makes `postgres` the *bootstrap* superuser: the role
-- that owns every catalog object initdb created. Postgres refuses
-- `REASSIGN OWNED BY <bootstrap role>` unconditionally --
--   "cannot reassign ownership of objects owned by role postgres because they
--    are required by the database system"  (SQLSTATE 2BP01)
-- -- because those objects are pinned. No grant can work around it.
--
-- Azure Flexible Server is not shaped that way. The customer-created admin
-- login belongs to `azure_pg_admin` and is explicitly NOT the bootstrap
-- superuser; `azure_superuser` is, and is inaccessible to the customer. So on
-- Azure the admin role owns no pinned objects and REASSIGN succeeds.
--
-- Migration 20260917090000_add_acme_guardrail_events_push_support therefore
-- applies on Azure (documented in acme-governance/rollback/
-- MIGRATION-ROLLBACK-INVENTORY.md since 2026-09-19, and proven by live audit
-- rows using the columns it adds) while failing on a stock image. CI used the
-- stock shape, so CI reported a production defect that does not exist --
-- raised, rated P0, and closed as invalidated (CHG-2026-035).
--
-- This file makes CI's database match the target it is supposed to represent.
-- It is the same shape acme-governance/scripts/rehearsal-db.sh already builds
-- for migration rehearsals; that script's header records the same finding.
--
-- HOW
-- ---
-- The container's own superuser is `pgboot` (set by the overlay), so `postgres`
-- is free to be an ordinary admin role, exactly as on Azure. This script runs
-- as `pgboot` against the default `postgres` database.

-- The application's admin role. NOT a superuser -- that is the entire point.
-- CREATEDB + CREATEROLE mirror what the Azure admin login actually holds, and
-- CREATEROLE is required: the migration creates four rayin_* roles.
--
-- The password is the throwaway value already committed in .env.dev.example
-- (`postgresql://postgres:postgres@...`). This is a disposable CI fixture with
-- no real data; it is not a credential and must never become one.
CREATE ROLE postgres WITH LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD 'postgres';

-- Give the admin role ownership of the database the application actually uses,
-- and of its public schema. Since Postgres 15 the public schema no longer
-- grants CREATE to PUBLIC, so without this the app could connect but not
-- create its ~400 tables.
ALTER DATABASE postgres OWNER TO postgres;
ALTER SCHEMA public OWNER TO postgres;

-- The migration issues four `GRANT ... ON DATABASE langfuse` statements with
-- the name hardcoded, and CI connects to the database named `postgres`. On
-- Azure the deployed database really is called `langfuse`, so those statements
-- find their target; in CI they would fail with "database langfuse does not
-- exist" -- a second, independent mismatch from the bootstrap-superuser one.
--
-- KNOWN AND DELIBERATE LIMITATION: this creates `langfuse` as an empty
-- database purely so those grants resolve. CI's *role structure* now matches
-- Azure; CI's *database naming* still does not, and this change does not
-- address that. Nothing connects to this database and nothing is migrated into
-- it. The separate question of whether that hardcoded name is portable to a
-- customer deployment is filed on its own, cross-referencing ACME-Rayin#23.
CREATE DATABASE langfuse OWNER postgres;
