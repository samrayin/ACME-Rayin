import { describe, expect, it } from "vitest";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  AcmeLitellmEventOutcome,
  AcmeLitellmEventPhase,
  AcmeLitellmKeyStatus,
} from "@langfuse/shared/src/db";
import {
  type ChangeRow,
  type DecisionRow,
  type GenerationRow,
  type GuardrailGroup,
  type RequestRow,
  buildApplicationScorecard,
  callCountsByAlias,
  changeView,
  changedSettings,
  currentGeneration,
  dailyActivity,
  decisionView,
  decisionsByRequest,
  emptyGuardrailCounts,
  generationView,
  guardrailCountsByAlias,
  requestCallIds,
  requestView,
  trendRowsByAlias,
} from "@/src/features/acme-enhancements/server/acmeApplicationDetail";
import { trendStart } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import {
  GUARDRAIL_AGENTS_MAX,
  formatAgentsParam,
  linkedAgents,
  parseAgentsParam,
} from "@/src/features/acme-enhancements/utils/guardrailAgentLink";

// CHG-2026-125 (ADR-0023 §3.5): the application detail screen's shaping, and
// the aggregation it shares with the Applications scorecard. Pure functions,
// so no database. The router's access rules and selects are pinned in
// acmeApplicationsDetailRouter.servertest.ts.

const NOW = new Date("2026-10-06T12:00:00.000Z");
const TOKEN_HASH =
  "9f2c1e7d5b3a8c6e4f0d2b9a7c5e3f1d8b6a4c2e0f9d7b5a3c1e8f6d4b2a0c9e";
const V1 = "cairo-hr-bot-1a2b3c4d";
const V2 = "cairo-hr-bot-1a2b3c4d-r2";

function group(
  agentId: string,
  direction: AcmeGuardrailEventDirection,
  action: AcmeGuardrailEventAction,
  n: number,
  extra: Partial<GuardrailGroup> = {},
): GuardrailGroup {
  return {
    agentId,
    direction,
    action,
    policyTriggered: null,
    gatewayMode: "enforce",
    _count: { _all: n },
    ...extra,
  };
}

