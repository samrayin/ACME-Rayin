-- ACME: the guardrail enforcement switch (ADR-0005-B part b, CHG-2026-089).
-- Additive except one CHECK constraint, which is widened: no row changes.
-- No change to any upstream table.

-- A settings version may now set the mode to "enforce". Whether enforce takes
-- effect is still bounded by the deployment ceiling, CAIRO_GUARDRAIL_MODE_MAX,
-- on the gateway and on the console (ADR-0005-B §3.3, §3.4).
ALTER TABLE "acme_guardrail_settings" DROP CONSTRAINT "acme_guardrail_settings_mode_check";
ALTER TABLE "acme_guardrail_settings" ADD CONSTRAINT "acme_guardrail_settings_mode_check"
    CHECK ("mode" IN ('record', 'enforce'));

-- An enforce version may carry an automatic switch-back time (owner decision
-- D-B2: on by default, 30 minutes). From that time the version reads as
-- record, and the next pull writes an audited automatic version.
ALTER TABLE "acme_guardrail_settings" ADD COLUMN "revert_at" TIMESTAMP(3);
-- True for a version written by that automatic switch-back.
ALTER TABLE "acme_guardrail_settings" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "acme_guardrail_settings" ADD CONSTRAINT "acme_guardrail_settings_revert_check"
    CHECK ("revert_at" IS NULL OR "mode" = 'enforce');

-- The state the gateway replica that sent a request reported with it, passed
-- through by rayin-guardrails (ADR-0005-B §3.4, build decision C1). Lets the
-- console show each gateway replica's effective mode. Nullable: rows from
-- before part b, and from callers that do not report, carry none.
ALTER TABLE "acme_guardrail_events" ADD COLUMN "gateway_pod" TEXT;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "gateway_mode" TEXT;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "gateway_settings_version" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD CONSTRAINT "acme_guardrail_events_gateway_mode_check"
    CHECK ("gateway_mode" IS NULL OR "gateway_mode" IN ('record', 'enforce'));

-- No new table, so no new grants: the new columns take the privileges the
-- runtime role already holds on these two tables. The append-only triggers on
-- acme_guardrail_settings are unchanged; adding a column with a constant
-- default rewrites no row, so they are not fired.
