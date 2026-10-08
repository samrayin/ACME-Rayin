import { describe, it, expect } from "vitest";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
} from "@langfuse/shared/src/db";
import {
  callerOptions,
  entityTypeCounts,
  matchesFilters,
  policyLabelsOf,
  scopeChecks,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";
import {
  busiestSql,
  callerScopeSql,
  entityTypesSql,
  kindConditionSql,
} from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisionsSql";
import {
  decisionViewQuery,
  describeFilters,
  hasKindFilter,
  isFiltered,
  parseDecisionView,
  verdictFilterLabel,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";
import {
  decisionFlow,
  filtersForStep,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFlow";
import {
  dayMode,
  entityTypeLabel,
  filteredHeadline,
  moreCallersText,
  policyCellText,
} from "@/src/features/acme-enhancements/utils/eyeonGuardrailDecisionsLabels";
import {
  fitSizes,
  flowLayout,
  ribbonPath,
  spreadLabels,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonFlowGeometry";

// CHG-2026-137 (ADR-0027): the Guardrail decisions page's second slice, its
// pure functions: the filters (from a link, to a link, on grouped
// decisions, and as SQL conditions), the personal-data type counts, the
// decision flow's model and geometry, and the new wording.

const { INPUT, OUTPUT } = AcmeGuardrailEventDirection;
const { ALLOW, BLOCK, REDACT, UNAVAILABLE } = AcmeGuardrailEventAction;

function g(
  direction: AcmeGuardrailEventDirection,
  action: AcmeGuardrailEventAction,
  gatewayMode: string | null,
  policyTriggered: string | null,
  n = 1,
) {
  return {
    direction,
    action,
    gatewayMode,
    policyTriggered,
    _count: { _all: n },
  };
}

describe("the view in the URL", () => {
  it("reads the period and the filters a link names, ignoring what it does not know", () => {
    expect(
      parseDecisionView({
        projectId: "p1",
        days: "30",
        direction: "answers",
        verdict: "block",
        caller: "  cairo-claims-bot  ",
        policy: "jailbreak",
        applied: "recorded",
      }),
    ).toEqual({
      windowDays: 30,
      filters: {
        direction: "answers",
        verdict: "block",
        caller: "cairo-claims-bot",
        policyType: "jailbreak",
        applied: "recorded",
      },
    });
    expect(
      parseDecisionView({
        days: "14",
        direction: "sideways",
        verdict: ["block", "allow"],
        caller: "x".repeat(201),
        policy: "Jailbreak Detection",
        applied: "enforce",
      }),
    ).toEqual({ windowDays: 7, filters: {} });
    expect(parseDecisionView({ caller: "   " })).toEqual({
      windowDays: 7,
      filters: {},
    });
  });

  it("writes only what differs from the plain page, keeping the route's own parameters", () => {
    expect(
      decisionViewQuery(
        { projectId: "p1", tab: "x", verdict: "allow", days: "30" },
        {
          windowDays: 7,
          filters: { verdict: "redact", caller: "a,b", applied: "applied" },
        },
      ),
    ).toEqual({
      projectId: "p1",
      tab: "x",
      verdict: "redact",
      caller: "a,b",
      applied: "applied",
    });
    expect(
      decisionViewQuery({ projectId: "p1" }, { windowDays: 30, filters: {} }),
    ).toEqual({ projectId: "p1", days: "30" });
    // Round trip.
    const view = {
      windowDays: 30 as const,
      filters: {
        direction: "prompts" as const,
        policyType: "other" as const,
        caller: "c",
      },
    };
    expect(parseDecisionView(decisionViewQuery({}, view))).toEqual(view);
  });

  it("tells filters on what was decided apart from the caller", () => {
    expect(hasKindFilter({ caller: "c" })).toBe(false);
    expect(isFiltered({ caller: "c" })).toBe(true);
    expect(hasKindFilter({ applied: "applied" })).toBe(true);
    expect(isFiltered({})).toBe(false);
  });

  it("names a verdict as applied, recorded or either, never Blocked for a recorded one", () => {
    expect(verdictFilterLabel("block", undefined)).toBe(
      "Blocked or would block",
    );
    expect(verdictFilterLabel("block", "applied")).toBe("Blocked");
    expect(verdictFilterLabel("block", "recorded")).toBe("Would block");
    expect(verdictFilterLabel("redact", "recorded")).toBe("Would redact");
    expect(verdictFilterLabel("allow", "applied")).toBe("Allowed");
    expect(verdictFilterLabel("unavailable", undefined)).toBe("No verdict");
    expect(
      describeFilters(
        {
          direction: "prompts",
          verdict: "block",
          caller: "k",
          policyType: "jailbreak",
          applied: "recorded",
        },
        "Claims bot",
      ),
    ).toEqual([
      "Prompts",
      "Would block",
      "Caller Claims bot",
      "Policy type Jailbreak or misuse",
      "Recorded only",
    ]);
  });
});

describe("matchesFilters and the scope", () => {
  it("matches direction, verdict and mode; only a reported enforce is applied", () => {
    expect(matchesFilters(g(INPUT, BLOCK, "enforce", null), {})).toBe(true);
    expect(
      matchesFilters(g(OUTPUT, BLOCK, "enforce", null), {
        direction: "prompts",
      }),
    ).toBe(false);
    expect(
      matchesFilters(g(INPUT, REDACT, "enforce", null), { verdict: "block" }),
    ).toBe(false);
    for (const mode of [null, "record", "ENFORCE", "enforced"]) {
      expect(
        matchesFilters(g(INPUT, BLOCK, mode, null), { applied: "applied" }),
      ).toBe(false);
      expect(
        matchesFilters(g(INPUT, BLOCK, mode, null), { applied: "recorded" }),
      ).toBe(true);
    }
  });

  it("matches a policy type on refusals and redactions only, through the scorecard's mapping", () => {
    const jailbreak = { policyType: "jailbreak" as const };
    expect(
      matchesFilters(g(INPUT, BLOCK, null, "Jailbreak Detection"), jailbreak),
    ).toBe(true);
    expect(
      matchesFilters(g(INPUT, ALLOW, null, "Jailbreak Detection"), jailbreak),
    ).toBe(false);
    const other = { policyType: "other" as const };
    expect(matchesFilters(g(INPUT, BLOCK, null, null), other)).toBe(true);
    expect(matchesFilters(g(INPUT, REDACT, null, "something new"), other)).toBe(
      true,
    );
    // No policy reason on allowed checks or checks without a verdict.
    expect(matchesFilters(g(INPUT, ALLOW, null, null), other)).toBe(false);
    expect(matchesFilters(g(INPUT, UNAVAILABLE, null, null), other)).toBe(
      false,
    );
  });

  it("counts every check in scope, whatever it decided", () => {
    expect(
      scopeChecks([
        g(INPUT, ALLOW, null, null, 5),
        g(INPUT, BLOCK, "enforce", "x", 2),
        g(OUTPUT, UNAVAILABLE, null, null, 3),
      ]),
    ).toEqual({ checks: 10, promptChecks: 7, answerChecks: 3 });
  });

  it("lists the stored labels of a type, from refusals and redactions only", () => {
    const groups = [
      g(INPUT, BLOCK, null, "Jailbreak Detection"),
      g(INPUT, BLOCK, null, "jailbreak detection"),
      g(INPUT, ALLOW, null, "Jailbreak Detection v2"),
      g(OUTPUT, REDACT, null, "PII Redaction"),
      g(OUTPUT, BLOCK, null, "something new"),
      g(OUTPUT, BLOCK, null, ""),
      g(OUTPUT, BLOCK, null, null),
    ];
    expect(policyLabelsOf(groups, "jailbreak")).toEqual({
      labels: ["Jailbreak Detection", "jailbreak detection"],
      withMissing: false,
    });
    expect(policyLabelsOf(groups, "other")).toEqual({
      labels: ["", "something new"],
      withMissing: true,
    });
    expect(policyLabelsOf(groups, "sectorRules")).toEqual({
      labels: [],
      withMissing: false,
    });
  });
});

describe("the SQL conditions", () => {
  const scope = {
    projectId: "p",
    from: new Date("2026-10-01T00:00:00.000Z"),
    until: new Date("2026-10-07T12:00:00.000Z"),
    caller: undefined,
  };

  it("is TRUE without a filter, and fixed conditions for each filter", () => {
    expect(kindConditionSql({}, null).sql).toBe("TRUE");
    const kind = kindConditionSql(
      { direction: "answers", verdict: "unavailable", applied: "applied" },
      null,
    );
    expect(kind.sql).toBe(
      "(direction = 'output') AND (action = 'unavailable') AND (gateway_mode = 'enforce')",
    );
    expect(kind.values).toEqual([]);
    expect(kindConditionSql({ applied: "recorded" }, null).sql).toBe(
      "(gateway_mode IS DISTINCT FROM 'enforce')",
    );
  });

  it("binds the policy labels as one array, and handles none and missing", () => {
    const listed = kindConditionSql(
      { policyType: "jailbreak" },
      { labels: ["Jailbreak Detection"], withMissing: false },
    );
    expect(listed.sql).toBe(
      "(action IN ('block', 'redact') AND policy_triggered = ANY(?::text[]))",
    );
    expect(listed.values).toEqual([["Jailbreak Detection"]]);
    expect(
      kindConditionSql(
        { policyType: "other" },
        { labels: ["x"], withMissing: true },
      ).sql,
    ).toBe(
      "(action IN ('block', 'redact') AND (policy_triggered IS NULL OR policy_triggered = ANY(?::text[])))",
    );
    expect(
      kindConditionSql(
        { policyType: "other" },
        { labels: [], withMissing: true },
      ).sql,
    ).toBe("(action IN ('block', 'redact') AND policy_triggered IS NULL)");
    expect(
      kindConditionSql(
        { policyType: "harmfulContent" },
        { labels: [], withMissing: false },
      ).sql,
    ).toBe("(FALSE)");
  });

  it("binds the caller, and never writes a value into the SQL", () => {
    expect(callerScopeSql(undefined).sql).toBe("");
    const caller = callerScopeSql("x'; DROP TABLE y; --");
    expect(caller.sql).toBe("AND agent_id = ?");
    expect(caller.values).toEqual(["x'; DROP TABLE y; --"]);
    const busiest = busiestSql(
      { ...scope, caller: "x'; DROP TABLE y; --" },
      kindConditionSql({}, null),
      "redact",
      5,
    );
    expect(busiest.sql).not.toContain("DROP");
    expect(busiest.sql).toMatch(
      /HAVING COUNT\(\*\) FILTER \(WHERE action = 'redact' AND TRUE\) > 0/,
    );
  });

  it("counts entity types per redaction, reading only the type of a finding", () => {
    const sql = entityTypesSql(scope, kindConditionSql({}, null)).sql;
    expect(sql).toContain("COUNT(DISTINCT e.id)::int AS count");
    expect(sql).toContain("ELSE 'OTHER' END AS type");
    expect(sql).toContain("AND action = 'redact'");
    expect(sql).not.toMatch(
      /redacted_text|raw_content_encrypted|'start'|'end'|'score'/,
    );
  });
});

describe("entityTypeCounts", () => {
  it("keeps only known types and counts, merges the rest into OTHER, most frequent first", () => {
    expect(
      entityTypeCounts([
        { type: "PERSON", count: 2 },
        { type: "EMAIL_ADDRESS", count: 5 },
        { type: "a matched value", count: 1 },
        { type: "OTHER", count: 2 },
        { type: 42, count: 1 },
        { type: "IBAN_CODE", count: 0 },
        { type: "BH_CPR", count: "3" },
        { type: "PHONE_NUMBER", count: 2.7 },
      ]),
    ).toEqual([
      { type: "EMAIL_ADDRESS", count: 5 },
      { type: "OTHER", count: 4 },
      { type: "PHONE_NUMBER", count: 2 },
      { type: "PERSON", count: 2 },
    ]);
    expect(entityTypeCounts([])).toEqual([]);
  });

  it("returns nothing but the type and the count of a row", () => {
    const [row] = entityTypeCounts([
      { type: "EMAIL_ADDRESS", count: 1, start: 0, end: 9, text: "secret" } as {
        type: unknown;
        count: unknown;
      },
    ]);
    expect(Object.keys(row!).sort()).toEqual(["count", "type"]);
  });

  it("names the types in words", () => {
    expect(entityTypeLabel("EMAIL_ADDRESS")).toBe("Email");
    expect(entityTypeLabel("BH_CPR")).toBe("Bahrain CPR number");
    expect(entityTypeLabel("OTHER")).toBe("Other or unknown type");
    expect(entityTypeLabel("ANYTHING")).toBe("Other or unknown type");
  });
});

describe("callerOptions", () => {
  it("keeps the order read and names an application only where known", () => {
    expect(
      callerOptions(
        [
          { agentId: "k-2", _count: { _all: 9 } },
          { agentId: "probe", _count: { _all: 3 } },
        ],
        new Map([["k-2", { lineageId: "l1", name: "Claims bot" }]]),
      ),
    ).toEqual([
      {
        alias: "k-2",
        checks: 9,
        application: { lineageId: "l1", name: "Claims bot" },
      },
      { alias: "probe", checks: 3, application: null },
    ]);
    expect(
      callerOptions([{ agentId: "k-2", _count: { _all: 9 } }], null)[0]
        ?.application,
    ).toBeNull();
  });
});

describe("the decision flow", () => {
  const split = (enforced: number, notEnforced: number) => ({
    enforced,
    notEnforced,
  });
  const prompts = {
    checks: 90,
    allowed: 80,
    blocked: split(2, 3),
    redacted: split(0, 4),
    noVerdict: 1,
  };
  const answers = {
    checks: 10,
    allowed: 8,
    blocked: split(1, 0),
    redacted: split(1, 0),
    noVerdict: 0,
  };

  it("flows checks into direction, verdict, then applied or recorded, in the log's words", () => {
    const flow = decisionFlow({
      prompts,
      answers,
      filters: {},
      period: "last 7 days",
    });
    expect(flow.total).toBe(100);
    const value = (id: string) => flow.nodes.find((n) => n.id === id);
    expect(value("checks")).toMatchObject({ name: "Checks", value: 100 });
    expect(value("prompts")?.value).toBe(90);
    expect(value("block")).toMatchObject({ name: "Block verdict", value: 6 });
    expect(value("blocked")).toMatchObject({ name: "Blocked", value: 3 });
    expect(value("wouldBlock")).toMatchObject({
      name: "Would block",
      value: 3,
      muted: true,
    });
    expect(value("redacted")).toMatchObject({ name: "Redacted", value: 1 });
    expect(value("wouldRedact")).toMatchObject({
      name: "Would redact",
      value: 4,
    });
    expect(flow.links).toContainEqual({
      source: "prompts",
      target: "block",
      value: 5,
    });
    expect(flow.links).toContainEqual({
      source: "answers",
      target: "redact",
      value: 1,
    });
    expect(flow.label).toBe(
      "Decision flow, last 7 days: 100 checks; 90 prompts and 10 answers; 88 allowed; " +
        "6 block verdicts (3 blocked, 3 would block); 5 redact verdicts (1 redacted, 4 would redact); 1 without a verdict.",
    );
    // What flows out of a step never exceeds what flows in.
    for (const node of flow.nodes) {
      const inflow = flow.links
        .filter((l) => l.target === node.id)
        .reduce((s, l) => s + l.value, 0);
      const outflow = flow.links
        .filter((l) => l.source === node.id)
        .reduce((s, l) => s + l.value, 0);
      if (node.id !== "checks") expect(inflow).toBe(node.value);
      expect(outflow).toBeLessThanOrEqual(node.value);
    }
  });

  it("says Matching decisions while a filter narrows them, and marks the selected steps", () => {
    const flow = decisionFlow({
      prompts,
      answers,
      filters: { verdict: "block", applied: "recorded" },
      period: "last 7 days",
    });
    expect(flow.nodes[0]?.name).toBe("Matching decisions");
    expect(flow.label).toMatch(
      /^Decision flow, last 7 days: 100 matching decisions;/,
    );
    expect(flow.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual([
      "block",
      "wouldBlock",
    ]);
  });

  it("filters the page from a step, and clears it on a second press", () => {
    expect(filtersForStep("prompts", { caller: "c" })).toEqual({
      caller: "c",
      direction: "prompts",
    });
    expect(
      filtersForStep("prompts", { caller: "c", direction: "prompts" }),
    ).toEqual({ caller: "c" });
    expect(filtersForStep("wouldBlock", {})).toEqual({
      verdict: "block",
      applied: "recorded",
    });
    expect(
      filtersForStep("checks", {
        caller: "c",
        direction: "answers",
        verdict: "allow",
        policyType: "other",
        applied: "applied",
      }),
    ).toEqual({ caller: "c" });
  });
});

describe("the flow geometry", () => {
  it("fills the space in proportion, keeping small values at the minimum", () => {
    expect(fitSizes([1, 1], 100, 4)).toEqual([50, 50]);
    const sizes = fitSizes([1000, 1, 0], 200, 6);
    expect(sizes[1]).toBe(6);
    expect(sizes[2]).toBe(0);
    expect(sizes[0]! + sizes[1]!).toBeCloseTo(200);
  });

  it("spreads labels at least a gap apart, within bounds, in order", () => {
    expect(spreadLabels([10, 12, 14], 0, 100, 10)).toEqual([10, 20, 30]);
    expect(spreadLabels([95, 96], 0, 100, 10)).toEqual([90, 100]);
    expect(spreadLabels([50, 10], 0, 100, 10)).toEqual([50, 10]);
  });

  it("draws a closed ribbon between two bars", () => {
    expect(ribbonPath(0, 0, 10, 100, 20, 25)).toBe(
      "M0 0 C50 0 50 20 100 20 L100 25 C50 25 50 10 0 10 Z",
    );
  });

  it("places nodes in columns and ribbons that leave and arrive within their nodes", () => {
    const box = {
      width: 400,
      height: 200,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      bar: 10,
      gap: 10,
      minNode: 4,
      labelGap: 20,
    };
    const layout = flowLayout(
      [
        { id: "a", column: 0, value: 100 },
        { id: "b", column: 1, value: 99 },
        { id: "c", column: 1, value: 1 },
        { id: "d", column: 1, value: 0 },
      ],
      [
        { source: "a", target: "b", value: 99 },
        { source: "a", target: "c", value: 1 },
        { source: "a", target: "d", value: 0 },
      ],
      box,
    );
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    const [a, b, c] = layout.nodes;
    expect(a).toMatchObject({ x: 0, y: 0, h: 200 });
    expect(b!.x).toBe(390);
    expect(c!.h).toBe(4);
    expect(b!.h + c!.h + box.gap).toBeCloseTo(200);
    expect(layout.links.map((l) => `${l.source}-${l.target}`)).toEqual([
      "a-b",
      "a-c",
    ]);
    expect(layout.links[0]!.path).toMatch(/^M10 0 /);
  });
});

describe("CHG-2026-137 wording", () => {
  it("heads a filtered view with its matching decisions out of every check", () => {
    expect(filteredHeadline({ matching: 0, checks: 0, windowDays: 7 })).toBe(
      "No guardrail checks in the last 7 days.",
    );
    expect(filteredHeadline({ matching: 0, checks: 50, windowDays: 7 })).toBe(
      "No decision matches these filters, out of 50 guardrail checks.",
    );
    expect(filteredHeadline({ matching: 1, checks: 200, windowDays: 7 })).toBe(
      "1 decision matches these filters: <1% of 200 guardrail checks.",
    );
    expect(
      filteredHeadline({ matching: 50, checks: 200, windowDays: 30 }),
    ).toBe("50 decisions match these filters: 25% of 200 guardrail checks.");
  });

  it("writes a policy cell in the decision log's words", () => {
    const none = { enforced: 0, notEnforced: 0 };
    expect(policyCellText({ blocked: none, redacted: none })).toBe("None");
    expect(
      policyCellText({
        blocked: { enforced: 2, notEnforced: 1 },
        redacted: { enforced: 0, notEnforced: 3 },
      }),
    ).toBe("2 blocked, 1 would block; 3 would redact");
  });

  it("names the gateway's mode on a day from its checks", () => {
    expect(dayMode(0, 0)).toBe("none");
    expect(dayMode(5, 5)).toBe("enforce");
    expect(dayMode(5, 0)).toBe("record");
    expect(dayMode(5, 2)).toBe("mixed");
  });

  it("says how many more callers there are, by what the card counts", () => {
    expect(moreCallersText(1, "block")).toBe("1 more caller had a refusal.");
    expect(moreCallersText(3, "unavailable")).toBe(
      "3 more callers had a check without a verdict.",
    );
  });
});
