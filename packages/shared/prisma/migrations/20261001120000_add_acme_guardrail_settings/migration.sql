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

-- Settings history is append-only by design: a change is a new version.
-- As with acme_guardrail_events, this binds only the least-privilege
-- runtime role, which nothing uses until the cutover (ADR-0004): designed,
-- not yet effective. The role is created by migration 20260917090000.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_app_runtime') THEN
    REVOKE UPDATE, DELETE ON "acme_guardrail_settings" FROM rayin_app_runtime;
  END IF;
END
$$;
