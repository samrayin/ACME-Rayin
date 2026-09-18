-- ACME: guardrail event detail view + capture-path provenance.
--
-- 1. client_host -- the machine the guarded request came from (hostname or
--    device id), forwarded by rayin-guardrails' caller alongside user_id.
--    Caller-asserted, exactly like user_id: rayin-guardrails sits behind the
--    gateway in-cluster, so the network peer it sees is the gateway pod, not
--    the end user's machine. Needed so the dashboard's detail panel can
--    answer "who, from which machine, when" -- CAIRO roadmap Phase 1,
--    "Clickable jailbreak detail view".
--
-- 2. source -- which capture path wrote the row: 'push' (the durable
--    audit-trail endpoint, full tiered content) or 'pull' (the dashboard's
--    buffer reconciliation, metadata only). Until now the two were
--    indistinguishable except by event_id happening to be NULL.
--
-- Deliberately NO backfill of existing rows: this is an audit table, and
-- rewriting historical rows -- even to add a derived value -- is exactly
-- what the append-only design exists to avoid. NULL source means "recorded
-- before this column existed"; for those rows, event_id IS NOT NULL still
-- identifies a push.
--
-- Both columns are nullable, so pods still running the previous image
-- during the rollout keep inserting successfully. Table-level INSERT
-- (rayin_guardrails_writer) and SELECT/INSERT (rayin_app_runtime) grants
-- already cover new columns; no grant changes are needed.

CREATE TYPE "AcmeGuardrailEventSource" AS ENUM ('push', 'pull');

ALTER TABLE "acme_guardrail_events"
  ADD COLUMN "source" "AcmeGuardrailEventSource",
  ADD COLUMN "client_host" TEXT;
