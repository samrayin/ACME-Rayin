import { describe, it, expect, vi } from "vitest";
import { buildEventRow } from "@/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService";
import type { GuardrailsEventPushInput } from "@/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService";

// Pure-logic coverage for the tiered-content rule (POSTGRES-COMPLIANCE-
// FRAMEWORK.md §1.1): allow -> metadata only, redact -> redactedText +
// piiFindings, block -> encrypted rawContentEncrypted. Deliberately does not
// touch Prisma or a live database -- see buildEventRow's own doc comment for
// why it was split out.

const BASE_INPUT: GuardrailsEventPushInput = {
  eventId: "evt-1",
  agentId: "agent-1",
  traceId: "trace-1",
  eventTime: "2026-09-17T10:00:00.000Z",
  direction: "input",
  action: "allow",
  policyTriggered: null,
  redactedText: null,
  piiFindings: null,
  rawContent: null,
};

describe("buildEventRow", () => {
  it("allow: persists metadata only, no redacted text/PII/raw content", () => {
    const row = buildEventRow("proj-1", { ...BASE_INPUT }, "unused-key");
    expect(row.action).toBe("ALLOW");
    expect(row.redactedText).toBeNull();
    expect(row.piiFindings).toBeUndefined();
    expect(row.rawContentEncrypted).toBeNull();
  });

  it("redact: persists redactedText and piiFindings, no raw content", () => {
    const input: GuardrailsEventPushInput = {
      ...BASE_INPUT,
      action: "redact",
      redactedText: "hello <REDACTED>",
      piiFindings: [
        { entity_type: "EMAIL_ADDRESS", start: 6, end: 20, score: 0.95 },
      ],
      rawContent: "hello user@example.com",
    };
    const row = buildEventRow("proj-1", input, "unused-key");
    expect(row.action).toBe("REDACT");
    expect(row.redactedText).toBe("hello <REDACTED>");
    expect(row.piiFindings).toEqual(input.piiFindings);
    expect(row.rawContentEncrypted).toBeNull();
  });

  it("block: encrypts rawContent into rawContentEncrypted, using the passed key", () => {
    const encryptFn = vi.fn().mockReturnValue("iv:cipher:tag");
    const input: GuardrailsEventPushInput = {
      ...BASE_INPUT,
      action: "block",
      rawContent: "malicious payload",
    };
    const row = buildEventRow("proj-1", input, "the-key", encryptFn);
    expect(encryptFn).toHaveBeenCalledWith("malicious payload", "the-key");
    expect(row.action).toBe("BLOCK");
    expect(row.rawContentEncrypted).toBe("iv:cipher:tag");
    expect(row.redactedText).toBeNull();
  });

  it("block with no rawContent: does not call encryptFn, stays null", () => {
    const encryptFn = vi.fn();
    const input: GuardrailsEventPushInput = {
      ...BASE_INPUT,
      action: "block",
      rawContent: null,
    };
    const row = buildEventRow("proj-1", input, "the-key", encryptFn);
    expect(encryptFn).not.toHaveBeenCalled();
    expect(row.rawContentEncrypted).toBeNull();
  });

  // Fail-closed guarantee (framework doc §1.1): a Restricted-tier column must
  // never be written in plaintext because a key happened to be missing.
  it("block with rawContent but no encryption key: throws, never falls back to plaintext", () => {
    const encryptFn = vi.fn();
    const input: GuardrailsEventPushInput = {
      ...BASE_INPUT,
      action: "block",
      rawContent: "malicious payload",
    };
    expect(() => buildEventRow("proj-1", input, undefined, encryptFn)).toThrow(
      /GUARDRAILS_ENCRYPTION_KEY is not configured/,
    );
    expect(encryptFn).not.toHaveBeenCalled();
  });

  it("carries projectId, eventId, agentId, traceId, eventTime and direction through unchanged", () => {
    const row = buildEventRow(
      "proj-42",
      { ...BASE_INPUT, direction: "output" },
      "unused-key",
    );
    expect(row.projectId).toBe("proj-42");
    expect(row.eventId).toBe("evt-1");
    expect(row.agentId).toBe("agent-1");
    expect(row.traceId).toBe("trace-1");
    expect(row.direction).toBe("OUTPUT");
    expect(row.eventTime).toEqual(new Date("2026-09-17T10:00:00.000Z"));
  });
});
