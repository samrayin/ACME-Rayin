# ADR-0025 — The customer's own logo, from UI Customization

| | |
|---|---|
| **Change ID** | CHG-2026-124 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | `acme-v4.38.0.36` (planned) |
| **Status** | Accepted |
| **Type** | Forward |
| **Date** | 2026-10-06 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Owner, 2026-10-06: reviewed and merged #345 ("#345 merged"). No pre-merge review report, per the owner's dev decision (PL-087). Not a production approval |
| **Commits / tag** | `ce93865e9` (#345) · release tag to be added at release |

## 1. Purpose
The owner asked (2026-10-06): "Can you add a feature "Add Logo" within "UI Customization" so customer can their own logo. mention the size requirement as a small info for them to know." In the same message the ACME logo was removed from the sidebar header (a CHG-2026-121 follow-up), so the header shows EYEON on its own until a customer adds their logo.

A customer's brand beside the product's name is configuration, not build: each deployment's own administrators upload it, without a new image.

## 2. Scope
**In:**
- An "Add Logo" card on the UI Customization page: upload, replace and remove, a preview on the sidebar's own colours, and a short note with the size requirement.
- The sidebar header shows the logo on a white tile beside the EYEON wordmark, for every member of the organization.
- Server-side checks of type, size and dimensions; a new table; audit-log entries.

**Out:**
- The mobile top bar's compact wordmark (EYEON only); the collapsed sidebar icon; the sign-in page; email templates.
- SVG and GIF files.
- Langfuse's own UI-customization logo settings (environment-driven, in `web/src/ee`), which keep working as before and take precedence when set.

## 3. Decision
1. **Organization scope, not project scope.** The customer is the organization. One logo applies to all its projects and to pages outside any project. The project theme (CHG-2026-074) stays per project. The page is a project page, so it resolves the project's organization and checks `organization:update` (Owner, Admin) to change the logo; anyone else sees it read-only.
2. **Its own table, not organization metadata or blob storage.** The session callback copies `organizations.metadata` into every user's session, so a 100 KB image there would ride along on every session request. Blob storage would add a second storage dependency, signed URLs and a deployment setting for a file of at most 100 KB. A table `acme_organization_logos`, one row per organization, keyed by `org_id` with a cascading foreign key, is the smallest thing that works.
3. **Raster formats only: PNG, JPEG, WebP.** An SVG can carry script. It is inert inside an `<img>` tag, but a regulated customer's reviewer would have to reason about every place it might be rendered; excluding it removes the question. The type is read from the file's own header on the server (`acmeCustomerLogoCheck.ts`) and must match the declared type; the database's CHECK constraint repeats the allowed types.
4. **Limits:** at most 100 KB (enforced in the API, in the router's input length, and by a CHECK constraint that also ties `size_bytes` to the stored bytes), 32 to 1024 px high, 16 to 4096 px wide. The browser checks type, size and height first only to answer quickly; the server's checks are the authority.
5. **Display:** on a white tile, at most 24 px high and 72 px wide, keeping proportions. The white tile keeps a dark logo legible on the navy or near-black sidebar. Beside a logo EYEON is 20 px, so both fit the 184 px sidebar; on its own it is 24 px.
6. **The size note** shown under the upload: "PNG, JPEG or WebP, up to 100 KB, 32 to 1024 px high. It is shown 24 px high and up to 72 px wide on a white tile, so a logo no wider than 3:1, about 48 to 96 px high, with a transparent or white background works best." It is built from the same constants the checks use.
7. **Serving:** a tRPC query (`acmeCustomerLogo.get`) returns the logo as a data URL to any member of the organization. It is cached in the client for 5 minutes and refetched after an upload or removal. No new public route.
8. **Audit:** each upload, replacement and removal writes an audit-log entry (resource type `acmeOrganizationLogo`) with the type, size, dimensions, SHA-256 and time, before and after. Never the image.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | new table `acme_organization_logos`; back-relation on `Organization` in the Prisma schema only |
| ClickHouse | none |
| Web / API | router `acmeCustomerLogo` (get, upload, remove); "Add Logo" card; sidebar header; audit resource type |
| Worker | none |
| Infra / Terraform / Helm | none; no new setting |
| Integrations (LiteLLM, NeMo, promptfoo) | none |

## 5. Database change
- **Migration:** `packages/shared/prisma/migrations/20261006200000_add_acme_organization_logos/`. Additive: one table, its primary key, a cascading foreign key to `organizations`, two CHECK constraints, and grants for the least-privilege runtime role where it exists.
- **Backfill:** none.
- **Rollback:** `acme-governance/rollback/20261006200000_add_acme_organization_logos/`. Data lost on rollback: the uploaded logos; customers upload them again. Audit-log entries stay.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A crafted file passes the header check but is malformed | Low | Low: the browser fails to draw it inside an `<img>` | Raster only, header must match the declared type, size limits; rendered only in `<img>` |
| A large logo slows page loads | Low | Low | 100 KB limit at three layers; cached in the client; fetched once per page load |
| A non-admin changes the customer's brand | Low | Medium | `organization:update` checked on the server before any database access; every change audit-logged |
| The migration fails on a deployment without the runtime role | Low | Low | The grant is guarded by a role-exists check (pattern of 20261001120000) |
| Upstream changes the sidebar logo component | Medium | Low | ACME code in `LangfuseLogo.tsx` is one marked block; upstream's own logo branch is untouched |

## 7. Compatibility
- Backward compatible with the previous image: yes. The previous image does not read the table; the migration is additive.
- Upstream merge risk: `LangfuseLogo.tsx`, `AppSidebar.tsx`, `AuthenticatedLayout.tsx` (small marked additions), `schema.prisma` (one back-relation line and a new model), `auditLog.ts` (one union member).
- Feature flag: not needed. With no logo uploaded, the header is exactly the CHG-2026-121 header.
- Nothing is under `web/src/ee`, so CHG-2026-123's strip does not touch it.

## 8. Client-facing notes
An organization's Owners and Admins can add their logo under UI Customization → Add Logo. The size requirement is shown beside the upload. Without a logo the sidebar shows EYEON alone.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pass (local) | 21 unit tests (header sniffing for PNG, JPEG and three WebP encodings; every limit; router access for nine roles, storage, audit content, removal); fresh web typecheck; migration matches Prisma's own generated SQL plus the constraints and grants |
| B — staging | `Staging: not available; isolated migration and rollback rehearsal performed.` | see `ROLLBACK.md` |
| C — post-deploy | Pending | release record in the ops repository |

## 10. Assumptions and open questions
- The sidebar's 184 px width is assumed stable; a wider sidebar would only add room.
- Whether customers want a separate dark-mode logo: not built; the white tile makes one logo work on both themes.
