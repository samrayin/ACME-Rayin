# ADR-0031 — Guardrail sector policy packs: chosen in EYEON for the deployment, then per department as a gateway team

| | |
|---|---|
| **Change ID** | CHG-2026-151 (phase 1, built) · CHG-2026-152 (phase 2, design only) · Tier 1 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Phase 1: the first console release after merge, after rayin-guardrails v0.7.0 (tags to be added at release). Phase 2: not scheduled |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-10-12 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Pending. The owner reviews and merges; no self-approval. Not a production approval |
| **Related** | CHG-2026-109 (the sector packs in rayin-guardrails) · rayin-guardrails #34 (its half of phase 1, v0.7.0) · ADR-0005-B (EYEON-held guardrail settings, which phase 1 extends) |
| **Commits / tag** | To be added at merge · release tag to be added at release |

## 1. Purpose
The owner, 2026-10-11: "how to create this in enforcement policies for my guardrail so it can be enabled and utilized across departments". Of the options put to them, the owner chose **"Gateway team"** as what a department is, and **"Phase 1, then 2"** as the order.

Since CHG-2026-109, rayin-guardrails builds its policy from six sector packs, all six always on:

| Id | Pack | Answers may cover |
|---|---|---|
| `banking` | Banking and finance | accounts, cards, payments and transfers, loans and financing (including Islamic finance), financial literacy and regulatory questions |
| `government` | Government services | identity cards, permits, licences, housing, utilities and e-government services |
| `healthcare` | Healthcare | appointments, health centres, pharmacy and prescriptions, test results and general health-service information |
| `hr` | HR and staff services | the organisation's own workplace and employee matters (leave, payroll, benefits, workplace policies, HR procedures) |
| `retail_telecom` | Retail and telecom | orders, returns and refunds, products, mobile and internet plans, bills and technical support |
| `education` | Education | admissions, registration, courses, exams, transcripts and student services |

Which packs apply could not be chosen anywhere: not in EYEON, and not per department. A bank's HR assistant answered as broadly as its customer assistant. This ADR lets a guardrail administrator choose the packs in EYEON, first for the whole deployment (phase 1), then for each department (phase 2).

## 2. Scope
**In:**
- **Phase 1 (CHG-2026-151, built):** one selection of packs for the deployment, stored in EYEON's guardrail settings, served to the guardrail pods, edited on the Guardrails page and shown on the Enforcement and policy page (§3.2).
- **Phase 2 (CHG-2026-152, design only):** a selection per department, where a department is a gateway team (§3.3).

**Out:**
- **The packs' wording** (each pack's topics and conduct rules). It stays in rayin-guardrails, versioned with that service.
- **New packs.** A seventh pack is a rayin-guardrails change plus a console change (the list and the database CHECK, §3.2).
- **Per-project or per-key selections** (the options not chosen, §4).

## 3. Decisions

### 3.1 What a pack decides, and what always applies
A pack sets **only the answer scope**: which topics the guardrail lets answers cover.

**Whatever packs are enabled, these always apply:**
- every pack's **conduct rules**, including those of packs that are not enabled;
- the **universal rules**: personal data, fraud, general harm, and jailbreak and prompt injection;
- the rest of the policy as it stands: the personal-data types, the jailbreak and topic checks, the mode (record or enforce) and its ceiling.

The Policies card and the Enforcement and policy page say so beside the packs: "Packs set only which topics answers may cover. Every pack's conduct rules and the universal protections (personal data, fraud, general harm, jailbreak and prompt injection) apply in every case, whichever packs are enabled."

### 3.2 Phase 1: one selection for the deployment (CHG-2026-151)
- **Storage:** each guardrail settings version (`acme_guardrail_settings`, append-only, ADR-0005-B) gains `sectors`, the enabled pack ids in pack order.
  - **Migration** `20261011120000_acme_guardrail_sector_packs`: `TEXT[] NOT NULL`, default all six. Existing versions, and the first pull after the migration, carry exactly what the guardrail applied before.
  - **A CHECK** holds the column to at least one pack, a flat list, no NULL element and known ids only, whoever writes the row.
  - **No rows are rewritten** (a constant default is a catalogue change), so the append-only triggers do not fire. The runtime role's table grants (`SELECT`, `INSERT`) cover the column; nothing is granted.
