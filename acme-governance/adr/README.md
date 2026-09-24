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