describe("aggregation shared with the scorecards query", () => {
  it("counts checks, refusals, redactions, no-verdicts and enforced checks per alias", () => {
    const { counts, refusals } = guardrailCountsByAlias([
      group(
        V1,
        AcmeGuardrailEventDirection.INPUT,
        AcmeGuardrailEventAction.ALLOW,
        10,
      ),
      group(
        V1,
        AcmeGuardrailEventDirection.INPUT,
        AcmeGuardrailEventAction.BLOCK,
        2,
        { policyTriggered: "Jailbreak Detection" },
      ),
      group(
        V1,
        AcmeGuardrailEventDirection.OUTPUT,
        AcmeGuardrailEventAction.BLOCK,
        1,
        { policyTriggered: "Topical Rail", gatewayMode: "record" },
      ),
      group(
        V1,
        AcmeGuardrailEventDirection.OUTPUT,
        AcmeGuardrailEventAction.REDACT,
        3,
        { gatewayMode: null },
      ),
      group(
        V2,
        AcmeGuardrailEventDirection.INPUT,
        AcmeGuardrailEventAction.UNAVAILABLE,
        4,
      ),
    ]);
    expect(counts.get(V1)).toEqual({
      promptChecks: 12,
      answerChecks: 4,
      promptBlocks: 2,
      answerBlocks: 1,
      redactions: 3,
      noVerdict: 0,
      enforcedChecks: 12,
    });
    expect(counts.get(V2)).toEqual({
      ...emptyGuardrailCounts(),
      promptChecks: 4,
      noVerdict: 4,
      enforcedChecks: 4,
    });
    expect(refusals.get(V1)).toEqual([
      { policyTriggered: "Jailbreak Detection", count: 2 },
      { policyTriggered: "Topical Rail", count: 1 },
    ]);
    expect(refusals.get(V2)).toBeUndefined();
  });

  it("counts calls, failures and spend per alias, skipping rows without one", () => {
    const calls = callCountsByAlias([
      {
        keyAlias: V1,
        status: "success",
        _count: { _all: 8 },
        _sum: { spend: 1.5 },
      },
      {
        keyAlias: V1,
        status: "failure",
        _count: { _all: 2 },
        _sum: { spend: null },
      },
      {
        keyAlias: null,
        status: "success",
        _count: { _all: 99 },
        _sum: { spend: 9 },
      },
    ]);
    expect(calls.get(V1)).toEqual({ calls: 10, failed: 2, spend: 1.5 });
    expect(calls.size).toBe(1);
  });

  it("scores every generation's traffic against the current generation's settings", () => {
    const trendFrom = trendStart(NOW, 7);
    const current = {
      lineageId: "lin-1",
      generation: 2,
      displayName: "HR bot",
      litellmKeyAlias: V2,
      models: ["hr-assistant"],
      rpmLimit: 20,
      maxBudget: 50,
      budgetDuration: "30d",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    const args = {
      current,
      aliases: [V1, V2],
      guard: guardrailCountsByAlias([
        group(
          V1,
          AcmeGuardrailEventDirection.INPUT,
          AcmeGuardrailEventAction.ALLOW,
          10,
        ),
        group(
          V2,
          AcmeGuardrailEventDirection.INPUT,
          AcmeGuardrailEventAction.ALLOW,
          10,
        ),
      ]),
      calls: callCountsByAlias([
        {
          keyAlias: V1,
          status: "success",
          _count: { _all: 10 },
          _sum: { spend: 1 },
        },
        {
          keyAlias: V2,
          status: "success",
          _count: { _all: 10 },
          _sum: { spend: 2 },
        },
      ]),
      trendRows: trendRowsByAlias(
        [
          { alias: V1, day: "2026-10-01", n: 10 },
          { alias: V2, day: "2026-10-05", n: 10 },
        ],
        [{ alias: V2, day: "2026-10-05", n: 1 }],
      ),
      mode: "enforce" as const,
      now: NOW,
      trendFrom,
      windowDays: 7,
    };
    const seen = buildApplicationScorecard({ ...args, canSeeSpend: true });
    expect(seen.input.calls).toBe(20);
    expect(seen.input.guard.promptChecks).toBe(20);
    expect(seen.input.spendUsd).toBe(3);
    expect(seen.app).toMatchObject({
      lineageId: "lin-1",
      name: "HR bot",
      alias: V2,
      generation: 2,
    });
    expect(seen.app.trend.find((p) => p.day === "2026-10-05")).toEqual({
      day: "2026-10-05",
      calls: 10,
      refused: 1,
    });
    expect(
      seen.score.dimensions.find((d) => d.dimension === "protection"),
    ).toMatchObject({ band: "green" });

    const hidden = buildApplicationScorecard({ ...args, canSeeSpend: false });
    expect(hidden.input.spendUsd).toBeNull();
    expect(
      hidden.score.dimensions.find((d) => d.dimension === "spend"),
    ).toMatchObject({ band: "none", evidence: "Not shown for your role." });
  });
});

function generation(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: "key-1",
    generation: 1,
    displayName: "HR bot",
    litellmKeyAlias: V1,
    status: AcmeLitellmKeyStatus.ACTIVE,
    models: ["hr-assistant"],
    rpmLimit: 20,
    tpmLimit: null,
    maxBudget: 50,
    budgetDuration: "30d",
    expiresAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

describe("generations", () => {
  it("the current generation is the newest active one", () => {
    const g1 = generation({ status: AcmeLitellmKeyStatus.ROTATED });
    const g2 = generation({ id: "key-2", generation: 2 });
    const g3 = generation({
      id: "key-3",
      generation: 3,
      status: AcmeLitellmKeyStatus.FAILED,
    });
    expect(currentGeneration([g1, g2, g3])?.id).toBe("key-2");
    expect(currentGeneration([g3, g2, g1])?.id).toBe("key-2");
    expect(
      currentGeneration([g1, { ...g2, status: AcmeLitellmKeyStatus.REVOKED }]),
    ).toBeUndefined();
  });

  it("a rotated key ends in a rotation, a revoked one in a revocation, and no token hash is shown", () => {
    const ended = new Date("2026-10-01T09:00:00.000Z");
    const rotated = generationView(
      generation({
        status: AcmeLitellmKeyStatus.ROTATED,
        revokedAt: ended,
        ...({ tokenHash: TOKEN_HASH } as object),
      }),
      "key-2",
    );
    expect(rotated).toMatchObject({
      generation: 1,
      alias: V1,
      status: "ROTATED",
      current: false,
      rotatedAt: ended.toISOString(),
      revokedAt: null,
    });
    expect(JSON.stringify(rotated)).not.toContain(TOKEN_HASH);
    expect(
      generationView(
        generation({ status: AcmeLitellmKeyStatus.REVOKED, revokedAt: ended }),
        "key-2",
      ),
    ).toMatchObject({ rotatedAt: null, revokedAt: ended.toISOString() });
    expect(generationView(generation(), "key-1").current).toBe(true);
  });
});

function decision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    traceId: "call-1",
    eventTime: new Date("2026-10-06T10:00:01.000Z"),
    direction: AcmeGuardrailEventDirection.INPUT,
    action: AcmeGuardrailEventAction.BLOCK,
    policyTriggered: "Jailbreak Detection",
    gatewayMode: "enforce",
    ...overrides,
  };
}

