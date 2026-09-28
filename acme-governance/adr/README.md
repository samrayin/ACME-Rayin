# ADR index

Table of contents only — the history of record is `ACME-CHANGELOG.md`.
Procedure: `../CHANGE-PROCEDURE.md`. Template: `../templates/ADR-TEMPLATE.md`.

Numbering: `ADR-0000` is the baseline (system as of 2026-09-19). Retrospective notes
are marked as such and never claim approvals that were not recorded at the time.

| ADR | Title | Type | Status | Date |
|---|---|---|---|---|
| — | *(baseline ADR-0000 and retrospective notes are added in the backfill phase)* | | | |
| [ADR-0001](ADR-0001-ci-permanently-failing-checks.md) | Fix or gate the three CI checks that failed on every PR (CHG-2026-002) | Forward | Accepted | 2026-09-19 |
| ADR-0002 | Security review as a real gate (CHG-2026-003) | Forward | Claimed in the register — not yet written | — |
| [ADR-0003](ADR-0003-cairo-litellm-control-plane.md) | CAIRO as the single control plane for LiteLLM: management and request-log capture (CHG-2026-005, -008, -009) | Forward | Proposed | 2026-09-19 |
| ADR-0004 | Least-privilege database cutover (CHG-2026-010) | Forward | Claimed in the register — not yet written | — |
| [ADR-0005](ADR-0005-gateway-guardrail-hook.md) | Enforcing the guardrail on the gateway path: hook, timeout, latency budget, record-only before fail-closed (CHG-2026-014, revised by -018 and -022) | Forward | Proposed — design only | 2026-09-20 |
| [ADR-0005-A](ADR-0005-A-step0-exclusion-design.md) | Step 0: excluding the judge path from the guardrail hook, and proving it (CHG-2026-023) | Forward | Approved design — nothing built | 2026-09-21 |
| [ADR-0006](ADR-0006-gateway-tracing-into-cairo.md) | Gateway tracing into CAIRO: what is written, where, what it costs in retention, and how it is turned off (CHG-2026-026) | Forward | Accepted — metadata-only, content tracing deferred | 2026-09-23 |
| [ADR-0010](ADR-0010-gateway-model-management.md) | Gateway model management and the complexity auto router: credentials, salt key, endpoint safety, audit, permission and flag (CHG-2026-056) | Forward | Accepted | 2026-09-23 |
| [ADR-0012](ADR-0012-upstream-security-fixes.md) | Adopting upstream Langfuse security fixes ahead of a full version sync: API-key cache eviction and SCIM organization scoping (CHG-2026-076) | Forward | Proposed | 2026-09-26 |
| [ADR-0013](ADR-0013-guardrail-event-history.md) | Guardrail event history: paging, filters, an audited metadata-only export, and who may export (CHG-2026-079) | Forward | Accepted 2026-09-27 by the owner | 2026-09-27 |
| [ADR-0014](ADR-0014-guardrails-bahrain-arabic-coverage.md) | Bahrain and Arabic-language coverage in the guardrails: staged CPR detection, Arabic names, the English name model on Arabic text, and the input policy's banking-conduct and personal-data rules (CHG-2026-078) | **Retrospective** | For the owner's review | 2026-09-27 |
| [ADR-0015](ADR-0015-acme-ai-entry-point-top-bar.md) | The ACME AI entry point moves from a floating corner button to the top bar (CHG-2026-080) | Forward | Accepted 2026-09-27 by the owner | 2026-09-27 |
| [ADR-0016](ADR-0016-console-navigation-sections.md) | Console navigation: section names, order, collapsing, and an opaque top bar (CHG-2026-081) | Forward | Accepted 2026-09-27 by the owner | 2026-09-27 |
| [ADR-0017](ADR-0017-remove-assurance-preview.md) | Removing the Assurance (Preview) demo (CHG-2026-083) | Forward | Proposed | 2026-09-27 |
| [ADR-0018](ADR-0018-logs-one-table-pattern.md) | One table pattern for the Logs page (CHG-2026-084) | Forward | Proposed | 2026-09-27 |
| [ADR-0019](ADR-0019-white-label-naming.md) | White-label naming: CAIRO in page titles, and a display alias for Langfuse's internal environments (CHG-2026-085) | Forward | Proposed | 2026-09-28 |
