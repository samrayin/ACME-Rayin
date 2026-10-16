# ADR-0024: Strip the Langfuse Enterprise code from release images

| | |
|---|---|
| **Change ID** | CHG-2026-123 · Tier 1 (licence compliance; it changes what every customer image contains) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released. No image has been built this way |
| **Status** | **Proposed.** The owner chose this option on 2026-10-06. **Counsel has not confirmed it**, and no customer may rely on it until they do |
| **Type** | Forward |
| **Date** | 2026-10-06 |
| **Author** | Claude session (Opus 5) for Anees Ur Rahman. **This author must not write the stub modules** — see §6 |
| **Closes** | Gap Register **EE-3**; Readiness Ledger **N-37** (rated P0), from the 2026-09-20 audit finding H-19 |
| **Does not close** | EE-1, EE-2, EE-4, CMP-14, CMP-16 — see §5 |

## 1. Purpose

Langfuse publishes most of its code under MIT and keeps 98 files under a separate
commercial licence, in `ee/`, `web/src/ee/` and `worker/src/ee/`. The root
`LICENSE` names exactly those three paths; `packages/shared` is MIT, so the
Enterprise count is 98, not the 102 the boundary gate matches (EE-10).

That code is compiled into **both** CAIRO images today, unmodified:

- **web** — `root.ts` imports five Enterprise routers, and `trpc.ts` imports the
  admin-API authentication.
- **worker** — `app.ts` and five queue files import from `../ee/...`, and `tsc`
  compiles every file under `worker/src/ee`.

The customer template instructs operators to import those images into each
customer's own registry. A customer deployment would therefore **distribute**
Enterprise-licensed code, which the licence forbids without an agreement. Nothing
has reached anyone yet: the images exist only in ACME's registry, which requires
authentication and has a single pull identity.

CAIRO does not use the paid features. That is not the test — the licence
restricts distribution and use, not benefit.

## 2. Constraints

1. **Langfuse's own files must not change.** CAIRO tracks upstream and takes
   regular syncs. The `acme-ee-boundary` CI gate exists to keep every Enterprise
   file byte-identical to upstream, and CHG-2026-058 established that rule after
   the one ACME edit was reverted.
2. **The repository must stay a faithful fork.** Deleting the Enterprise files
   from the repository would break upstream syncs and disable the boundary gate's
   byte-identity check — it would remove the evidence that we have not modified
   their code.
3. **Clean-room authorship.** Gap Register **EE-15**: whoever writes the
   replacement modules must never have read the Enterprise implementation files.
4. **No customer may rely on this before counsel confirms it.** The study's
   compliance conclusion is a plain reading of the licence, not legal advice, and
   no counsel is currently named (CMP-11).

## 3. Decision

Strip the Enterprise code **at image build time**, leaving the repository
untouched.

### 3.1 The mechanism

In each image's `builder` stage, after the source is copied and before the build
runs, delete `web/src/ee` and `worker/src/ee` and copy in ACME-written stub
modules at the same paths.

This is not a new idea in this repository — upstream already does exactly this
shape. `web/Dockerfile:134` runs `RUN rm -f ./web/src/middleware.ts` in the
builder stage, immediately before the build at line 154. The worker's builder
stage begins at `worker/Dockerfile:32` and builds at line 73. The strip goes in
the same place in both.

Consequences of doing it here:

- The repository on disk and in git stays **byte-identical to upstream**.
- **No import site changes.** Verified 2026-10-06 against `origin/main`: **59**
  production files import an Enterprise path (web 53, worker 6), across **50**
  distinct module paths; a further **23** test files do. The study's "58 import
  sites" was the production count and stands. Every one resolves to the stub at
  the same path. The surface is listed in
  `acme-governance/ee-strip/stub-surface-from-mit-call-sites.md`, generated from
  MIT call sites only.
- Upstream syncs continue to apply, and the boundary gate keeps working.

### 3.2 Why not the alternatives

| Option | Rejected because |
|---|---|
| A bundler alias (webpack/Next resolve) | It **fails open** — a missed path silently keeps the real module — and it cannot reach the worker, which does not go through the bundler |
| Deleting the files from the repository | Breaks upstream syncs and removes the boundary gate's byte-identity check, which is our evidence of non-modification |
| Buying an Enterprise licence | Owner decision 2026-10-06: not this option. Recurring cost and a commercial dependency, for features CAIRO does not use |
| Asking Langfuse for written permission | Owner decision 2026-10-06: not this option. It is their decision to give or withdraw |

### 3.3 The stubs

About 41 modules covering 60 exported names. Most simply switch a feature off.
Two need real work:

- **Admin API authentication.** Live today behind bullmq, ingestion replay and
  migration retry. It must be rewritten clean-room from the MIT call sites.
- **Sign-in SSO helpers.** Also live, and also needing a real replacement.

Every stub **must keep returning the `oss` plan result.** Anything else would
re-enable entitlement-gated behaviour by accident.

Nothing CAIRO uses today is lost. SCIM, organisation API keys and the admin API
are already switched off by MIT-side gates.

## 4. Known costs

