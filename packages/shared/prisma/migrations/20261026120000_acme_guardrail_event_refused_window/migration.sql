-- ACME: a refused guardrail event records which part was refused, and how
-- much of the content is stored (blocked-prompt review plan, piece 1).
-- Additive and nullable: rows from before, and from rayin-guardrails builds
-- that do not send these fields, carry none. No change to any upstream table.

-- The first window the judge refused (rayin-guardrails judges long texts in
-- windows): its index, the number of windows, its character positions in the
-- text the rails saw (after redaction), its SHA-256, and whether those
-- positions match the stored content exactly (false when card masking
-- changed the stored text's length). No text.
ALTER TABLE "acme_guardrail_events" ADD COLUMN "refused_window_index" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "refused_window_count" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "refused_window_start" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "refused_window_end" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "refused_window_sha256" TEXT;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "refused_window_positions_exact" BOOLEAN;
ALTER TABLE "acme_guardrail_events" ADD CONSTRAINT "acme_guardrail_events_refused_window_sha256_check"
    CHECK ("refused_window_sha256" IS NULL OR "refused_window_sha256" ~ '^[0-9a-f]{64}$');

-- The stored content's length in characters before encryption (for a stored
-- head: the whole text's length), and whether it is only the head of a longer
-- text (a refusal for size keeps a capped, scanned head).
ALTER TABLE "acme_guardrail_events" ADD COLUMN "content_chars" INTEGER;
ALTER TABLE "acme_guardrail_events" ADD COLUMN "content_truncated" BOOLEAN;
-- For a stored head only: the SHA-256 of the whole text, which is not stored.
ALTER TABLE "acme_guardrail_events" ADD COLUMN "content_sha256" TEXT;
ALTER TABLE "acme_guardrail_events" ADD CONSTRAINT "acme_guardrail_events_content_sha256_check"
    CHECK ("content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$');

-- No new table, so no new grants: rayin_guardrails_writer holds INSERT on the
-- table, which covers new columns.
