# ADR-0014: Bahrain and Arabic-language coverage in the guardrails (retrospective)

| | |
|---|---|
| **Change ID** | CHG-2026-078 · Tier 1 (guardrails) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | `rayin-guardrails` `v0.3.0`; console `acme-v4.38.0.19` |
| **Status** | Retrospective record: for the owner's review |
| **Type** | **Retrospective** (decisions made 2026-09-27, written 2026-09-27) |
| **Date** | 2026-09-27 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | The owner, in session on 2026-09-27: the staged CPR detector ("go ahead with stage 1"); the merge of `rayin-guardrails#19` and ACME-Rayin #213 and the dev deploy ("merged both, go ahead with the dev deploy"). This ADR text is itself awaiting review |
| **Commits / tag** | `rayin-guardrails` `362eea8` · `v0.3.0`; ACME-Rayin `8c5ebae05` · `acme-v4.38.0.19` |

## 0. Why this ADR is retrospective

CHG-2026-078 was built and deployed as a Tier 1 change without an ADR. It followed the
precedent of the earlier guardrails changes (CHG-2026-045 to -049), none of which has one.
`CHANGE-PROCEDURE.md` §0–§1 requires the ADR during the build, and says an ADR written
afterwards is a procedure failure. This record is that failure, written down rather than
hidden. Whether CHG-2026-045 to -049 need retrospective ADRs too is an open question (§10).

**Where the detail lives.** This repository is public. So the exact detection rules, their
known limits and the measured results are recorded privately: in the `rayin-guardrails`
repository (its changelog entry for `v0.3.0` and the code) and in the private deployment
record for `v0.3.0`. This ADR records the decisions and the reasons for them.

## 1. Purpose

CAIRO's buyers are banks and government bodies in Bahrain. The guardrails' PII detection was
built on English, US-shaped defaults, and the input rail's policy covered only instruction
override and jailbreaks. This change adds Bahrain identifiers and Arabic-language handling to
PII detection, and banking-conduct and personal-data rules to the policy.

## 2. Scope

**In:**
- PII detection:
  - a Bahrain CPR number recognizer (a new entity, `BH_CPR`, on by default);
  - Bahrain phone numbers;
  - Arabic names that follow a title or customer word;
  - Arabic-Indic digits;
  - stopping the English name model from tagging Arabic script.
- The input rail's policy.
- The console's entity lists, so saving the Guardrails page keeps `BH_CPR`.

**Out:**
- the legal mapping (counsel);
- CPR check-digit validation (stage 2);
- an Arabic language model;
- the output rail;
- other GCC national identifiers.

## 3. Decision

- **CPR detection is hybrid and staged.** This was the owner's decision on 2026-09-27. The
  options were:
  - *regex only:* rejected, because every 9-digit account or reference number in banking text
    would be redacted;
  - *regex + rules* and *regex + checksum:* each on its own was rejected in favour of the hybrid;
  - *ML/NLP-assisted:* rejected for the number itself, because a structured identifier gives a
    model nothing to read;
  - *hybrid:* chosen.

  **Stage 1** favours precision, so that ordinary banking text is not redacted. Its exact rules
  and known limits are in the private service repository. **Stage 2** adds the check digit once its formula has
  been validated offline against real CPR lists by someone with legitimate access to them.
  Until then, no formula is assumed.
- **Entities.** CPR numbers get their own entity, `BH_CPR`, with a dashboard toggle. Bahrain
  phone numbers and Arabic names reuse `PHONE_NUMBER` and `PERSON`, so the existing toggles
  cover them.
- **Arabic names** are found by a rule, not a model. An Arabic language model is a separate
  decision, weighing size, licence and hosting.
- **The English name model is ignored on Arabic script.** It can't read Arabic, but it tagged
  Arabic words as names. Because the rails judge the redacted text (CHG-2026-045), those tags
  were hiding parts of Arabic prompts from the rail. English names are unaffected.
- **The input policy** adds banking-conduct and personal-data categories:
  - evading AML/CFT, KYC or sanctions controls;
  - fraud;
  - disclosing a customer's confidential information to someone not entitled to it;
  - bulk extraction, re-identification or inference of sensitive personal data;
  - sending personal data to an unapproved destination.

  These are informed by the Central Bank of Bahrain rulebook and Bahrain's Personal Data
  Protection Law (Law No. 30 of 2018). They are written as categories, not legal citations,
  and counsel confirms the mapping. The policy also:
  - states that it applies in any language;
  - allows questions about the rules and routine single-customer work;
  - says a redaction placeholder is not a violation by itself.

  Its token budget rises to 1024, because a longer policy can mean longer reasoning, and
  running out of tokens blocks every request.
- **The console** accepts `BH_CPR` in the Guardrails page's save and in its config input
  check. Before this, a save silently dropped any entity the page did not know. Either deploy
  order is safe; console first is best.
- **Test data** is synthetic only: the service's tests generate format-valid CPR numbers, and
  no real CPR number appears in any test or evaluation corpus.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | `acmeGuardrailsRouter.ts` and `AcmeGuardrailsTable.tsx`: `BH_CPR` in the entity lists, labelled "Bahrain CPR number" |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations (NeMo, Presidio) | `rayin-guardrails`: new recognizers, the replaced spaCy recognizer, the input rail's policy and token budget. The audit push payload is unchanged (`entity_type` is a free string on CAIRO's side) |

## 5. Database change

None. **Rollback:** `release.sh --redeploy v0.2.2` for the guardrails service, and a revert of
the console commit (`--redeploy` of the previous console tag). No data changes.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| New false positives on ordinary banking or Arabic text | Medium | Medium | Precision-first stage 1; measured against the benign suite after deploy (private record) |
| A longer policy changes the judge's behaviour | Medium | Medium | Measured against the benign suite and the attack corpora after deploy (private record) |
| The regulatory wording misstates CBB or PDPL | Medium | Medium | Categories, not citations; counsel review (Gap Register CMP-11) |
| The check-digit formula is assumed wrongly | — | — | Not used until validated offline (stage 2) |

## 7. Compatibility

- **Backward compatible:** yes. No schema change; the push payload is unchanged.
- **Deploy order:** console first, or both together. With the service first, a save from the
  older page would switch `BH_CPR` off until the console deployed.

## 8. Client-facing notes

Bahrain CPR numbers, Bahrain phone numbers and Arabic names are redacted from prompts. The
Guardrails page has a "Bahrain CPR number" toggle. The input policy covers banking-conduct and
personal-data misuse in any language.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | Passed on the build workstation | `rayin-guardrails`: `ruff` clean; `pytest` 126 passed (66 existing, 60 new). The private repository's CI didn't run, so the local run is the evidence |
| B: staging | `Staging: not available.` | No database change |
| C: post-deploy (dev) | Passed | In-pod runs of the benign suite, the earlier attack corpus and a new English/Arabic banking and personal-data corpus. Results are in the private `v0.3.0` deployment record |

## 10. Assumptions and open questions

- **Counsel** confirms the CBB/PDPL mapping of the policy wording.
- **Stage 2:** the check-digit formula is validated offline, then added.
- **An Arabic language model** for names in free text: size, licence and hosting.
- **CHG-2026-045 to -049** set the precedent this change followed. Should they get
  retrospective ADRs too?
