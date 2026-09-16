-- CreateEnum
CREATE TYPE "AcmePromptApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "acme_prompt_approvals" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_name" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "target_label" TEXT NOT NULL,
    "status" "AcmePromptApprovalStatus" NOT NULL DEFAULT 'pending',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_comment" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,

    CONSTRAINT "acme_prompt_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acme_prompt_approvals_project_id_status_idx" ON "acme_prompt_approvals"("project_id", "status");

-- CreateIndex
CREATE INDEX "acme_prompt_approvals_project_id_prompt_name_idx" ON "acme_prompt_approvals"("project_id", "prompt_name");
