-- ACME: a guardrail event for a check the judge model could not answer
-- (Readiness Ledger N-64; CHG-2026-089 part b, phase 2; ADR-0005-B §3.3.1).
-- rayin-guardrails records every such case, in record and enforce mode, so the
-- record-mode evidence is not biased low by the checks that could not run
-- (owner decision 2026-10-02). Additive: one new enum value, no row changes,
-- no new table, no grant change.
ALTER TYPE "AcmeGuardrailEventAction" ADD VALUE IF NOT EXISTS 'unavailable';
