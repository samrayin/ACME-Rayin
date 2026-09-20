import { describe, it, expect, vi } from "vitest";
import { buildEventRow } from "@/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService";
import type { GuardrailsEventPushInput } from "@/src/features/acme-enhancements/server/acmeGuardrailsEventsIngestService";

// Pure-logic coverage for the tiered-content rule (POSTGRES-COMPLIANCE-
// FRAMEWORK.md §1.1, as changed by the 2026-09-18 owner decision): every
// action -> encrypted rawContentEncrypted + maskedContentEncrypted when sent;
// redact additionally -> redactedText + piiFindings. Deliberately does not
// touch Prisma or a live database -- see buildEventRow's own doc comment for
// why it was split out.

const BASE_INPUT: GuardrailsEventPushInput = {
  eventId: "evt-1",
  agentId: "agent-1",
  traceId: "trace-1",
  userId: "user-1",
  clientHost: "LAPTOP-ACME-042",
  eventTime: "2026-09-17T10:00:00.000Z",
  direction: "input",
  action: "allow",
  policyTriggered: null,
  redactedText: null,
  piiFindings: null,
  rawContent: null,
  maskedContent: null,
};

const fakeEncrypt = (plainText: string, key: string) => `enc(${key}):${plainText}`;

describe("buildEventRow", () => {
  it("allow with no content (older rayin-guardrails build): metadata only", () => {
    const encryptFn = vi.fn();
    const row = buildEventRow("proj-1", { ...BASE_INPUT }, "unused-key", encryptFn);
    expect(row.action).toBe("ALLOW");
    expect(row.redactedText).toBeNull();
    expect(row.piiFindings).toBeUndefined();
    expect(row.rawContentEncrypted).toBeNull();
    expect(row.maskedContentEncrypted).toBeNull();
    expect(encryptFn).not.toHaveBeenCalled();
  });

  // 2026-09-18 owner decision: allowed prompts are the dangerous ones in a
  // compromised account, so they now keep content too.
  it("allow with content: encrypts both raw and masked content", () => {
    const row = buildEventRow(
      "proj-1",
      {
        ...BASE_INPUT,
        rawContent: "email jane@example.com the report",
        maskedContent: "email <EMAIL_ADDRESS> the report",
      },
      "the-key",
      fakeEncrypt,
    );
    expect(row.action).toBe("ALLOW");
    expect(row.rawContentEncrypted).toBe("enc(the-key):email jane@example.com the report");
    expect(row.maskedContentEncrypted).toBe("enc(the-key):email <EMAIL_ADDRESS> the report");
    expect(row.redactedText).toBeNull();
    expect(row.piiFindings).toBeUndefined();
  });

  it("redact: persists redactedText and piiFindings, and encrypts raw + masked content", () => {
    const input: GuardrailsEventPushInput = {
      ...BASE_INPUT,
      action: "redact",
      redactedText: "hello <REDACTED>",
      piiFindings: [
        { entity_type: "EMAIL_ADDRESS", start: 6, end: 20, score: 0.95 },
      ],
      rawContent: "hello user@example.com",
      maskedContent: "hello <EMAIL_ADDRESS>",
    };
    const row = buildEventRow("proj-1", input, "the-key", fakeEncrypt);
    expect(row.action).toBe("REDACT");
    expect(row.redactedText).toBe("hello <REDACTED>");
    expect(row.piiFindings).toEqual(input.piiFindings);
    expect(row.rawContentEncrypted).toBe("enc(the-key):hello user@example.com");
    expect(row.maskedContentEncrypted).toBe("enc(the-key):hello <EMAIL_ADDRESS>");
  });

  it("never stores content in plaintext: encrypted columns differ from the input", () => {
    const input: GuardrailsEventPushInput = {
      ...BASE_INPUT,
      rawContent: "raw text",
      maskedContent: "masked text",
    };
    const row = buildEventRow("proj-1", input, "the-key", fakeEncrypt);
    expect(row.rawContentEncrypted).not.toBe("raw text");
    expect(row.maskedContentEncrypted).not.toBe("masked text");
  });

  it("masked content only (no raw): encrypts masked, raw stays null", () => {
    const encryptFn = vi.fn().mockReturnValue("iv:cipher:tag");
    const row = buildEventRow(
      "proj-1",
      { ...BASE_INPUT, maskedContent: "hi <PERSON>" },
      "the-key",
      encryptFn,
    );
    expect(encryptFn).toHaveBeenCalledTimes(1);
    expect(encryptFn).toHaveBeenCalledWith("hi <PERSON>", "the-key");
    expect(row.maskedContentEncrypted).toBe("iv:cipher:tag");
    expect(row.rawContentEncrypted).toBeNull();
  });

  it.each(["allow", "redact", "block"] as const)(
    "%s with masked content but no encryption key: throws, encrypts nothing",
    (action) => {
      const encryptFn = vi.fn();
      expect(() =>
        buildEventRow(
          "proj-1",
          { ...BASE_INPUT, action, maskedContent: "hi <PERSON>" },
          undefined,
          encryptFn,
        ),
      ).toThrow(/GUARDRAILS_ENCRYPTION_KEY is not configured/);
      expect(encryptFn).not.toHaveBeenCalled();
    },
  );

  it("allow with raw content but no encryption key: throws, never falls back to plaintext", () => {
    const encryptFn = vi.fn();
    expect(() =>
      buildEventRow(
        "proj-1",
        { ...BASE_INPUT, rawContent: "some prompt" },
        undefined,
        encryptFn,
      ),
    ).toThrow(/GUARDRAILS_ENCRYPTION_KEY is not configured/);
    expect(encryptFn).not.toHaveBeenCalled();
  });

  it("no content and no key: still stores metadata (key only needed for content)", () => {
    const row = buildEventRow("proj-1", { ...BASE_INPUT }, undefined);
    expect(row.rawContentEncrypted).toBeNull();
    expect(row.maskedContentEncrypted).toBeNull();
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

  it("carries projectId, eventId, agentId, traceId, userId, eventTime and direction through unchanged", () => {
    const row = buildEventRow(
      "proj-42",
      { ...BASE_INPUT, direction: "output" },
      "unused-key",
    );
    expect(row.projectId).toBe("proj-42");
    expect(row.eventId).toBe("evt-1");
    expect(row.agentId).toBe("agent-1");
    expect(row.traceId).toBe("trace-1");
    expect(row.userId).toBe("user-1");
    expect(row.direction).toBe("OUTPUT");
    expect(row.eventTime).toEqual(new Date("2026-09-17T10:00:00.000Z"));
  });

  it("userId absent (caller didn't send it): stays null, not omitted", () => {
    const row = buildEventRow("proj-1", { ...BASE_INPUT, userId: null }, "unused-key");
    expect(row.userId).toBeNull();
  });

  it("carries clientHost through and marks the row as captured by push", () => {
    const row = buildEventRow("proj-1", BASE_INPUT, "unused-key");
    expect(row.clientHost).toBe("LAPTOP-ACME-042");
    expect(row.source).toBe("PUSH");
  });

  it("clientHost absent (caller or older rayin-guardrails didn't send it): stays null", () => {
    const row = buildEventRow("proj-1", { ...BASE_INPUT, clientHost: null }, "unused-key");
    expect(row.clientHost).toBeNull();
  });
});
