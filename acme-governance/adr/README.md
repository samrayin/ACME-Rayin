# ADR index

Table of contents only — the history of record is `ACME-CHANGELOG.md`.
Procedure: `../CHANGE-PROCEDURE.md`. Template: `../templates/ADR-TEMPLATE.md`.

Numbering: `ADR-0000` is the baseline (system as of 2026-09-19). Retrospective notes
are marked as such and never claim approvals that were not recorded at the time.

| ADR | Title | Type | Status | Date |
|---|---|---|---|---|
| — | *(baseline ADR-0000 and retrospective notes are added in the backfill phase)* | | | |
| [ADR-0001](ADR-0001-ci-permanently-failing-checks.md) | Fix or gate the three CI checks that failed on every PR (CHG-2026-002) | Forward | Accepted | 2026-09-19 |
| [ADR-0002](ADR-0002-security-review-real-gate.md) | Make the AI security review a gate, enforceable once required on `main` (CHG-2026-003); supersedes ADR-0001's opt-in switch for that check | Forward | Proposed | 2026-09-19 |
| [ADR-0003](ADR-0003-cairo-litellm-control-plane.md) | CAIRO as the single control plane for LiteLLM: management and request-log capture (CHG-2026-005, -008, -009) | Forward | Proposed | 2026-09-19 |
