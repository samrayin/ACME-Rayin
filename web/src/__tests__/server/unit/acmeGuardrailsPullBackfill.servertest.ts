import { describe, it, expect } from "vitest";
import {
  PULL_BACKFILL_MIN_AGE_MS,
  selectPullBackfillRows,
  type PulledGuardrailsEvent,
} from "@/src/features/acme-enhancements/server/acmeGuardrailsPullBackfill";

// The pull path must never persist a metadata-only row ahead of the push for
// the same event -- whichever row lands first wins the unique index, so a
// premature pull row would silently discard the richer push row. See
// acmeGuardrailsPullBackfill.ts.

const NOW = new Date("2026-09-18T12:00:00.000Z");

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

const BASE: PulledGuardrailsEvent = {
  event_id: "evt-1",
  time: secondsAgo(120),
  agent_id: "agent-1",
  trace_id: "trace-1",
  user_id: "user-1",
  client_host: "LAPTOP-ACME-042",
  direction: "input",
  policy_triggered: "Jailbreak Detection",
  action: "block",
};

describe("selectPullBackfillRows", () => {
  it("persists an old-enough event with an event_id, marked as pull", () => {
    const [row] = selectPullBackfillRows([BASE], "proj-1", NOW);
    expect(row).toMatchObject({
      projectId: "proj-1",
      eventId: "evt-1",
      agentId: "agent-1",
      traceId: "trace-1",
      userId: "user-1",
      clientHost: "LAPTOP-ACME-042",
      direction: "INPUT",
      action: "BLOCK",
      policyTriggered: "Jailbreak Detection",
      source: "PULL",
    });
    expect(row?.eventTime).toEqual(new Date(BASE.time));
  });

  it("skips events still inside the push window", () => {
    const recent = {
      ...BASE,
      time: secondsAgo(PULL_BACKFILL_MIN_AGE_MS / 1000 - 1),
    };
    expect(selectPullBackfillRows([recent], "proj-1", NOW)).toEqual([]);
  });

  it("persists an event exactly at the window boundary", () => {
    const boundary = {
      ...BASE,
      time: secondsAgo(PULL_BACKFILL_MIN_AGE_MS / 1000),
    };
    expect(selectPullBackfillRows([boundary], "proj-1", NOW)).toHaveLength(1);
  });

  it("skips events without an event_id (they could only dedupe on the composite key)", () => {
    expect(
      selectPullBackfillRows([{ ...BASE, event_id: null }], "proj-1", NOW),
    ).toEqual([]);
    expect(
      selectPullBackfillRows([{ ...BASE, event_id: undefined }], "proj-1", NOW),
    ).toEqual([]);
  });

  it("skips events with an unparseable time", () => {
    expect(
      selectPullBackfillRows([{ ...BASE, time: "not-a-date" }], "proj-1", NOW),
    ).toEqual([]);
  });

  it("defaults missing user_id and client_host to null (older rayin-guardrails builds)", () => {
    const { user_id: _u, client_host: _c, ...legacy } = BASE;
    const [row] = selectPullBackfillRows([legacy], "proj-1", NOW);
    expect(row?.userId).toBeNull();
    expect(row?.clientHost).toBeNull();
  });
});
