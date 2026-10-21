import { describe, it, expect } from "vitest";
import {
  GATEWAY_REFUSAL_EVENT_ID_PREFIX,
  gatewayRefusalOutcome,
  selectGatewayRefusalRows,
  type GatewayRefusalSpendLogRow,
} from "@langfuse/shared/src/server";

// CHG-2026-169 (ADR-0033). A refusal the gateway made in enforce mode while no
// guardrail verdict could be had is audited from the gateway's spend log. These
// rows mirror the shape LiteLLM 1.100.1 stored on the EYEON recovery rehearsal
// (2026-10-21): status failure, error class CairoGuardrailBlocked, and the
// gateway-authored message. Nothing else may qualify.

const parseTime = (v: string) => {
  const d = new Date(v.includes("T") || v.endsWith("Z") ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

function refusal(
  outcome: string,
  extra: Partial<GatewayRefusalSpendLogRow> = {},
): GatewayRefusalSpendLogRow {
  return {
    startTime: "2026-10-20 21:56:30.509000",
    status: "failure",
    metadata: {
      litellm_call_id: "1ee5a8ca-9a1a-4173-acd1-8a0f83a50365",
      user_api_key_alias: "eyeon-evals",
      error_information: {
        error_class: "CairoGuardrailBlocked",
        error_message: `Blocked by cairo-guardrail (${outcome}).`,
      },
    },
    ...extra,
  };
}

describe("gatewayRefusalOutcome", () => {
  it("recognises the three gateway-only no-verdict outcomes", () => {
    for (const o of [
      "guard_unavailable",
      "guard_unreadable",
      "settings_unusable",
    ]) {
      expect(gatewayRefusalOutcome(refusal(o))).toBe(o);
    }
  });

  it("ignores a verdict-based block: rayin-guardrails already pushed that event", () => {
    expect(gatewayRefusalOutcome(refusal("blocked"))).toBeNull();
  });

  it("ignores judge_unavailable: the guardrails service was up and recorded it", () => {
    const row = refusal("guard_unavailable");
    row.metadata!.error_information!.error_message =
      "Blocked by cairo-guardrail (judge_unavailable): the guardrail's judge model could not check this request, so it was refused. Retry later; if it persists, the judge's capacity is exhausted.";
    expect(gatewayRefusalOutcome(row)).toBeNull();
  });

  it("requires the gateway's own error class, not just the words", () => {
    const row = refusal("guard_unavailable");
    row.metadata!.error_information!.error_class = "APIConnectionError";
    expect(gatewayRefusalOutcome(row)).toBeNull();
  });

  it("requires the whole message to match, so quoted text inside another error does not qualify", () => {
    const row = refusal("guard_unavailable");
    row.metadata!.error_information!.error_message =
      "upstream said: Blocked by cairo-guardrail (guard_unavailable). retrying";
    expect(gatewayRefusalOutcome(row)).toBeNull();
  });

  it("ignores successful requests", () => {
    expect(
      gatewayRefusalOutcome(
        refusal("guard_unavailable", { status: "success" }),
      ),
    ).toBeNull();
  });

  it("reads the status from metadata when the top-level field is absent", () => {
    const row = refusal("guard_unavailable", { status: null });
    row.metadata!.status = "failure";
    expect(gatewayRefusalOutcome(row)).toBe("guard_unavailable");
  });
});

describe("selectGatewayRefusalRows", () => {
  it("builds one UNAVAILABLE input event per refusal, keyed by the call id", () => {
    const { rows, skipped } = selectGatewayRefusalRows(
      [refusal("guard_unavailable")],
      "eyeon-project",
      parseTime,
    );
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      {
        projectId: "eyeon-project",
        eventTime: new Date("2026-10-20T21:56:30.509Z"),
        agentId: "eyeon-evals",
        traceId: "1ee5a8ca-9a1a-4173-acd1-8a0f83a50365",
        direction: "INPUT",
        action: "UNAVAILABLE",
        policyTriggered: "guard_unavailable",
        eventId: `${GATEWAY_REFUSAL_EVENT_ID_PREFIX}1ee5a8ca-9a1a-4173-acd1-8a0f83a50365`,
        source: "GATEWAY",
        gatewayMode: "enforce",
      },
    ]);
  });

  it("is idempotent by construction: the same refusal always yields the same event id", () => {
    const a = selectGatewayRefusalRows(
      [refusal("guard_unavailable")],
      "p",
      parseTime,
    ).rows[0];
    const b = selectGatewayRefusalRows(
      [refusal("guard_unavailable")],
      "p",
      parseTime,
    ).rows[0];
    expect(a.eventId).toBe(b.eventId);
  });

  it("writes nothing for ordinary rows and verdict blocks in the same page", () => {
    const ok = refusal("guard_unavailable", { status: "success" });
    const { rows } = selectGatewayRefusalRows(
      [ok, refusal("blocked"), refusal("settings_unusable")],
      "p",
      parseTime,
    );
    expect(rows.map((r) => r.policyTriggered)).toEqual(["settings_unusable"]);
  });

  it("skips and counts a refusal with no call id or no readable time (no idempotency key, no row)", () => {
    const noId = refusal("guard_unavailable");
    noId.metadata!.litellm_call_id = null;
    const badTime = refusal("guard_unavailable", { startTime: "not a time" });
    const { rows, skipped } = selectGatewayRefusalRows(
      [noId, badTime],
      "p",
      parseTime,
    );
    expect(rows).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("copies no prompt or response text: only the outcome code and identifiers", () => {
    const row = refusal("guard_unavailable");
    (row as Record<string, unknown>).messages = "CAIRO-SECRET-PROMPT-MARKER";
    const { rows } = selectGatewayRefusalRows([row], "p", parseTime);
    expect(JSON.stringify(rows)).not.toContain("CAIRO-SECRET-PROMPT-MARKER");
  });

  it("attributes a refusal with no key alias to a fixed placeholder, never to an empty agent", () => {
    const row = refusal("guard_unavailable");
    row.metadata!.user_api_key_alias = null;
    expect(
      selectGatewayRefusalRows([row], "p", parseTime).rows[0].agentId,
    ).toBe("unknown-key");
  });
});
