-- CreateEnum
CREATE TYPE "AcmeGuardrailEventDirection" AS ENUM ('input', 'output');

-- CreateEnum
CREATE TYPE "AcmeGuardrailEventAction" AS ENUM ('allow', 'redact', 'block');

-- CreateTable
CREATE TABLE "acme_guardrail_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "agent_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "direction" "AcmeGuardrailEventDirection" NOT NULL,
    "policy_triggered" TEXT,
    "action" "AcmeGuardrailEventAction" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acme_guardrail_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acme_guardrail_events_dedup_key" ON "acme_guardrail_events"("project_id", "agent_id", "event_time", "direction");

-- CreateIndex
CREATE INDEX "acme_guardrail_events_project_id_event_time_idx" ON "acme_guardrail_events"("project_id", "event_time");
