-- ACME: the customer's own logo, one per organization (CHG-2026-124, ADR-0025).
-- Shown beside the EYEON wordmark in the sidebar. Its own table, not
-- organizations.metadata, because the session callback copies that metadata
-- into every session. Additive: one new table, no change to any upstream table
-- or row.
CREATE TABLE "acme_organization_logos" (
    "org_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_organization_logos_pkey" PRIMARY KEY ("org_id"),
    -- The console checks the file's own header before storing it; these keep
    -- the table to the same rules for any other writer.
    CONSTRAINT "acme_organization_logos_content_type_check"
        CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "acme_organization_logos_size_check"
        CHECK ("size_bytes" > 0 AND "size_bytes" <= 102400 AND octet_length("data") = "size_bytes")
);

-- The logo goes with its organization.
ALTER TABLE "acme_organization_logos" ADD CONSTRAINT "acme_organization_logos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Privileges for the least-privilege runtime role, as in 20261001120000:
-- migrations still run as the admin login, so grant explicitly; guarded so
-- this migration also applies where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rayin_app_runtime') THEN
    REVOKE ALL ON "acme_organization_logos" FROM rayin_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "acme_organization_logos" TO rayin_app_runtime;
  END IF;
END
$$;
