-- ACME: the guardrail's sector policy packs (CHG-2026-151, ADR-0031 phase 1).
-- Additive: one column with a constant default and one CHECK constraint on
-- acme_guardrail_settings. No row changes, no upstream table.

-- The packs whose answer scope a settings version enables, in pack order.
-- rayin-guardrails pulls them with the version (as "sectors") and applies
-- them; it rejects an empty list or an unknown id and keeps the version it
-- has, and reads a version without the field as all six. The default is all
-- six, so every existing version, and the first pull after this migration,
-- carries exactly what the guardrail applied before.
--
-- Adding a NOT NULL column with a constant default is a catalogue change on
-- Postgres 11 and later: existing rows are not rewritten, they read the
-- stored default. So the append-only triggers on this table (BEFORE UPDATE OR
-- DELETE, BEFORE TRUNCATE) are not fired, and no version changes. They stay
-- in place unchanged, as do the runtime role's table-level grants, which
-- cover the new column (SELECT and INSERT on the whole table).
ALTER TABLE "acme_guardrail_settings"
    ADD COLUMN "sectors" TEXT[] NOT NULL
    DEFAULT ARRAY['banking', 'government', 'healthcare', 'hr', 'retail_telecom', 'education']::TEXT[];

-- Never an empty or unknown selection, whoever writes the row: at least one
-- pack, a flat list, no NULL element, every element a known pack id. The
-- console also refuses such a save with a message (acmeGuardrailSettings.ts).
-- Checked against the existing rows, which all hold the default, while the
-- table is locked; quick at a settings table's size. A new pack needs this
-- constraint widened in its own migration, as the mode check was in part b.
ALTER TABLE "acme_guardrail_settings" ADD CONSTRAINT "acme_guardrail_settings_sectors_check"
    CHECK (
        cardinality("sectors") >= 1
        AND array_ndims("sectors") = 1
        AND array_position("sectors", NULL) IS NULL
        AND "sectors" <@ ARRAY['banking', 'government', 'healthcare', 'hr', 'retail_telecom', 'education']::TEXT[]
    );

-- Who can run this: ALTER TABLE needs the table's owner. The table was
-- created by 20261001120000, run as the admin login that applies migrations
-- today (web/entrypoint.sh, DIRECT_URL), so that login owns it and this
-- migration applies as it does. No new table, so no new grants.