function request(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: "req-1",
    requestId: "chatcmpl-1",
    litellmCallId: "call-1",
    startTime: new Date("2026-10-06T10:00:00.000Z"),
    endTime: new Date("2026-10-06T10:00:01.250Z"),
    status: "success",
    errorClass: null,
    model: "gpt-4o-2024-08-06",
    modelGroup: "hr-assistant",
    keyAlias: V2,
    endUser: "user-7",
    spend: 0.0042,
    ...overrides,
  };
}

describe("requests and their guardrail decisions", () => {
  it("a decision shows direction, verdict, mode and policy label only", () => {
    expect(decisionView(decision({ gatewayMode: "bogus" }))).toEqual({
      time: "2026-10-06T10:00:01.000Z",
      direction: "input",
      action: "block",
      mode: null,
      policy: "Jailbreak Detection",
    });
  });

  it("looks decisions up by the gateway call id, and by the request id a failed call carries", () => {
    expect(
      requestCallIds([
        request(),
        request({ id: "req-2", requestId: "call-2", litellmCallId: null }),
        request({ id: "req-3", requestId: "call-1", litellmCallId: "call-1" }),
      ]),
    ).toEqual(["call-1", "chatcmpl-1", "call-2"]);
  });

  it("puts each request's decisions beside it, prompt first, in time order", () => {
    const answer = decision({
      direction: AcmeGuardrailEventDirection.OUTPUT,
      action: AcmeGuardrailEventAction.ALLOW,
      eventTime: new Date("2026-10-06T10:00:01.000Z"),
    });
    const prompt = decision({
      action: AcmeGuardrailEventAction.ALLOW,
      eventTime: new Date("2026-10-06T10:00:01.000Z"),
    });
    const failedCall = decision({
      traceId: "call-2",
      action: AcmeGuardrailEventAction.UNAVAILABLE,
    });
    const other = decision({ traceId: "call-9" });
    const noTrace = decision({ traceId: null });
    const byRequest = decisionsByRequest(
      [
        request(),
        request({ id: "req-2", requestId: "call-2", litellmCallId: null }),
        request({ id: "req-3", requestId: "x", litellmCallId: "call-3" }),
      ],
      [answer, prompt, failedCall, other, noTrace],
    );
    expect(byRequest.get("req-1")?.map((d) => d.direction)).toEqual([
      "input",
      "output",
    ]);
    expect(byRequest.get("req-2")?.map((d) => d.action)).toEqual([
      "unavailable",
    ]);
    expect(byRequest.get("req-3")).toEqual([]);
  });

  it("a request shows its cost only to a viewer who may see spend, and never its ids", () => {
    const generations = new Map([
      [V1, 1],
      [V2, 2],
    ]);
    const seen = requestView(request(), [], generations, true);
    expect(seen).toEqual({
      id: "req-1",
      time: "2026-10-06T10:00:00.000Z",
      generation: 2,
      model: "hr-assistant",
      succeeded: true,
      errorClass: null,
      latencyMs: 1250,
      endUser: "user-7",
      traceId: null,
      costUsd: 0.0042,
      decisions: [],
    });
    const hidden = requestView(
      request({ spend: undefined }),
      [],
      generations,
      false,
    );
    expect(hidden).not.toHaveProperty("costUsd");
    expect(JSON.stringify(seen)).not.toMatch(/chatcmpl-1|call-1/);
    expect(
      requestView(
        request({ endTime: null, status: "failure", keyAlias: "other" }),
        [],
        generations,
        false,
      ),
    ).toMatchObject({ latencyMs: null, succeeded: false, generation: null });
  });

  it("carries the request's trace id when the gateway reported it (CHG-2026-126)", () => {
    const trace = "7d3d2f1851f40750904d06da26885983";
    expect(
      requestView(request({ otelTraceId: trace }), [], new Map(), false),
    ).toMatchObject({ traceId: trace });
    expect(
      requestView(request({ otelTraceId: null }), [], new Map(), false),
    ).toMatchObject({ traceId: null });
  });
});

