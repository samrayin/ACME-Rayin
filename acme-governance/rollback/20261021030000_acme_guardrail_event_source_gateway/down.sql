-- Rollback for 20261021030000_acme_guardrail_event_source_gateway
-- (CHG-2026-169, ADR-0033). See ROLLBACK.md beside this file.
--
-- Postgres cannot drop one value from an enum. This script rebuilds the type
-- without it, which works only while no event uses the value. If one does,
-- it stops before changing anything: forward-fix instead (those rows are audit
-- records of refused requests and must not be deleted to make a rollback fit).
--
-- The whole script is one transaction. If the first check refuses, nothing
-- changes, whichever runner is used: `psql -v ON_ERROR_STOP=1 -f down.sql`,
-- plain `psql -f down.sql`, or `prisma db execute --file`.

BEGIN;

-- Lock first, so no event can be written between the check and the rebuild.
-- Pushes and the worker's writes wait until COMMIT.
LOCK TABLE "acme_guardrail_events" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "acme_guardrail_events" WHERE "source"::text = 'gateway'
  ) THEN
    RAISE EXCEPTION
      'Guardrail events with source gateway exist; the value cannot be removed without deleting audit rows. Forward-fix instead.';
  END IF;
END $$;

ALTER TYPE "AcmeGuardrailEventSource" RENAME TO "AcmeGuardrailEventSource_gateway_old";
CREATE TYPE "AcmeGuardrailEventSource" AS ENUM ('push', 'pull');
ALTER TABLE "acme_guardrail_events"
  ALTER COLUMN "source" TYPE "AcmeGuardrailEventSource"
  USING ("source"::text::"AcmeGuardrailEventSource");
DROP TYPE "AcmeGuardrailEventSource_gateway_old";

DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20261021030000_acme_guardrail_event_source_gateway';

COMMIT;
