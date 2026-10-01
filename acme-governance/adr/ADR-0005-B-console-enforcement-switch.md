# ADR-0005-B: A console switch for the guardrail enforcement mode

| | |
|---|---|
| **Change ID** | CHG-2026-089 · Tier 1 (decides whether AI requests can be refused). Part a: CAIRO-held guardrail settings, audited and applied to every replica, starting with the existing policy controls. Part b: the enforcement switch |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released |
| **Status** | Proposed: design only. Nothing is built or changed by this document |
| **Type** | Forward |
| **Date** | 2026-10-01 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Parent** | ADR-0005 (record, then enforce) and its §5 Step 4 gates. ADR-0005-A (key-level exclusion) is unchanged |

## 1. Purpose

On 2026-10-01 the owner asked for a switch inside CAIRO that moves the guardrail from record mode to block mode, and back.

**Today, the mode is a gateway setting, not a CAIRO control:**
- The gateway's guardrail hook reads `CAIRO_GUARDRAIL_MODE` (`record`, the default, or `enforce`) once, when the gateway pod starts.
- Changing it means a configuration change and a gateway restart. The console can neither see the mode nor change it.

**The policy is already in the console.** The Governance Controls › Guardrails page sets which personal-data types are detected, and whether the jailbreak and topic checks run. It is applied to the guardrails service at once.

This ADR makes the mode a CAIRO control alongside the policy, and sets the bar any CAIRO-held guardrail setting must meet, policy included.

## 2. Requirements

| # | Requirement | Why |
|---|---|---|
| Q1 | **Audited.** Every change writes CAIRO's audit log before and after, with who, when, from what to what, and a reason | A change of mode decides whether requests are refused. It must be as traceable as a key change (ADR-0003) |
| Q2 | **Durable.** CAIRO stores the desired settings. A restart of the gateway or of any guardrails pod restores them without a person acting | A setting that silently reverts to its default after a restart is not a control |
| Q3 | **Applied everywhere.** Every replica of the gateway and of the guardrails service applies the same settings within a stated time, and the console shows whether they all have | There are two replicas of each since CHG-2026-088. A change applied to one replica is a split policy |
| Q4 | **Bounded by the deployment.** The console can choose enforce only where the deployment allows it | Enforcing in a deployment that is not ready is an outage. The allowance is an infrastructure decision, separate from the console click |
| Q5 | **Safe failure.** Behaviour while settings cannot be read is defined, and matches ADR-0005: record fails open, enforce fails closed | No ambiguous state |
| Q6 | **Visible.** The console shows the desired mode, the effective mode per replica, the allowance and the last change | Today nobody can see the mode without cluster access |

## 3. Decision

### 3.1 CAIRO stores the settings

- **One versioned record per deployment,** in a new ACME table in CAIRO's Postgres, holds:
  - the mode;
  - the policy (personal-data types, jailbreak check, topic check);
  - a version number;
  - who changed it, when and why;
  - an optional revert time.
- **The mode is deployment-wide,** because the gateway is shared by every project. Per-key choices come with ADR-0020 R1.
- **The policy toggles move to this record.** The console's existing policy form writes here instead of straight to one guardrails pod.

### 3.2 The guardrails service distributes them

- **Each guardrails pod pulls the settings from CAIRO,** at start and then every 30 seconds.
  - It uses an internal, authenticated CAIRO endpoint with the existing admin shared secret.
  - A restart therefore restores the settings (Q2), and every replica converges (Q3).
- **CAIRO's save also notifies each pod** so changes apply at once. The pull is what guarantees convergence.
- **Every guard verdict carries the mode and the settings version** that produced it.
- **If CAIRO cannot be reached,** a pod keeps the last settings it pulled.
- **A pod that has not pulled since it started never reports a mode.**
  - It applies its built-in default policy, which today is the strictest the console offers.
  - It marks its verdicts **settings unknown**, with no mode and no version.
  - It never reports `record` on its own authority: a pod that cannot reach CAIRO must not be able to lower the mode for its share of traffic.