- **Validation on save:** `updateConfig` takes `sectors`. The shared zod schema (`guardrailSectorPacks.ts`) refuses an empty selection or an unknown id with a message in words, as a bad request, before anything is read. A valid selection is de-duplicated and stored in pack order. A save without `sectors` keeps the packs in force.
- **Every new version carries the packs.** These are all the places a version is written:
  - `saveSettings` (the Policies card's save): the packs sent, or those in force;
  - `saveMode` (the enforcement switch): those in force;
  - `applyExpiredRevert` (the automatic switch-back, after a trial or under a record ceiling): those in force.

  The migration's seeded first version takes the column's default.
- **Served to the pods:** the pull (`POST /api/public/guardrails-settings`) includes `sectors` with every version.
- **The contract with rayin-guardrails** (v0.7.0, rayin-guardrails #34):

  | What a version carries | What the service does |
  |---|---|
  | `sectors` absent | applies all six |
  | a non-empty list of known ids | applies them; a repeated id counts once |
  | an empty list, an unknown id, an explicit `null`, a string, or items that are not strings | refuses the whole version (`invalid_settings`); the pod keeps its last settings |

  EYEON never stores a selection the service would refuse (the zod check and the database CHECK). The service's `GET /v1/config` shows the packs it applies.
- **Who changes them:** as for the rest of the policy (ADR-0005-B §3.4). A named guardrail administrator (`CAIRO_GUARDRAIL_ADMINS`), on a deployment where open sign-up is closed, whose project role is not one of the content-free roles. The Security Analyst, Business Analyst and Auditor stay read-only: `updateConfig` is on none of their server allow-lists.
- **Audit:** each change is a new version and an audit-log entry with the packs before and after, in the same transaction.
- **On screen:**
  - **Guardrails page, Policies card:** a "Sector policy packs" section with six switches, each with its label and one-line scope, and the note of §3.1. It saves with the rest of the card, through the existing save flow and its required reason.
    - The last enabled pack cannot be switched off.
    - The section is read-only wherever the card is.
    - While the Topical Rail is off, the section says the packs change no answer, because that check is what keeps answers to the enabled packs' topics.
  - **Enforcement and policy page:** the packs in force by label, how many of six, those not enabled, and the note. Display only. The router returns the packs in force as ids and labels from the settings it already reads; no new read.

### 3.3 Phase 2: a selection per department (CHG-2026-152, design only)
Nothing in this section is built. It fixes the design so phase 1 does not close it off.

- **A department is a gateway team** (LiteLLM's team, which EYEON already manages and audits, ADR-0003). Every application key belongs to at most one team, so a request has one department, taken from its key.
- **Each team's packs are set in EYEON.**
  - **Where they are stored:** in the same settings versions, as a map from team id to packs. One version number still names the whole guardrail policy; the pods still report one version; changing a team's packs writes a new, audited version; and every path in §3.2 copies the map forward as it copies `sectors`.
  - **How each team's selection is checked:** as the deployment's (at least one known pack).
  - **Who sets them:** the authority of §3.2.
  - **On screen:** a per-team list on the Policies card, with the gateway teams from the LiteLLM management screens.
- **A team with no selection uses the deployment's packs.** So does a request with no team, or with a team EYEON has no entry for.
- **The gateway hook sends the team from the authenticated key, never from caller fields.**
  - **Where it reads the team:** `integrations/litellm/config/cairo_guardrail_hook.py` already reads `user_api_key_team_id`, which the proxy injects after authentication. The hook sends that value as the request's team.
  - **When it trusts it:** only when every place the proxy injects it agrees, as the hook already does for key-level opt-outs (`_key_level_opt_outs`). Disagreement is the signature of a forgery attempt, and is read as "no team", so the deployment's packs apply.
  - **What it never reads:** a team named in the request body, its metadata, the `user` field or a header.
- **The guardrails service caches one rules engine per pack set.** Today it holds one engine per pod, cached by the rail flags plus the sector set (rayin-guardrails #34). Phase 2 needs a larger bound, one engine per distinct pack set in use. The bound is set after measuring an engine's memory; past it, the least recently used engine is dropped and rebuilt on demand.
- **Each decision records the team and the packs applied.** Guardrail events gain the team id and the packs used (nullable: older events and requests without a team carry none). The Guardrail decisions page can filter by department (the team), shown by the team's name.

### 3.4 Options not chosen
| Option | Why not |
|---|---|
| **A department is an EYEON project** | EYEON creates gateway keys from a project, but the gateway itself knows only the key and its team. The project would have to be written into every key's metadata and trusted from there: a second identity for what a team already is. A project also holds traces, prompts and people, and one department may span several projects. The owner chose the gateway team. |
| **A selection per application key** | Too fine to administer. A department runs many applications, each its own key lineage (ADR-0023). Every new application would start without its department's packs until someone set them, and a missed one would silently get the deployment's. |
| **LiteLLM's own per-team guardrails** | An Enterprise feature of LiteLLM. EYEON uses only LiteLLM's open-source features (ADR-0003, ADR-0005 §3a). It would also split the policy between two places, outside EYEON's versions and audit. |

## 4. Release order
- **Phase 1:**
  1. **rayin-guardrails v0.7.0 first** (rayin-guardrails #34). It applies `sectors` when present and all six when absent, so it runs correctly against the current console.
  2. **Then this console release.** Released first, the console would offer a choice that v0.6.1 does not apply: v0.6.1 ignores `sectors` and applies all six whatever is chosen.
- **Phase 2:**
  1. the guardrails service that understands teams;
  2. then the console that stores and serves the team map;
  3. then the gateway hook that sends the team.

  Each step works with the one before, and a team's packs take effect only once all three are out.

## 5. Rollback
- **The console (phase 1):** per `acme-governance/rollback/20261011120000_acme_guardrail_sector_packs/ROLLBACK.md`.
  1. Save a version with all six packs.
  2. Redeploy the previous console image, which serves no `sectors`, so the pods apply all six.
  3. Only if the column must go, run `down.sql`. It refuses while the version in force narrows the packs, so a rollback never widens the answer scope without an audited version.

  Data lost: the stored selections; the audit log keeps them.
- **The guardrails service:** back to v0.6.1 is safe only while the console's selection is all six (rayin-guardrails #34). Enable all six in the console first.
- **Phase 2:** each step is undone in the reverse of its release order. With the hook back, no team is sent, and the deployment's packs apply to everyone.

## 6. Consequences and risks
- **What a narrower selection does:** answers outside the enabled packs' topics are withheld (in enforce) or recorded as would-be refusals (in record), exactly as off-topic answers are today. Every conduct rule still applies.
- **A seventh pack is a coordinated change:** the guardrails service, the console's list, and a migration widening the CHECK, as the mode check was widened in ADR-0005-B part b.
- **Migration ownership (pre-existing):** migrations run as the admin login, which owns `acme_guardrail_settings`. `rayin_migrator` is refused ("must be owner"), as it would be for every ACME table created after `20260917090000`. The planned move of migrations to `rayin_migrator` (Readiness Ledger P0-5) must hand those tables to it first.
- **Phase 2 cost:** one rules engine per pack set in use, bounded after measurement (§3.3).

## 7. Verification (phase 1)
- **Server unit tests:**
  - validation (empty, unknown, null, a string, non-string items, de-duplication, pack order);
  - carry-forward through `saveSettings`, `saveMode`, both automatic switch-back cases, and a save without `sectors`;
  - the audit entry's before and after;
  - what the pods are served, including a row read without the field (all six);
  - the router: content-free roles refused before the database, messages in words for a refused selection, and a save and read-back;
  - the public endpoint end to end;
  - the Enforcement page's router and figures.
- **Client tests:** the six switches, the last pack locked on, read-only for content-free roles and non-administrators, the save through the existing flow with its reason, and the Enforcement page's packs.
- **Migration:** rehearsed on a throwaway local Postgres 16.4 with Azure-like roles: up through Prisma, no table rewrite, the triggers intact, twelve constraint, grant and trigger checks, the down guard under three runners, down and up again (see the ROLLBACK.md).
- **Not yet verified:** the release in dev, and a pull by a v0.7.0 pod that applies a narrowed selection. Both need the owner's go.

## 8. Open questions for the owner
1. **Topical Rail off:** the console tells the administrator that packs change no answer while the Topical Rail is off. Please confirm this matches rayin-guardrails v0.7.0 (CHG-2026-109 builds the output, or topical, rail from the packs).
2. **Phase 2 storage:** a team map inside the settings versions (one version number for the whole policy) rather than a table of its own. Accept, or prefer a separate, also append-only, table?
3. **Phase 2 display:** show each department by the gateway team's name in decisions and filters, which content-free roles would then see. Acceptable, or show the team id only?
