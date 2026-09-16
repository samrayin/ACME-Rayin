import { describe, it, expect } from "vitest";
import { maskPii } from "./piiMask";

describe("maskPii", () => {
  it("redacts an email address in a plain string", () => {
    expect(maskPii({ data: "contact jane.doe@acme.com for details" })).toBe(
      "contact [EMAIL_REDACTED] for details",
    );
  });

  it("redacts a phone number", () => {
    expect(maskPii({ data: "call me at +1 (555) 123-4567" })).toBe(
      "call me at [PHONE_REDACTED]",
    );
  });

  it("redacts a credit-card-shaped digit run", () => {
    expect(maskPii({ data: "card 4111 1111 1111 1111 on file" })).toBe(
      "card [CARD_REDACTED] on file",
    );
  });

  it("redacts an IBAN", () => {
    expect(maskPii({ data: "IBAN GB29NWBK60161331926819 for the transfer" })).toBe(
      "IBAN [IBAN_REDACTED] for the transfer",
    );
  });

  it("redacts an IPv4 address", () => {
    expect(maskPii({ data: "request came from 203.0.113.42" })).toBe(
      "request came from [IP_REDACTED]",
    );
  });

  it("recurses into nested objects and arrays, masking only string leaves", () => {
    const input = {
      user: { email: "a@b.com", age: 30 },
      notes: ["reach b@c.com", "no pii here"],
      active: true,
    };
    expect(maskPii({ data: input })).toEqual({
      user: { email: "[EMAIL_REDACTED]", age: 30 },
      notes: ["reach [EMAIL_REDACTED]", "no pii here"],
      active: true,
    });
  });

  it("passes through non-string, non-object values untouched", () => {
    expect(maskPii({ data: 42 })).toBe(42);
    expect(maskPii({ data: null })).toBe(null);
    expect(maskPii({ data: undefined })).toBe(undefined);
    expect(maskPii({ data: true })).toBe(true);
  });

  it("leaves text with no PII unchanged", () => {
    expect(maskPii({ data: "summarize the last 3 backup jobs" })).toBe(
      "summarize the last 3 backup jobs",
    );
  });
});