describe("daily activity", () => {
  const start = trendStart(NOW, 3);

  it("one point per UTC day, zeros where nothing happened, generations summed", () => {
    expect(
      dailyActivity(
        start,
        3,
        [
          { day: "2026-10-04", calls: 3, failed: 1, spend: 0.5 },
          { day: "2026-10-04", calls: 2, failed: 0, spend: 0.25 },
          { day: "2026-10-06", calls: 1, failed: 0, spend: null },
          { day: "2026-09-30", calls: 9, failed: 9, spend: 9 },
        ],
        [{ day: "2026-10-06", n: 1 }],
        true,
      ),
    ).toEqual([
      { day: "2026-10-04", calls: 5, failed: 1, refused: 0, spendUsd: 0.75 },
      { day: "2026-10-05", calls: 0, failed: 0, refused: 0, spendUsd: 0 },
      { day: "2026-10-06", calls: 1, failed: 0, refused: 1, spendUsd: 0 },
    ]);
  });

  it("has no spend field at all for a viewer who may not see spend", () => {
    const points = dailyActivity(
      start,
      3,
      [{ day: "2026-10-04", calls: 3, failed: 1, spend: 0.5 }],
      [],
      false,
    );
    for (const p of points) expect(p).not.toHaveProperty("spendUsd");
  });
});

const KEY_VIEW = {
  id: "key-1",
  displayName: "HR bot",
  alias: V1,
  tokenHash: TOKEN_HASH,
  teamId: null,
  status: "ACTIVE",
  models: ["hr-assistant"],
  maxBudget: 50,
  budgetDuration: "30d",
  rpmLimit: 20,
  tpmLimit: null,
  expiresAt: null,
  generation: 1,
  lineageId: "lin-1",
};

