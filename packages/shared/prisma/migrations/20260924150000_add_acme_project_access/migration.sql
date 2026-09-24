-- ACME: project access policy (ADR-0011 section 5, CHG-2026-059 part c).
-- A ceiling role per person and project that can only narrow the person's
-- organisation role. Additive: a new table, no change to upstream tables.
CREATE TABLE "acme_project_access" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "org_membership_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ceiling_role" "Role" NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_project_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acme_project_access_project_id_user_id_key" ON "acme_project_access"("project_id", "user_id");
CREATE INDEX "acme_project_access_user_id_idx" ON "acme_project_access"("user_id");
CREATE INDEX "acme_project_access_org_id_idx" ON "acme_project_access"("org_id");

ALTER TABLE "acme_project_access" ADD CONSTRAINT "acme_project_access_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "organization_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acme_project_access" ADD CONSTRAINT "acme_project_access_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acme_project_access" ADD CONSTRAINT "acme_project_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
