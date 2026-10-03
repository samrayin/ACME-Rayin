import { describe, it, expect } from "vitest";
import {
  AUDIT_LOG_METADATA_FIELDS,
  MASKED,
  MASKED_CHANGED,
  maskAuditLogStates,
} from "@/src/features/acme-enhancements/server/auditLogMasking";

// CHG-2026-101 / ADR-0011. The content-free roles read audit-log entries with
// metadata fields only; every other field is masked, marked changed or not.

const parse = (s: string | null) => (s === null ? null : JSON.parse(s));

describe("maskAuditLogStates", () => {
  it("keeps metadata fields and masks content fields on an update", () => {
    const before = JSON.stringify({
      id: "p1",
      name: "greeting",
      version: 2,
      labels: ["production"],
      prompt: "Hello {{name}}, your account number is 123",
      config: { temperature: 0.2 },
    });
    const after = JSON.stringify({
      id: "p1",
      name: "greeting",
      version: 3,
      labels: ["production", "latest"],
      prompt: "Hi {{name}}",
      config: { temperature: 0.2 },
    });

    const out = maskAuditLogStates({ resourceType: "prompt", before, after });

    expect(parse(out.before)).toEqual({
      id: "p1",
      name: "greeting",
      version: 2,
      labels: ["production"],
      prompt: MASKED_CHANGED,
      config: MASKED,
    });
    expect(parse(out.after)).toEqual({
      id: "p1",
      name: "greeting",
      version: 3,
      labels: ["production", "latest"],
      prompt: MASKED_CHANGED,
      config: MASKED,
    });
    expect(out.before).not.toContain("account number");
  });

  it("marks every masked field changed when one side is missing (create, delete)", () => {
    const after = JSON.stringify({
      id: "s1",
      value: 0.9,
      comment: "customer said X",
    });

    const created = maskAuditLogStates({
      resourceType: "score",
      before: null,
      after,
    });
    expect(created.before).toBeNull();
    expect(parse(created.after)).toEqual({
      id: "s1",
      value: MASKED_CHANGED,
      comment: MASKED_CHANGED,
    });

    const deleted = maskAuditLogStates({
      resourceType: "score",
      before: after,
      after: null,
    });
    expect(parse(deleted.before)).toEqual({
      id: "s1",
      value: MASKED_CHANGED,
      comment: MASKED_CHANGED,
    });
    expect(deleted.after).toBeNull();
  });

  it("masks an object or a list of objects even under an allowed field name", () => {
    const after = JSON.stringify({
      name: { first: "Ann", last: "Lee" },
      tags: [{ secret: "x" }],
      labels: ["ok"],
    });
    const out = parse(
      maskAuditLogStates({ resourceType: "x", before: null, after }).after,
    );
    expect(out).toEqual({
      name: MASKED_CHANGED,
      tags: MASKED_CHANGED,
      labels: ["ok"],
    });
  });

  it("masks a state that is not a JSON object as a whole", () => {
    const notJson = maskAuditLogStates({
      resourceType: "x",
      before: "plain text",
      after: "plain text",
    });
    expect(parse(notJson.before)).toBe(MASKED);
    expect(parse(notJson.after)).toBe(MASKED);

    const array = maskAuditLogStates({
      resourceType: "x",
      before: null,
      after: JSON.stringify(["a"]),
    });
    expect(parse(array.after)).toBe(MASKED_CHANGED);
  });

  it("masks fields a future upstream merge might add (allow-list, not deny-list)", () => {
    const after = JSON.stringify({
      id: "w1",
      url: "https://example.invalid/hook",
      secretHeader: "abc",
    });
    expect(
      parse(
        maskAuditLogStates({
          resourceType: "webCalloutEndpoint",
          before: null,
          after,
        }).after,
      ),
    ).toEqual({
      id: "w1",
      url: MASKED_CHANGED,
      secretHeader: MASKED_CHANGED,
    });
  });

  it("leaves guardrail settings unmasked: the curated snapshot these roles already read", () => {
    const before = JSON.stringify({ mode: "record", topics: ["x"] });
    const after = JSON.stringify({ mode: "enforce", topics: ["x"] });
    expect(
      maskAuditLogStates({
        resourceType: "acmeGuardrailSettings",
        before,
        after,
      }),
    ).toEqual({ before, after });
  });

  it("allows no field name that usually carries content", () => {
    for (const field of [
      "prompt",
      "input",
      "output",
      "expectedOutput",
      "metadata",
      "comment",
      "value",
      "config",
      "secretKey",
      "displaySecretKey",
      "url",
      "headers",
      "email",
    ]) {
      expect(AUDIT_LOG_METADATA_FIELDS.has(field)).toBe(false);
    }
  });
});
