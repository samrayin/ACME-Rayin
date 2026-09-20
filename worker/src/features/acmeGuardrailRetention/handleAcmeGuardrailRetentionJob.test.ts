import { beforeEach, describe, expect, it, vi } from "vitest";

// ACME: handler-level fail-closed test for the guardrail retention job. The
// env, the shared server module and the purger client are all mocked, so no
// database, Redis or storage account is touched.

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  getPurgerClient: vi.fn(),
  storageGetInstance: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../env", () => ({ env: mocks.env }));
vi.mock("./purgerClient", () => ({ getPurgerClient: mocks.getPurgerClient }));
vi.mock("@langfuse/shared/src/server", () => ({
  logger: mocks.logger,
  StorageServiceFactory: { getInstance: mocks.storageGetInstance },
}));

const baseEnv = {
  DATABASE_URL: "postgresql://app@db/langfuse",
  ACME_GUARDRAIL_RETENTION_DAYS: 30,
  ACME_GUARDRAIL_RETENTION_BATCH_SIZE: 1000,
  ACME_GUARDRAIL_RETENTION_MAX_BATCHES_PER_RUN: 100,
  ACME_GUARDRAIL_RETENTION_DRY_RUN: "true",
  ACME_GUARDRAIL_ARCHIVE_PREFIX: "guardrail-events/",
};

describe("handleAcmeGuardrailRetentionJob: disabled when unconfigured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mocks.env)) delete mocks.env[k];
    Object.assign(mocks.env, baseEnv);
  });

  it.each([
    ["nothing configured", {}],
    [
      "only the purger URL",
      { RAYIN_RETENTION_PURGER_DATABASE_URL: "postgresql://purger@db/x" },
    ],
    ["only the archive bucket", { ACME_GUARDRAIL_ARCHIVE_BUCKET: "archive" }],
    [
      "purger URL equal to DATABASE_URL",
      {
        RAYIN_RETENTION_PURGER_DATABASE_URL: baseEnv.DATABASE_URL,
        ACME_GUARDRAIL_ARCHIVE_BUCKET: "archive",
      },
    ],
  ])(
    "%s: logs DISABLED and never opens a DB client or storage",
    async (_label, extra) => {
      Object.assign(mocks.env, extra);
      const { handleAcmeGuardrailRetentionJob } = await import(
        "./handleAcmeGuardrailRetentionJob"
      );

      const result = await handleAcmeGuardrailRetentionJob({
        id: "job-1",
      } as never);

      expect(result.status).toBe("disabled");
      expect(mocks.getPurgerClient).not.toHaveBeenCalled();
      expect(mocks.storageGetInstance).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("DISABLED"),
        expect.objectContaining({ reasons: expect.any(Array) }),
      );
    },
  );
});