### 3.3 The gateway applies the mode from the verdict, within a ceiling

- **The hook takes the mode from each verdict.** It needs no restart and makes no extra call.
- **Only a verdict with a known settings version can set the mode, and versions only move forward.**
  - Each gateway replica keeps the highest settings version it has seen.
  - A verdict marked settings unknown, or carrying an older version, is treated like a missing verdict (below). So neither an unsynced pod nor a stale pod can lower the mode.
- **A new gateway setting, `CAIRO_GUARDRAIL_MODE_MAX`** (`record` by default, or `enforce`), is the ceiling (Q4).
  - When the verdict says `enforce` but the ceiling is `record`, the hook records and does not refuse. It logs that enforce was requested but not allowed.
  - The existing `CAIRO_GUARDRAIL_MODE` is read as the ceiling, for compatibility.
- **When there is no usable verdict** (the guard is down, slow or garbled, or the verdict's settings are unknown or older than the newest seen), the hook uses the last mode it saw from a usable verdict on that gateway replica:
  - **last mode enforce: refuse.** This is ADR-0005's fail-closed rule.
  - **last mode record: proceed.**
  - **no mode seen since the replica started:** the ceiling decides. `record` proceeds; `enforce` refuses, because an unknown state under an enforce allowance fails closed.

| Situation | Ceiling `record` | Ceiling `enforce`, console `record` | Ceiling `enforce`, console `enforce` |
|---|---|---|---|
| Guard allows | proceed | proceed | proceed |
| Guard blocks | proceed, logged as would-block | proceed, logged as would-block | **refuse** |
| Guard redacts | proceed with original text | proceed with original text | **send redacted text** |
| Guard unavailable | proceed | proceed | **refuse** |

### 3.4 The console switch

The switch lives in Governance Controls › Guardrails, as an **Enforcement** card.

**What it shows:**
- the desired mode;
- the effective mode on each gateway and guardrails replica, taken from the most recent verdicts' mode and settings version;
- the deployment ceiling;
- the last change: who, when and why;
- any pending automatic revert.

**Switching to enforce:**
- **Deployment administrators only.** These are people named in the deployment's own configuration (for example `CAIRO_GUARDRAIL_ADMINS`, a list of sign-in emails). It is not an organisation or project role: the mode applies to every organisation and project on the deployment, so no single organisation's role is the right authority for it.
- The card shows the ADR-0005 §5 Step 4 gate checklist beside the switch, with live figures where CAIRO can compute them: the record-mode would-block rate over a chosen window, guard availability, and p95 added latency.
- It needs a typed confirmation and a reason.
- It offers an **automatic revert** after a set time, for a supervised trial. The default is on, for 30 minutes.
- It is refused, with an explanation, when the ceiling is `record`.

**Switching back to record:** deployment administrators only, by default. Whether a wider group may also switch it off is decision D-B1.

**Records:**
- each change writes the audit log before and after (Q1);
- each change also leaves a guardrail event of type "mode change", so the change appears next to the verdicts it affects.

### 3.5 Delivery order: part a, then part b

- **Part a: the settings mechanism, applied to the existing policy controls.**
  - What it builds: §3.1, the pull and verdict fields in §3.2, the Q1 audit writes and the Q6 status view.
  - It is delivered **first and on its own.** The console's guardrail policy form already exists, and Q1–Q3 must hold for it before anything is added.
  - The mode stays `record` throughout part a, and the gateway hook is not changed in part a.
  - Tests: B2, B3, B7 (the settings endpoint), B8, B9 and B12.
- **Part b: the enforcement switch.**
  - What it builds: §3.3, the ceiling setting, and §3.4's Enforcement card and automatic revert.
  - It is delivered **only after part a's tests pass.**
  - Tests: B1, B4, B5, B6, B10 and B11, and B7 (the switch).

Until part a is live, changes to the guardrail policy in the console are to be avoided, so that the policy stays the same on every replica. This is an owner instruction recorded in the operations records, not something this ADR enforces.

## 4. Impacted components

| Component | Change |
|---|---|
| Web (console) | The settings table and its migration; the Enforcement card; the policy form writing to the table; the audit writes; an internal settings endpoint for the guardrails service; the replica status view |
| rayin-guardrails | Pulls settings from CAIRO at start and every 30 s; accepts a save notification; returns the mode and settings version in each verdict |
| Gateway hook | Takes the mode from the verdict; keeps the last mode per replica; applies the ceiling setting |
| Gateway configuration | `CAIRO_GUARDRAIL_MODE_MAX` (default `record`) |
| Worker | None |

## 5. Tests

| # | Proves | Pass condition |
|---|---|---|
| B1 | The ceiling holds | With the ceiling `record`, enforce chosen in the console still results in record behaviour, and the console says enforce is not allowed |
| B2 | Applied everywhere | After a change, every guardrails replica and every gateway replica reports the new settings version within 30 s |
| B3 | Durable | Restarting one guardrails pod and one gateway pod keeps the chosen mode and policy |
| B4 | Enforce refuses | A prompt the guard blocks is refused, and no model or fallback receives it (ADR-0020 T5) |
| B5 | Fail closed | With the guard unavailable in enforce, requests are refused. In record they proceed |
| B6 | Automatic revert | An enforce trial with a 5-minute revert returns to record by itself, and the change is audited as automatic |
| B7 | Permissions | An Admin cannot switch to enforce. A non-member cannot read the settings endpoint |
| B8 | Records | Each change has audit rows before and after, and a mode-change guardrail event |
| B9 | Policy fixed too | A policy toggle reaches every guardrails replica, survives a restart, and is audited |
| B10 | No downgrade from an unsynced pod | With enforce on, a guardrails pod restarted while CAIRO's settings endpoint is unreachable marks its verdicts settings unknown, and the gateway keeps enforcing for that pod's traffic |
| B11 | No downgrade from a stale pod | After a change from enforce to record and back to enforce, a verdict carrying an older settings version does not change the gateway's mode |
| B12 | Authority | A signed-in user who is an organisation or project Owner, but not a named deployment administrator, cannot change the mode or the policy |

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Enforce is switched on before the deployment is ready, refusing legitimate traffic | Medium | High | The ceiling (Q4); the gate checklist; an automatic revert by default |
| A compromised deployment-administrator session switches enforcement off | Low | High | A named administrator list, not a role anyone can obtain; audit log; mode-change event; an alert on mode change, if the SIEM path is built |
| The guardrails service depends on CAIRO's console being up | Medium | Low | Last pulled settings are kept; the pull only refreshes them |
| Exempt keys stay unchecked in enforce | Certain | Medium | Shown on the Enforcement card next to the switch (ADR-0005-A I-1) |

## 7. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D-B1 | Who may switch enforcement **off** | The deployment administrators, as for on. A wider named group if the owner wants a faster safety-off |
| D-B2 | Automatic revert by default | On, 30 minutes, until ADR-0005's gates are met |
| D-B3 | Ceiling in dev | `record` until the first supervised trial, then `enforce` for that trial window only |
| D-B4 | Pull interval | 30 seconds |

## 8. Not verified

- The exact form of the internal settings endpoint, and whether the existing admin shared secret is the right credential for it.
- How LiteLLM 1.100.1 returns redacted text from a pre-call hook for every request format, including Anthropic's Messages API (ADR-0020 §3.8). To be proven by test B4.

## 9. Revisions

- **2026-10-01, after a security review of this design:**
  - **No downgrade.** A guardrails pod that has not received CAIRO's settings no longer reports `record`, and the gateway ignores unknown or older settings versions (§3.2, §3.3; tests B10 and B11).
  - **Authority.** The authority for the switch and the policy is now a named list of deployment administrators, not an organisation or project Owner role (§3.4, D-B1; test B12).
