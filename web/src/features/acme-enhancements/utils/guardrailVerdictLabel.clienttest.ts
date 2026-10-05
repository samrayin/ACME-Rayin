import { describe, expect, it } from "vitest";
import {
  gatewayModeFromDb,
  gatewayModeLabel,
  guardrailVerdictLabel,
} from "./guardrailVerdictLabel";

describe("guardrail verdict labels (CHG-2026-116)", () => {
  it("says Blocked and Redacted only when the gateway was enforcing", () => {
    expect(guardrailVerdictLabel("block", "enforce").label).toBe("Blocked");
    expect(guardrailVerdictLabel("redact", "enforce").label).toBe("Redacted");
  });

  it("says Would block and Would redact in record mode", () => {
    expect(guardrailVerdictLabel("block", "record").label).toBe("Would block");
    expect(guardrailVerdictLabel("redact", "record").label).toBe(
      "Would redact",
    );
  });

  it("treats an unreported mode as not enforced", () => {
    expect(guardrailVerdictLabel("block", null).label).toBe("Would block");
    expect(guardrailVerdictLabel("redact", null).label).toBe("Would redact");
  });

  it("leaves Allowed and No verdict as they were, in every mode", () => {
    for (const mode of ["enforce", "record", null] as const) {
      expect(guardrailVerdictLabel("allow", mode).label).toBe("Allowed");
      expect(guardrailVerdictLabel("unavailable", mode).label).toBe(
        "No verdict",
      );
    }
  });

  it("reads only the two known modes from the database", () => {
    expect(gatewayModeFromDb("enforce")).toBe("enforce");
    expect(gatewayModeFromDb("record")).toBe("record");
    expect(gatewayModeFromDb("ENFORCE")).toBeNull();
    expect(gatewayModeFromDb("")).toBeNull();
    expect(gatewayModeFromDb(null)).toBeNull();
    expect(gatewayModeLabel(null)).toBe("Not reported");
  });
});
