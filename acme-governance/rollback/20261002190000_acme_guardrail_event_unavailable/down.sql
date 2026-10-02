-- Rollback for 20261002190000_acme_guardrail_event_unavailable
-- (ADR-0005-B part b, phase 2, CHG-2026-089). See ROLLBACK.md beside this file.
--
-- Postgres cannot drop one value from an enum. This script rebuilds the type
-- without it, which works only while no event uses the value. If one does,
-- it stops before changing anything: forward-fix instead.
--
-- The whole script is one transaction. If the first check refuses, nothing
-- changes, whichever runner is used: `psql -v ON_ERROR_STOP=1 -f down.sql`,
-- plain `psql -f down.sql`, or `prisma db execute --file`.
BEGIN;

-- Lock first, so no event can be written between the check and the rebuild.
-- Event pushes wait (or fail and stay in rayin-guardrails' buffer) until
-- COMMIT.
LOCK TABLE "acme_guardrail_events" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "acme_guardrail_events" WHERE "action"::text = 'unavailable'
  ) THEN
    RAISE EXCEPTION
      'Guardrail events with action unavailable exist; the value cannot be removed without deleting audit rows. Forward-fix instead.';
  END IF;
END $$;

ALTER TYPE "AcmeGuardrailEventAction" RENAME TO "AcmeGuardrailEventAction_unavailable_old";
CREATE TYPE "AcmeGuardrailEventAction" AS ENUM ('allow', 'redact', 'block');
ALTER TABLE "acme_guardrail_events"
  ALTER COLUMN "action" TYPE "AcmeGuardrailEventAction"
  USING ("action"::text::"AcmeGuardrailEventAction");
DROP TYPE "AcmeGuardrailEventAction_unavailable_old";

DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20261002190000_acme_guardrail_event_unavailable';

COMMIT;