- About **27 or more tests** exercise Enterprise code and will change.
- A **stub type-check job** is needed. EE-13 suspects release builds set
  `NEXT_IGNORE_BUILD_ERRORS=true` — `web/Dockerfile:71-72` does declare that
  argument — which would mean type errors reach releases unseen. That is
  unverified, because the release env files live outside the repository. Verify
  it as part of this work.
- **CI tests under a licence key production never has.** `pipeline.yml` sets a
  `langfuse_ee_` test value, so CI runs on an enterprise plan while CAIRO runs as
  `oss` (EE-12). The release-shaped tests must run **without** that key, or CI is
  not testing what ships.
- The **v4.42 upstream sync reshapes the stubs**, so this carries a maintenance
  cost at every major sync. CHG-2026-100's v4.50.x sync plan must account for it.

## 5. What this does and does not resolve

**Resolves:** EE-3, by plain reading of the licence, provided the stubs are
clean-room, every image is verified (§7) and the customer template uses stripped
digests only.

**Does not resolve** — these are legal and historical questions, not build ones:

| Row | What remains |
|---|---|
| **EE-1** | The ACME Audit Logs table is derived from the Enterprise audit table. Needs a clean-room rewrite or removal, plus corrections to the header, changelog wording, page help text and capability record |
| **EE-2** | The one edited Enterprise file still sits inside web images `.1`–`.9` in ACR, and in retained ReplicaSets. Those images must be marked never to redeploy |
| **EE-4** | While the repository was public (10–25 Sep) it republished all 98 Enterprise files |
| **CMP-14, CMP-16** | Missing licence notices and SBOM in the images |

## 6. Clean-room authorship (EE-15)

The stub modules and the EE-1 rewrite **must not be written by any session that
has read the Enterprise implementation files.**

The session that wrote this ADR has read detailed descriptions of those files
from the Gap Register — which routers are imported, which service names exist —
and is therefore **disqualified from writing the stubs.** It may write this
design, the verification and the rollback, because none of those reproduce the
code.

The process:

1. A fresh session, or a person, with an explicit standing rule never to open
   `ee/`, `web/src/ee` or `worker/src/ee`.
2. Its only inputs are the MIT call sites and the compiler errors that appear
   when the directories are absent.
3. A **different** session then runs a mechanical similarity check of the stubs
   against the Enterprise files.
4. The author, the rule and the similarity result are recorded here before merge.

Counsel should say whether an AI author trained on public data is acceptable for
this purpose, and what attestation is sufficient.

## 7. Verification

Before any release built this way is considered good:

1. **Repository unchanged** — the boundary gate passes, and all 98 Enterprise
   files are byte-identical to the upstream tag.
2. **Image contains no Enterprise code** — inspect the built image filesystem for
   `web/src/ee` and `worker/src/ee`, and confirm only stub content is present.
   This check runs on every release, not once.
3. **Stub type-check** — a CI job that builds with the stubs in place and
   tolerates no type errors.
4. **Release-shaped tests without the licence key** (EE-12).
5. **Plan is still `oss`** — assert at runtime, so a stub regression cannot
   silently restore an entitlement.
6. **Nothing user-visible changed** — the console and worker behave as before,
   since no feature CAIRO uses is affected.

## 8. Rollback

The rollback target must **never** be an image containing Enterprise code.

- In dev, roll back to the previous **stripped** digest, captured before the
  deploy, per the digest-pinned rollback standard.
- `release.sh --redeploy` today puts any earlier tag back into service with no
  check, Enterprise images included (EE-14). It must refuse any digest not on the
  stripped allow-list before a customer exists.
- The customer template must be pinned to **digests**, not the mutable
  `acme-dev` tags it names today, and to stripped digests only.

## 9. Prerequisites and sequence

1. **Switch off the Enterprise data-retention queue now** (EE-5), independent of
   this change. `QUEUE_CONSUMER_DATA_RETENTION_QUEUE_IS_ENABLED` defaults to true
   and `worker/src/app.ts:683` reads it straight from the environment; no override
   is committed anywhere in the repository. It runs nightly at 03:15Z and has
   queued 0 projects. Set it to `false` on the worker and in IaC. Also run a
   read-only count of projects with `retention_days > 0` (expect 0).
2. **Working CI** (IMP-1), so the new jobs actually run.
3. **Counsel named and briefed** (CMP-11). Engineering may proceed to a built and
   verified image without this; **a customer may not.**
4. Clean author identified per §6.
5. Then: stubs, Dockerfile changes, CI jobs, verification, release under the
   owner's explicit Tier 1 go-ahead.

## 10. Open decisions for the owner

1. Who is counsel, and when are they briefed. This is the long-lead item.
2. Who writes the stubs under §6, and is an AI author acceptable.
3. Whether EE-1's audit table is rewritten clean-room or removed.
4. What happens to the ACR images holding the edited Enterprise file (EE-2) —
   they are also evidence, so do not delete tags or prune history before counsel.
5. Whether the v4.50.x sync (CHG-2026-100) goes before or after this work.

## 11. Naming note

CHG-2026-121 renames the product CAIRO to EYEON in everything users see. This ADR
is internal and uses the repository's current names. The strip does not touch any
user-visible string, so the two changes do not interact beyond ordinary merge
conflicts.
