# ADR-0029 — User-visible "Langfuse" text: EYEON or neutral wording, one attribution line, and a guard against new text

| | |
|---|---|
| **Change ID** | CHG-2026-146 · Tier 1 (client-visible text) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The first console release after merge (tag to be added at release) |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-10-09 |
| **Author** | Claude session (Opus 5.5), for the owner |
| **Approval** | Pending. The owner set the rules on 2026-10-09 (§1) and accepts this ADR after review; no self-approval |
| **Supersedes** | ADR-0019 §2. Accepts the rest of ADR-0019 (§3.1) |
| **Commits / tag** | To be added at merge · release tag to be added at release |

## 1. Purpose
ADR-0019 (CHG-2026-085) named the product in browser tab titles and gave Langfuse's internal environments a display alias. Its §2 left out every page that names Langfuse as the upstream: the API reference, the "maintained by Langfuse" labels and the links to langfuse.com documentation. Since then the product has become EYEON (CHG-2026-121), customers may install it air-gapped, and ADR-0026 §10.5 asked for §2 to be superseded before a clean-up of the remaining "Langfuse" text started.

The owner's rulings of 2026-10-09:
> 1. Supersede: yes. Write a new ADR under one change ID that: (a) formally accepts ADR-0019 apart from §2 (b) supersedes §2 with the rules you proposed: EYEON or neutral visible text, "EYEON API Reference", one "Built on open-source Langfuse (MIT)" line on an About / Open-source licences page, internal names and the MIT notice unchanged. Mark it Proposed. I'll accept it after review.
> 2. Docs links and onboarding videos: remove them for now. Don't write offline help in this change.
> 3. "Built-in" replaces "Maintained by Langfuse": agreed.
> 4. Timing: Now: the ADR, the 10 most visible strings, and the CI guard. The CI guard must use a frozen baseline allowlist of current hits, so it only fails on NEW visible "Langfuse" text. Report the baseline count. After the pending upstream update: the bulk text and links, the 9 email templates, and the icons, in phases. Each phase shrinks the allowlist.

## 2. Scope
**In (this change):** the rules (§3.2); the ten most visible strings (§3.4); the CI guard and its frozen baseline (§3.5).

**Out:**
- **Later phases, after the upstream update (CHG-2026-100):** the bulk text and links, the 9 email templates, the icons in `web/public`, the onboarding videos, and building the About / Open-source licences page (§3.3, §3.6).
- **Offline EYEON help:** a separate, later item. It is not part of this change, and nothing here replaces a removed link.
- **Anything under an `ee/` directory:** ACME never edits it (CHG-2026-058), and the guard does not scan it.
- **Internal names** (§3.2, rule 6).

## 3. Decision

