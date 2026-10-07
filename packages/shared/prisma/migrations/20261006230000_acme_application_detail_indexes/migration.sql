-- ACME (CHG-2026-125, ADR-0023 §3.5): indexes for the application detail
-- screen. Additive: two indexes on ACME tables, no column, row or upstream
-- table changes.
--
-- An application is a gateway key lineage. Its requests are found by the
-- key aliases of every generation within a project and a period, and its
-- change record by each generation's key id; neither column was indexed.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma sends a migration's statements
-- together, which Postgres runs as one transaction block, where CONCURRENTLY
-- is refused; and at today's table sizes the build takes well under a
-- second. It blocks writes to the table while it runs, so on a large table
-- build the index concurrently by hand first; IF NOT EXISTS then makes this
-- migration a no-op for it.

-- One application's requests in a period, newest first.
CREATE INDEX IF NOT EXISTS "acme_litellm_request_logs_project_id_key_alias_start_time_idx" ON "acme_litellm_request_logs"("project_id", "key_alias", "start_time");

-- One key's change record, every generation.
CREATE INDEX IF NOT EXISTS "acme_litellm_events_resource_id_idx" ON "acme_litellm_events"("resource_id");
