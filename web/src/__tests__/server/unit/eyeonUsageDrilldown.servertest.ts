import {
  NO_USER,
  OTHER_KEYS,
  promptTypes,
  usageByApplication,
  usageByUser,
} from "@/src/features/acme-enhancements/server/eyeonUsageDrilldown";

describe("eyeonUsageDrilldown", () => {
  describe("usageByApplication", () => {
    const byAlias = new Map([
      ["hr-bot-v1", { lineageId: "L1", name: "HR bot" }],
      ["hr-bot-v2", { lineageId: "L1", name: "HR bot" }],
      ["legal", { lineageId: "L2", name: "Legal" }],
    ]);

    it("sums every generation of a key into its application, costliest first", () => {
      const rows = usageByApplication(
        [
          {
            alias: "hr-bot-v1",
            calls: 2,
            failed: 1,
            spend: 1,
            totalTokens: 10,
          },
          {
            alias: "hr-bot-v2",
            calls: 3,
            failed: 0,
            spend: 2,
            totalTokens: 20,
          },
          { alias: "legal", calls: 1, failed: 0, spend: 9, totalTokens: 5 },
        ],
        [
          { alias: "hr-bot-v1", checks: 4, flagged: 1 },
          { alias: "hr-bot-v2", checks: 2, flagged: 1 },
        ],
        byAlias,
      );
      expect(rows.map((r) => r.name)).toEqual(["Legal", "HR bot"]);
      expect(rows[1]).toMatchObject({
        lineageId: "L1",
        calls: 5,
        failed: 1,
        spendUsd: 3,
        totalTokens: 30,
        checks: 6,
        flagged: 2,
      });
    });

    it("sums unknown aliases into one row with no lineage", () => {
      const rows = usageByApplication(
        [
          { alias: "gone", calls: 1, failed: 0, spend: 1, totalTokens: 1 },
          { alias: "", calls: 1, failed: 0, spend: 1, totalTokens: 1 },
        ],
        [],
        byAlias,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        lineageId: null,
        name: OTHER_KEYS,
        calls: 2,
        spendUsd: 2,
      });
    });
  });

  describe("usageByUser", () => {
    it("joins cost and flags on the user id and groups missing ids", () => {
      const rows = usageByUser(
        [
          { user: "a@x", calls: 2, failed: 0, spend: 1, totalTokens: 4 },
          { user: null, calls: 1, failed: 1, spend: 5, totalTokens: 1 },
        ],
        [
          { user: "a@x", checks: 3, flagged: 2 },
          { user: "  ", checks: 1, flagged: 0 },
          { user: "b@x", checks: 1, flagged: 1 },
        ],
      );
      expect(rows.map((r) => r.user)).toEqual([NO_USER, "a@x", "b@x"]);
      expect(rows[0]).toMatchObject({ calls: 1, checks: 1, spendUsd: 5 });
      expect(rows[1]).toMatchObject({ calls: 2, checks: 3, flagged: 2 });
    });
  });

  describe("promptTypes", () => {
    it("maps policy labels to types and counts clean and unknown separately", () => {
      const result = promptTypes([
        { policyTriggered: null, action: "allow", count: 7 },
        { policyTriggered: "Jailbreak Detection", action: "block", count: 3 },
        { policyTriggered: "PII", action: "redact", count: 2 },
        { policyTriggered: "something new", action: "block", count: 1 },
        { policyTriggered: null, action: "unavailable", count: 1 },
      ]);
      expect(result.checked).toBe(14);
      expect(result.clean).toBe(7);
      expect(result.noVerdict).toBe(1);
      expect(result.types.map((t) => [t.type, t.total])).toEqual([
        ["jailbreak", 3],
        ["personalData", 2],
        ["other", 1],
      ]);
      expect(result.types[1]).toMatchObject({ redacted: 2, blocked: 0 });
    });
  });
});