describe("change record", () => {
  it("lists only the allow-listed settings that changed, never the token hash", () => {
    const changes = changedSettings(KEY_VIEW, {
      ...KEY_VIEW,
      tokenHash: "a-different-hash",
      models: ["hr-assistant", "hr-assistant-mini"],
      rpmLimit: 40,
    });
    expect(changes).toEqual([
      {
        setting: "models",
        label: "Models",
        from: ["hr-assistant"],
        to: ["hr-assistant", "hr-assistant-mini"],
      },
      {
        setting: "rpmLimit",
        label: "Requests per minute",
        from: 20,
        to: 40,
      },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/hash/i);
  });

  it("a creation lists the settings the key was created with", () => {
    expect(
      changedSettings(null, KEY_VIEW).map((c) => [c.setting, c.from, c.to]),
    ).toEqual([
      ["displayName", null, "HR bot"],
      ["alias", null, V1],
      ["status", null, "ACTIVE"],
      ["models", null, ["hr-assistant"]],
      ["maxBudget", null, 50],
      ["budgetDuration", null, "30d"],
      ["rpmLimit", null, 20],
    ]);
  });

  it("an intent row, a rotation's summary and a revocation", () => {
    expect(changedSettings(KEY_VIEW, null)).toEqual([]);
    expect(
      changedSettings(KEY_VIEW, {
        oldKeyId: "key-1",
        newKey: { ...KEY_VIEW, id: "key-2", tokenHash: "new-hash" },
      }),
    ).toEqual([]);
    expect(
      changedSettings(KEY_VIEW, {
        ...KEY_VIEW,
        status: "REVOKED",
        alreadyAbsentInLitellm: false,
      }),
    ).toEqual([
      { setting: "status", label: "Status", from: "ACTIVE", to: "REVOKED" },
    ]);
  });

  it("bounds what it reads out of a stored value", () => {
    const [name, models, budget] = changedSettings(
      { displayName: "a", models: [], maxBudget: 1 },
      {
        displayName: "x".repeat(500),
        models: ["m", 7, { nested: TOKEN_HASH }],
        maxBudget: { $gt: 0 },
      },
    );
    expect(name?.to).toHaveLength(200);
    expect(models?.to).toEqual(["m"]);
    expect(budget).toMatchObject({ from: 1, to: null });
  });

  it("a row names its generation and actor, and returns no before or after", () => {
    const row: ChangeRow = {
      id: "ev-1",
      eventTime: new Date("2026-10-02T08:00:00.000Z"),
      phase: AcmeLitellmEventPhase.OUTCOME,
      outcome: AcmeLitellmEventOutcome.SUCCESS,
      action: "key.update",
      resourceId: "key-2",
      actorUserId: "user-1",
      actorOrgRole: "OWNER",
      actorProjectRole: null,
      before: KEY_VIEW,
      after: { ...KEY_VIEW, rpmLimit: 40 },
    };
    const view = changeView(
      row,
      new Map([["key-2", 2]]),
      new Map([["user-1", "Ana Admin"]]),
    );
    expect(view).toEqual({
      id: "ev-1",
      time: "2026-10-02T08:00:00.000Z",
      action: "key.update",
      phase: "outcome",
      outcome: "succeeded",
      generation: 2,
      actor: "Ana Admin",
      role: "OWNER",
      changes: [
        { setting: "rpmLimit", label: "Requests per minute", from: 20, to: 40 },
      ],
    });
    expect(JSON.stringify(view)).not.toContain(TOKEN_HASH);
    expect(
      changeView(
        { ...row, phase: AcmeLitellmEventPhase.INTENT, outcome: null },
        new Map(),
        new Map(),
      ),
    ).toMatchObject({
      phase: "intent",
      outcome: null,
      generation: null,
      actor: "Unknown user",
      changes: [{ setting: "rpmLimit" }],
    });
  });
});

describe("the guardrail log's exact agent link", () => {
  it("reads ?agents= as trimmed, unique, bounded agent ids", () => {
    expect(parseAgentsParam(` ${V1} ,${V2},,${V1}`)).toEqual([V1, V2]);
    expect(parseAgentsParam(undefined)).toEqual([]);
    expect(parseAgentsParam([V1, V2])).toEqual([]);
    expect(parseAgentsParam(`${"x".repeat(201)},${V1}`)).toEqual([V1]);
    const many = Array.from({ length: 30 }, (_, i) => `a${i}`).join(",");
    expect(parseAgentsParam(many)).toHaveLength(GUARDRAIL_AGENTS_MAX);
  });

  it("a link names every alias, or the newest ones and how many it left out", () => {
    expect(linkedAgents([V1, V2, V1])).toEqual({
      agents: [V1, V2],
      omitted: 0,
    });
    const aliases = Array.from({ length: 25 }, (_, i) => `k-r${i + 1}`);
    const { agents, omitted } = linkedAgents(aliases);
    expect(agents).toHaveLength(GUARDRAIL_AGENTS_MAX);
    expect(agents[agents.length - 1]).toBe("k-r25");
    expect(omitted).toBe(5);
    expect(parseAgentsParam(formatAgentsParam(agents))).toEqual(agents);
  });
});
