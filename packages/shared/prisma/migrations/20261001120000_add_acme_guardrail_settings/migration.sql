-- ACME: CAIRO-held guardrail settings (ADR-0005-B part a, CHG-2026-089).
-- Additive: two new tables and two nullable columns on acme_guardrail_events.
-- No change to any upstream table.

-- One row per settings version; the highest version is in force.
CREATE TABLE "acme_guardrail_settings" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'record',
    "pii_entities" TEXT[] NOT NULL,
    "jailbreak_enabled" BOOLEAN NOT NULL,
    "topical_enabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_by_email" TEXT,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_guardrail_settings_pkey" PRIMARY KEY ("id"),
    -- Part a never enforces: the enforcement switch (part b) widens this.
    CONSTRAINT "acme_guardrail_settings_mode_check" CHECK ("mode" IN ('record')),
    CONSTRAINT "acme_guardrail_settings_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "acme_guardrail_settings_version_key" ON "acme_guardrail_settings"("version");

-- Version 1: the policy rayin-guardrails applied by default on 2026-10-01
-- (read from both pods that day): every personal-data type, both checks on.
-- Owner decision D2, 2026-10-01.
INSERT INTO "acme_guardrail_settings"
    ("id", "version", "mode", "pii_entities", "jailbreak_enabled", "topical_enabled", "reason", "created_by")
VALUES
    ('acme-guardrail-settings-v1', 1, 'record',
     ARRAY['EMAIL_ADDRESS', 'PHONE_NUMBER', 'CREDIT_CARD', 'PERSON', 'IBAN_CODE', 'IP_ADDRESS', 'BH_CPR'],
     true, true,
     'Initial version: the rayin-guardrails defaults in force on 2026-10-01 (ADR-0005-B part a).',
     'migration');

-- Which settings version each rayin-guardrails pod last pulled.
CREATE TABLE "acme_guardrail_settings_pods" (
    "pod" TEXT NOT NULL,
    "applied_version" INTEGER,
    "project_id" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_guardrail_settings_pods_pkey" PRIMARY KEY ("pod")
);

-- Which settings version and pod decided each guardrail event.
ALTER TABLE "acme_guardrail_events" ADD COLUMN "settings_version" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "pod" TEXT;

-- Settings history is append-only: a change is a new version, and a version
-- number is never reused (ADR-0005-B §3.3 relies on versions only moving
-- forward). Enforced by triggers, so it holds for every login, including the
-- admin login the application still uses until the least-privilege cutover
-- (ADR-0004, P0-5). Only a superuser disabling the triggers can bypass them.
CREATE FUNCTION acme_guardrail_settings_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'acme_guardrail_settings is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER acme_guardrail_settings_no_update_delete
  BEFORE UPDATE OR DELETE ON "acme_guardrail_settings"
  FOR EACH ROW EXECUTE FUNCTION acme_guardrail_settings_append_only();

CREATE TRIGGER acme_guardrail_settings_no_truncate
  BEFORE TRUNCATE ON "acme_guardrail_settings"
  FOR EACH STATEMENT EXECUTE FUNCTION acme_guardrail_settings_append_only();

-- Privileges for the least-privilege runtime role. Migrations still run as
-- the admin login, so the default privileges set for rayin_migrator do not
-- cover these tables; grant explicitly (the pattern of 20260919120000).
-- Settings: read and add versions only. Pod status: read and upsert. The
-- role is created by migration 20260917090000; guarded so this migration
-- also applies where it does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_app_runtime') THEN
    REVOKE ALL ON "acme_guardrail_settings" FROM rayin_app_runtime;
    GRANT SELECT, INSERT ON "acme_guardrail_settings" TO rayin_app_runtime;
    REVOKE ALL ON "acme_guardrail_settings_pods" FROM rayin_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "acme_guardrail_settings_pods" TO rayin_app_runtime;
  END IF;
END
$$;
