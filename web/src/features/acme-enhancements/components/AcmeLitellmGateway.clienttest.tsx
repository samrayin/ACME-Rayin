import { buildUpdateKeyLimitsInput } from "@/src/features/acme-enhancements/components/AcmeLitellmGateway";

/**
 * CHG-2026-030 / ADR-0007. `buildUpdateKeyLimitsInput` is the one place that
 * assembles the payload for `acmeLitellm.updateKey`. This dialog exposes only
 * `models` and `rpmLimit` for editing, but the shared `limitsInput` Zod
 * schema (acmeLitellmRouter.ts) defaults every field it does not receive --
 * omitting `maxBudget`/`budgetDuration`/`tpmLimit` does not leave them
 * unchanged, it CLEARS them to their Zod defaults. Every test below asserts
 * these three survive untouched, because that is the hazard this function
 * exists to prevent -- not a general "does the object look right" check.
 */
describe("buildUpdateKeyLimitsInput (CHG-2026-030)", () => {
  const row = {
    id: "key-1",
    maxBudget: 50,
    budgetDuration: "30d",
    tpmLimit: 100_000,
  };

  it("carries maxBudget, budgetDuration and tpmLimit through unchanged, even though none are editable in this dialog", () => {
    const out = buildUpdateKeyLimitsInput(
      "proj-1",
      row,
      ["groq-safeguard"],
      "10",
    );
    expect(out.maxBudget).toBe(50);
    expect(out.budgetDuration).toBe("30d");
    expect(out.tpmLimit).toBe(100_000);
  });

  it("still carries them through when they are null on the row -- not defaulted, not dropped", () => {
    const out = buildUpdateKeyLimitsInput(
      "proj-1",
      { id: "key-1", maxBudget: null, budgetDuration: null, tpmLimit: null },
      [],
      "",
    );
    expect(out.maxBudget).toBeNull();
    expect(out.budgetDuration).toBeNull();
    expect(out.tpmLimit).toBeNull();
  });

  it("sets the edited fields from the form values given, not from the row", () => {
    const out = buildUpdateKeyLimitsInput(
      "proj-1",
      row,
      ["groq-safeguard", "nvidia-nemotron"],
      "10",
    );
    expect(out.models).toEqual(["groq-safeguard", "nvidia-nemotron"]);
    expect(out.rpmLimit).toBe(10);
  });

  it("an empty rpm limit field means no limit (null), not zero and not NaN", () => {
    const out = buildUpdateKeyLimitsInput("proj-1", row, [], "");
    expect(out.rpmLimit).toBeNull();
  });

  it("carries projectId and keyId through for the mutation to scope and target correctly", () => {
    const out = buildUpdateKeyLimitsInput("proj-1", row, [], "5");
    expect(out.projectId).toBe("proj-1");
    expect(out.keyId).toBe("key-1");
  });

  it("every key in the payload maps to what updateKey's input schema expects -- no stray or missing keys", () => {
    const out = buildUpdateKeyLimitsInput("proj-1", row, ["m"], "5");
    expect(Object.keys(out).sort()).toEqual(
      [
        "budgetDuration",
        "keyId",
        "maxBudget",
        "models",
        "projectId",
        "rpmLimit",
        "tpmLimit",
      ].sort(),
    );
  });
});
