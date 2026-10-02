-- Rollback for 20261002120000_acme_guardrail_enforcement_switch
-- (ADR-0005-B part b, CHG-2026-089). See ROLLBACK.md beside this file.
--
-- acme_guardrail_settings is append-only (triggers refuse UPDATE, DELETE and
-- TRUNCATE), so a stored enforce or automatic version cannot be removed. Once
-- one exists, the "record only" CHECK cannot be restored, and this script
-- stops before changing anything: forward-fix instead (switch back to record
-- in the console, and keep the columns).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "acme_guardrail_settings"
    WHERE "mode" <> 'record' OR "revert_at" IS NOT NULL OR "automatic"
  ) THEN
    RAISE EXCEPTION
      'An enforce or automatic guardrail settings version exists; the table is append-only, so this migration cannot be rolled back. Forward-fix instead.';
  END IF;
END $$;

ALTER TABLE "acme_guardrail_events" DROP CONSTRAINT IF EXISTS "acme_guardrail_events_gateway_mode_check";
ALTER TABLE "acme_guardrail_events" DROP COLUMN IF EXISTS "gateway_settings_version";
ALTER TABLE "acme_guardrail_events" DROP COLUMN IF EXISTS "gateway_mode";
ALTER TABLE "acme_guardrail_events" DROP COLUMN IF EXISTS "gateway_pod";

ALTER TABLE "acme_guardrail_settings" DROP CONSTRAINT IF EXISTS "acme_guardrail_settings_revert_check";
ALTER TABLE "acme_guardrail_settings" DROP COLUMN IF EXISTS "automatic";
ALTER TABLE "acme_guardrail_settings" DROP COLUMN IF EXISTS "revert_at";

ALTER TABLE "acme_guardrail_settings" DROP CONSTRAINT "acme_guardrail_settings_mode_check";
ALTER TABLE "acme_guardrail_settings" ADD CONSTRAINT "acme_guardrail_settings_mode_check"
    CHECK ("mode" IN ('record'));

DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20261002120000_acme_guardrail_enforcement_switch';