### 3.1 ADR-0019 is accepted apart from §2
- **Accepted as built:** ADR-0019's decisions (§3) and its addenda §11 (part b, the Pages Router not-found page), §12 (part c, the App Router's not-found page) and §13 (part d, the built-in dashboards' names).
  - One place names the product: `acmeBranding.ts`, with `ACME_PRODUCT_NAME` and `acmePageTitle`.
  - Langfuse's internal environments get a display alias; the stored `langfuse-*` values do not change.
- **The product name in them is now EYEON (CHG-2026-121):**
  - `ACME_PRODUCT_NAME = "EYEON"`, so titles read "… | EYEON";
  - the environment alias reads `eyeon-…`;
  - the built-in dashboards read "EYEON …".
- **When the owner accepts this ADR,** ADR-0019's status line and its row in the ADR index change to "Accepted apart from §2 (superseded by ADR-0029)". Until then both stay as they are.

### 3.2 The rules that replace ADR-0019 §2
1. **User-visible text says EYEON** (`ACME_PRODUCT_NAME`) or uses neutral wording.
2. **The API reference page is titled "EYEON API Reference".**
3. **Exactly one attribution line,** "Built on open-source Langfuse (MIT)", on an About / Open-source licences page (§3.3). It is the only visible "Langfuse" the screens keep.
4. **"Built-in" replaces "Maintained by Langfuse".** This covers every form of that label: "Langfuse maintained", "Langfuse managed" and the "Langfuse" badge on built-in widgets and models. The label comes from one constant, `ACME_BUILT_IN_LABEL` in `acmeBranding.ts`.
5. **Links to langfuse.com documentation and the onboarding videos are removed for now.** They are not replaced. Offline EYEON help is a separate, later item.
6. **Unchanged:**
   - **Internal names:**
     - stored environment values (`langfuse-*`);
     - `LANGFUSE_*` settings;
     - package names such as `@langfuse/*`;
     - SDK snippets and code examples, including the copied prompt that installs Langfuse's agent skill;
     - the public API and MCP surface: tool names and descriptions, the API reference's MCP name, and the generated OpenAPI specification;
     - `owner: "LANGFUSE"` values and every comparison on them;
     - identifiers and file names.
   - **The MIT licence and copyright notices in the code:** `LICENSE`, file headers, and `web/third-party-licenses`.

### 3.3 The About / Open-source licences page: defined here, built later
- **What it shows:**
  - the product name and the console's version;
  - the one line "Built on open-source Langfuse (MIT)";
  - the MIT licence text and copyright line of the Langfuse code it is built on (the MIT part of `LICENSE`);
  - the notices of third-party components shipped in the image, such as the API reference's bundled Scalar notice in `web/third-party-licenses`.
- **Its tab title** is "About | EYEON".
- **No external links.** Every text is served from the image, so the page works air-gapped.
- **Who can open it:** every signed-in person, from an "About" item in the top bar's user menu. It needs no scope.
- **Not trivial, so it is a later phase:**
  - it needs a new route and page;
  - it needs a user-menu entry, in a file on the CHG-2026-100 conflict list (CHG-2026-134);
  - the licence texts have to be packaged into the image;
  - it needs tests.
- **The guard is ready for it now** (§3.5): the attribution line is never baselined, and it may appear once.

### 3.4 Now: the ten most visible strings
They are ranked by how often a person using EYEON meets them in a self-hosted install. Langfuse Cloud-only screens never render in EYEON, so they were not candidates.

| # | Where | Before | After | Why it made the list |
|---|---|---|---|---|
| 1 | "Maintained by" labels (one item): models table, model page, model-match card, evaluator tables and template pickers, evaluator peek, dashboard widget badge and its copy dialog | "Langfuse maintained", "Maintained by Langfuse", "Langfuse managed evaluators", a "Langfuse" badge | "Built-in", "Built-in evaluators", "Built-in (Ragas)", "is built-in" | The owner's ruling 3. Every model and every evaluator template in the console carries one |
| 2 | API reference (`pages/api/docs.ts`) | "Langfuse API Reference" | "EYEON API Reference" | The owner's ruling 1 |
| 3 | Organizations page banner (`AgentToolsBanner`) | "the Langfuse Agent Skill, MCP server, and CLI." | "the Agent Skill, MCP server, and CLI." | It is on the landing page after every sign-in until dismissed, and the owner named it |
| 4 | Version-update banner | "Langfuse just got an update" | "EYEON just got an update" | Every open tab sees it after each release. The owner named it |
| 5 | Error toast button | "Report issue to Langfuse team" | "Report issue" | It is on every error toast, on every page |
| 6 | Organizations page, "Get Started" card | "…to get started with Langfuse." | "…to get started with EYEON." | It is the first screen for anyone signed in before being invited to an organization |
| 7 | Project settings, General: host name | "When connecting to Langfuse, use this hostname / baseurl." | "When connecting to EYEON, …" | General is the first settings page of every project |
| 8 | Tracing empty state, description | "…add observability with Langfuse to your application." | "…with EYEON…" | It is the first screen of every new project |
| 9 | Tracing empty state, first step | "Your application needs API keys to send traces to Langfuse." | "…to EYEON." | It is on the same screen, in the step everyone has to take |
| 10 | Prompt Management empty state | "Langfuse Prompt Management helps you…" | "Prompt Management helps you…" | Prompt Management is a top-level category, and projects that do not use it see this every visit |

**Areas checked where nothing qualified:**
- **Sign-in and sign-up:** in a self-hosted install no visible text says Langfuse. ADR-0019 titled these pages; what remains is the logo (an icon, later phase) and Langfuse Cloud-only notices.
- **The sidebar:** the wordmark says EYEON. "Your Langfuse Orgs" shows only inside Langfuse's demo project, and upstream's promotional cards are already off (CHG-2026-025).
- **The top bar:** only the brand link's accessible name, "Langfuse home", on phones, and the icon's alt text (icons phase).
- **The command palette:** it lists route, settings and dashboard names, and none of them says Langfuse.
- **Home:** the fallback name "Langfuse Home" shows only when the built-in Home dashboard row is missing or cannot be read.

**Upstream files:** 19 files, each edit marked "ACME (CHG-2026-146)" and a few lines long. The maintainer icon now keys on the "Built-in" label instead of the word "Langfuse". Its accessible name is now "Maintainer: …", because "Maintained by Built-in" does not read. A client test pins every replaced line, so a sync cannot bring the old text back unnoticed.

### 3.5 The CI guard
- **The script:** `scripts/ci/check_langfuse_text.py`, Python standard library only, like the gateway hook tests' gate. It implements the read-only scan behind the counts in §3.8. On main at `ab9c908f1` it gives identical counts for all three roots.
  - **Files:** tracked (and untracked, not ignored) `.ts`, `.tsx`, `.js`, `.jsx`, `.mdx`, `.html` and `.json` files under `web/src`, `packages/shared/src` and `worker/src`.
  - **Excluded:** tests (`__tests__`, `__e2e__`, `*.test.*`, `*.spec.*`, `*.clienttest.*`, `*.servertest.*`), stories, any `ee/` directory, `node_modules`, `generated`, `.next` and `*.md`.
  - **Visible text:** a line with the whole word "Langfuse", capital L. So `LangfuseLogo`, `@langfuse/…` and `LANGFUSE_*` do not count. Comment lines and import, export-from and require lines do not count either.
  - **Links:** a line containing "langfuse.com", in any case and any subdomain, with the same exclusions.
- **The baseline:** `acme-governance/langfuse-text-baseline.json`, generated once from the tree after the ten edits.
  - Each path maps to its categories (`text`, `link`). Each category holds the trimmed line texts allowed there, as a multiset, so moving lines does not break it.
  - A line over 240 characters is kept as its first 160 characters, its length and a SHA-256 of the whole line. This is still an exact match. Test fixtures and prompts hold lines of up to 77,000 characters, which would make the file about 850 KB instead of about 100 KB.
- **What it does:**
  - **New hits:** it fails on any hit beyond what the baseline allows for that file and category. It lists each as `file:line [category] text`, as a GitHub annotation in CI, followed by a short how-to-fix: use EYEON or neutral wording, add no langfuse.com link, and never add new text to the baseline by hand.
  - **Moved files:** a file that only moved takes its existing entries to its new path in the same PR, for the reviewer to check.
  - **Stale entries:** it reports baseline entries that no longer occur (a warning in CI). `--shrink` removes them and never adds an entry. No mode of the script adds entries.
  - **Counts:** it prints the counts per root and in total, found and allowed. `--list` prints every hit.
- **The attribution line:** a line whose only "Langfuse" is inside "Built on open-source Langfuse (MIT)" counts as `attribution`, not `text`. It cannot be baselined. A second copy anywhere fails the check, which enforces "exactly one".
- **The workflow:** `.github/workflows/acme-langfuse-text-guard.yml`, in the style of the other ACME gates.
  - It runs on pull requests that touch the three roots, the script, its tests, the baseline or the workflow.
  - It has `contents: read` only, a checkout pinned by SHA with `persist-credentials: false`, and no secrets.
  - It runs the script's unit tests, then the check.
- **Rejected:**
  - **A Node script:** Python matches the scan's regular expressions exactly, and ubuntu runners have `python3` with no setup step, as the other ACME gates use it.
  - **A check of only the lines a PR adds:** the owner asked for a frozen allowlist, and a diff check misses text that is moved or copied between files.
  - **Copying very long lines into the baseline:** see the fingerprint above.

**Baseline counts** (main at `ab9c908f1` plus this change):

| Root | Visible text | langfuse.com links |
|---|---|---|
| `web/src` | 269 lines in 155 files | 260 lines in 121 files |
| `packages/shared/src` | 139 lines in 37 files | 35 lines in 16 files |
| `worker/src` | 31 lines in 14 files | 3 lines in 3 files |
| **Total** | **439 lines in 206 files** | **298 lines in 140 files** |

That is 737 entries in all. In `web/src`, the ten edits removed 23 text lines from 19 files, and 15 of those files now hold none (292 lines in 170 files before). This step removed no links (§2).

### 3.6 Phasing
- **Now (this change):** this ADR, the ten strings and the guard with its baseline.
- **After the pending upstream update (CHG-2026-100), in phases.** Each phase runs `--shrink` and commits a smaller baseline. The order is the owner's call:
  - the bulk text and links: `web/src` first, then `packages/shared/src` and `worker/src`. This includes the page-header help links and the empty states' "Learn more" links;
  - the 9 email templates (`packages/shared/src/server/services/email/*`);
  - the icons in `web/public`, with the icon components' alt text ("Langfuse", "Langfuse Logo") and the top bar's "Langfuse home";
  - the onboarding videos (the `static.langfuse.com` video references);
  - the About / Open-source licences page (§3.3).

### 3.7 Licence and air-gap notes
- **Licence:**
  - MIT permits rebranding the screens. It requires the copyright and permission notice to stay with copies of the software, not the name on screen.
  - The notice stays with the code (`LICENSE` is unchanged), and the About page will also show it.
  - The Enterprise code is already stripped from release images (CHG-2026-123, ADR-0024; counsel has not confirmed that approach), so its text never reaches a customer. This change neither edits nor scans it.
- **Air-gapped installs:** links to langfuse.com and its videos are dead ends there. This is one reason the clean-up is a readiness item and not cosmetics.

### 3.8 The fresh counts
These come from a read-only scan of main at `ab9c908f1`, by the method in §3.5:

| Root | Visible "Langfuse" text | langfuse.com links |
|---|---|---|
| `web/src` | 292 lines in 170 files | 260 lines in 121 files |
| `packages/shared/src` | 139 lines in 37 files | 35 lines in 16 files |
| `worker/src` | 31 lines in 14 files | 3 lines in 3 files |

- **Email templates:** 9 kinds.
- **Video references:** 17 lines in 11 files.
- **The prototype plan's earlier estimates for the console:** about 277 lines in 164 files of text, and about 290 links in 135 files.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | `acmeBranding.ts` gains `ACME_BUILT_IN_LABEL`. Text edits in 19 upstream files (§3.4). One upstream test is updated (`api-spec-route.servertest.ts`) and one ACME client test added (`acmeLangfuseText.clienttest.tsx`). No procedure, API or MCP change |
| Worker | None |
| CI | New workflow, script, script tests and baseline (§3.5) |
| Infra / Terraform / Helm | None |
| Integrations (LiteLLM, NeMo, promptfoo) | None |

## 5. Database change
None. **Rollback:** revert the commit and redeploy the previous console image. The guard and its baseline go with the revert.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The upstream sync (CHG-2026-100) brings new upstream "Langfuse" text, and the guard fails the sync PR | Certain | Low | Open question 1 (§10). The script has no way to add entries |
| A sync rewrites one of the ten lines back to "Langfuse" | Medium | Low | The client test pins each replaced line, and the guard fails on the text |
| The heuristic misses text (split across JSX lines, built at runtime, or stored as data) | Medium | Low | The guard is a ratchet, not a proof. The phases and review cover the rest |
| Internal names are flagged (`new Langfuse(…)`, `maintainer === "Langfuse"`) | Certain | Low | Today's are in the baseline. For a new one, the how-to-fix asks for rewording or the reviewer's judgement |
| Someone adds new text to the baseline by hand | Low | Low | Baseline diffs are visible in review, the rule says never, and `--shrink` cannot add |
| A stale entry lets the same text return in that file | Low | Low | Every PR gets the warning, and each phase runs `--shrink` |

## 7. Compatibility
- **Backward compatible:** yes. Only display text changes. No stored value, API, MCP tool, URL, setting or permission changes. The evaluator "maintainer" labels are computed in the browser and stored nowhere.
- **Upstream merge risk:** small. The edits in 19 upstream files are a few lines each and are marked.
- **Feature flag:** not needed, because this is display text.

## 8. Client-facing notes
- **What changes:** the ten places in §3.4 say EYEON or use neutral wording. Built-in models, evaluators and widgets are labelled "Built-in", and the API reference's tab reads "EYEON API Reference".
- **What does not change:** SDK settings, packages and the API keep their Langfuse names (`LANGFUSE_*`, `@langfuse/*`). Links to langfuse.com stay until a later phase removes them.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pending the owner's review | The guard's 24 unit tests, the guard passing on the tree, client and server tests, typecheck, ESLint and Prettier (see the changelog entry) |
| B — staging | `Staging: not available.` No migration | — |
| C — post-deploy | Not yet | After release, read-only: the ten places on dev |

## 10. Assumptions and open questions
1. **The upstream sync's own text.** CHG-2026-100 will bring new upstream "Langfuse" text, and the guard will fail on it. The options:
   - (a) the sync PR replaces the new text;
   - (b) the sync PR regenerates the baseline from its own tree, labelled `upstream-sync`, with the added entries listed for the owner: a one-time growth by the owner's decision;
   - (c) the guard is skipped for that PR and the next phase cleans up.

   The recommendation is (b), because it keeps the sync's diff to upstream's own changes. The owner decides; nothing is built for it here.
2. **The Home dashboard picker's group heading** says "EYEON-maintained" (CHG-2026-121). Should it also become "Built-in"?
3. **The About page's place:** the user menu, as proposed, or the settings.
4. **Langfuse Cloud-only text,** which never renders in EYEON: remove it in the bulk phase, or leave it to keep upstream conflicts small?
5. **What the guard does not scan:** `web/public` (the icons; the generated OpenAPI specification, whose description names Langfuse and links langfuse.com, is API surface, rule 6) and `ee/`.
