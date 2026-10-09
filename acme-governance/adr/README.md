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
| [ADR-0005-B](ADR-0005-B-console-enforcement-switch.md) | A console switch for the guardrail enforcement mode, and CAIRO-held guardrail settings that are audited and applied to every replica (CHG-2026-089) | Forward | Proposed | 2026-10-01 |
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
| [ADR-0020](ADR-0020-cairo-front-door.md) | CAIRO as the front door for AI traffic: one endpoint, no bypass, in-path observability, model routing (CHG-2026-086) | Forward | Proposed | 2026-09-30 |
| [ADR-0021](ADR-0021-cairo-customer-aws-deployment.md) | CAIRO in a customer's own AWS account: architecture, residency, identity and egress control (CHG-2026-087) | Forward | Proposed — parked by the owner 2026-09-30 | 2026-09-30 |
| [ADR-0023](ADR-0023-applications-page.md) | The Applications page: one console screen per connected application (a key lineage), from data EYEON already holds. Phase 1, the scorecard and executive summary, built under CHG-2026-122; phase 2 (a detail screen) and phase 3 (one trace per request, feasibility) proposed (CHG-2026-115) | Forward, written after phase 1 shipped | Accepted | 2026-10-07 |
| [ADR-0024](ADR-0024-strip-enterprise-code-from-release-images.md) | Stripping the Langfuse Enterprise code from release images at build time: the mechanism and why a bundler alias and repository deletion were rejected, the stubs, clean-room authorship, verification and a rollback that can never return a customer to an Enterprise image (CHG-2026-123) | Forward | Proposed — counsel has not confirmed it | 2026-10-06 |
| [ADR-0025](ADR-0025-customer-logo.md) | The customer's own logo from UI Customization: organization scope, its own table rather than organization metadata (which every session carries) or blob storage, raster formats only, the size and dimension limits and the size note, how the sidebar shows and gets it, audit entries (CHG-2026-124) | Forward | Accepted | 2026-10-06 |
| [ADR-0026](ADR-0026-adopting-the-eyeon-prototype.md) | Adopting the EYEON prototype's look and feel in the fork: a layered build (tokens, shell, a shared UI layer, EYEON-native pages, a Langfuse-text clean-up), slice 0's dark palette without a flag, the accent as primary in dark mode, fixed chart colours (CHG-2026-130) | Forward | Accepted | 2026-10-07 |
| [ADR-0027](ADR-0027-eyeon-native-pages.md) | EYEON-native pages: one read-only, metadata-only router per page under the summarised page's access rule, content-free allow-list entries and per-role tests including the denial cases, a server-only flag per page with the classic fallback, honest labels (Not recorded, Preview) as states of a figure, and the shared EYEON UI kit and charts; the overview is the first instance (CHG-2026-132) | Forward | Proposed | 2026-10-07 |
| [ADR-0029](ADR-0029-langfuse-text.md) | User-visible "Langfuse" text: accepts ADR-0019 apart from §2 and supersedes §2. Screens say EYEON or use neutral wording, the API reference is "EYEON API Reference", one "Built on open-source Langfuse (MIT)" line goes on an About / Open-source licences page (defined, built later), "Built-in" replaces "Maintained by Langfuse", and langfuse.com docs links and onboarding videos go; internal names and the MIT notice stay. The ten most visible strings now, then phases after the upstream sync; a CI guard with a frozen, shrink-only baseline fails on new text (CHG-2026-146) | Forward | Proposed | 2026-10-09 |
