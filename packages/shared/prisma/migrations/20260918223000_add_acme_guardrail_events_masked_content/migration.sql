-- ACME: guardrail masked content (Security Analyst RBAC design, PR 2 of 3).
--
-- masked_content_encrypted -- what was typed, with every PII entity replaced
-- by an <ENTITY_TYPE> placeholder by rayin-guardrails (Presidio, at decision
-- time, independent of the live PII policy toggles) and card numbers masked
-- unconditionally. Pushed for every action (allow, redact, block) and
-- encrypted server-side with GUARDRAILS_ENCRYPTION_KEY before the write,
-- same as raw_content_encrypted. Shown on demand to OWNER/ADMIN/SECURITY via
-- acmeGuardrails.maskedContent, and every view is audit-logged.
--
-- Owner decision 2026-09-18: content is now stored for allowed events too
-- (reverses the metadata-only rule for allow in
-- POSTGRES-COMPLIANCE-FRAMEWORK.md §1.1; see the dated decision there).
--
-- Additive and nullable: pods still running the previous image during the
-- rollout keep inserting successfully, and existing rows stay NULL. No
-- backfill -- this is an append-only audit table. Table-level INSERT
-- (rayin_guardrails_writer) and SELECT/INSERT (rayin_app_runtime) grants
-- already cover new columns; no grant changes are needed.

ALTER TABLE "acme_guardrail_events"
  ADD COLUMN "masked_content_encrypted" TEXT;
