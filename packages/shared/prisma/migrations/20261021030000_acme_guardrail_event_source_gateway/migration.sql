-- ACME: a guardrail event the worker reconstructs from the gateway's spend log,
-- for an input refused in enforce mode with no verdict (guard_unavailable,
-- guard_unreadable, settings_unusable). CHG-2026-169, ADR-0033.
-- Additive: one new enum value, no row changes, no new table, no grant change.
-- Rollback: acme-governance/rollback/20261021030000_acme_guardrail_event_source_gateway/
ALTER TYPE "AcmeGuardrailEventSource" ADD VALUE IF NOT EXISTS 'gateway';
