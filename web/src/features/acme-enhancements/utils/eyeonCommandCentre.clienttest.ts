import { describe, expect, it } from "vitest";
import {
  attentionItems,
  briefing,
  commandLinks,
  greeting,
  postureRings,
} from "@/src/features/acme-enhancements/utils/eyeonCommandCentre";
import {
  commandCentreFixture,
  enforcementFixture,
  healthFixture,
  overviewFixture,
  spendFixture,
} from "@/src/features/acme-enhancements/components/home/eyeonCommandCentre.fixtures";

// CHG-2026-147 (ADR-0030): the command centre's words and figures. Each
// attention item stands on a figure the linked page shows; a source the
// viewer cannot open adds nothing; the briefing never turns a missing
// figure into a zero; the rings are shares the pages state, not a score.

const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

describe("links", () => {
  it("lead to the EYEON pages while they are on and open to the viewer", () => {
    const links = commandLinks(commandCentreFixture());
    expect(links).toEqual({
      decisions: "/project/project-1/acme-enhancements/guardrail-decisions",
      enforcement: "/project/project-1/acme-enhancements/enforcement",
      guardrails: "/project/project-1/acme-enhancements/guardrails",
      spend: "/project/project-1/acme-enhancements/spend",
      health: "/project/project-1/acme-enhancements/gateway-health",
      applications: "/project/project-1/acme-enhancements/applications",
    });
  });

  it("fall back to the classic pages, and offer no Spend link without it", () => {
    const links = commandLinks(
      commandCentreFixture({
        spend: { state: "noAccess" },
        decisions: { state: "off" },
        enforcement: { state: "off" },
        health: { state: "error", message: "x" },
      }),
    );
    expect(links.spend).toBeNull();
    expect(links.decisions).toBe(
      "/project/project-1/acme-enhancements/security-logs?tab=guardrails",
    );
    expect(links.enforcement).toBe(
      "/project/project-1/acme-enhancements/guardrails",
    );
    expect(links.health).toBe(
      "/project/project-1/acme-enhancements/llm-gateway",
    );
  });
});

describe("Needs your attention", () => {
  it("dev on 2026-10-09: what is not stopped, failing models, the app and the key over budget, act first", () => {
    const items = attentionItems(commandCentreFixture());
    const ids = items.map((i) => i.id);
    expect(ids).toEqual([
      "notStopped",
      "appsAction",
      "modelsFailing",
      "overBudget",
      "nearBudget",
      "notRedacted",
      "noBudget",
      "failedCalls",
    ]);
    const severities = items.map((i) => i.severity);
    expect(severities.indexOf("watch")).toBeGreaterThan(
      severities.lastIndexOf("act"),
    );
    const notStopped = items[0]!;
    expect(notStopped.title).toBe("40 risky prompts and answers not stopped");
    expect(notStopped.href).toBe(
      "/project/project-1/acme-enhancements/enforcement",
    );
    const models = items.find((i) => i.id === "modelsFailing")!;
    expect(models.title).toBe("3 of 7 models failing");
    expect(models.detail).toBe(
      "claude-sonnet, gemini-judge, nvidia-nemotron failed the last health check.",
    );
    const failed = items.find((i) => i.id === "failedCalls")!;
    expect(failed.severity).toBe("watch");
    expect(failed.title).toBe("3.0% of gateway calls failed");
  });

  it("is empty when every control holds", () => {
    const items = attentionItems(
      commandCentreFixture({
        overview: {
          state: "ready",
          data: overviewFixture({
            decisions: {
              ...overviewFixture().decisions,
              promptsRefused: { enforced: 35, notEnforced: 0 },
              answersWithheld: { enforced: 5, notEnforced: 0 },
              redactions: { enforced: 86, notEnforced: 0 },
            },
            applications: {
              total: 2,
              byOverall: { green: 2, amber: 0, red: 0, none: 0 },
              topRisks: { risks: [], total: 0 },
              missingBudget: 0,
            },
          }),
        },
        spend: {
          state: "ready",
          data: spendFixture({
            budgets: { shown: [], withBudget: 2, withoutBudget: 0 },
          }),
        },
        health: {
          state: "ready",
          data: healthFixture({
            health: {
              checkedAt: "2026-10-09T09:21:00.000Z",
              fresh: true,
              cacheMinutes: 5,
              models: [],
              counts: { total: 4, healthy: 4, unhealthy: 0, unknown: 0 },
              more: 0,
            },
            failures: null,
          }),
        },
      }),
    );
    expect(items).toEqual([]);
  });

  it("says nothing about a source the viewer cannot open or that failed", () => {
    const items = attentionItems(
      commandCentreFixture({
        spend: { state: "noAccess" },
        health: { state: "error", message: "boom" },
      }),
    );
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("overBudget");
    expect(ids).not.toContain("modelsFailing");
    expect(ids).not.toContain("failedCalls");
    expect(ids).toContain("notStopped");
  });

  it("flags guardrail pods off the current settings and a gateway in another mode", () => {
    const items = attentionItems(
      commandCentreFixture({
        enforcement: {
          state: "ready",
          data: enforcementFixture({
            pods: {
              reporting: 2,
              onCurrent: 1,
              older: 1,
              unknown: 0,
              stale: 1,
              currentVersion: 14,
              staleAfterSeconds: 300,
              agree: false,
            },
            gateways: {
              ...enforcementFixture().gateways,
              matchesServed: false,
            },
          }),
        },
      }),
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("podsBehind")?.title).toBe(
      "1 of 2 guardrail pods not on the current settings",
    );
    expect(byId.get("podsBehind")?.severity).toBe("act");
    expect(byId.get("gatewaysDisagree")?.severity).toBe("act");
    expect(byId.get("podsStale")?.title).toBe(
      "1 guardrail pod stopped reporting",
    );
  });

  it("raises the judge when its no-verdict rate passes the alert level", () => {
    const items = attentionItems(
      commandCentreFixture({
        overview: {
          state: "ready",
          data: overviewFixture({
            judge: {
              windowHours: 24,
              checks: 400,
              noVerdict: 40,
              rate: 0.1,
              alertRate: 0.05,
              alert: true,
            },
          }),
        },
      }),
    );
    const judge = items.find((i) => i.id === "judge");
    expect(judge?.title).toBe(
      "The guardrail judge could not decide 10.0% of checks",
    );
    expect(judge?.severity).toBe("act");
  });
});

describe("the briefing", () => {
  it("leads with how many things need attention and states the figures", () => {
    const input = commandCentreFixture();
    const b = briefing(input, attentionItems(input));
    expect(b.tone).toBe("act");
    expect(b.lead).toBe("4 things need your attention.");
    const sentences = b.sentences.map(text);
    expect(sentences[0]).toBe(
      "4,200 AI calls from 4 applications went through the gateway in the last 7 days.",
    );
    expect(sentences[1]).toBe(
      "Guardrails checked 3,500 prompts and answers: 35 prompts flagged to refuse, 5 answers to withhold and 86 with personal data to redact. Outside enforce mode, 40 of them were recorded but not stopped.",
    );
    expect(sentences[2]).toBe(
      "$42.50 spent so far in October, on pace for $146.40 by the month's end.",
    );
    expect(sentences[3]).toBe("3 of 7 models failed the last health check.");
  });

  it("is calm when nothing needs attention, and leaves out what it cannot see", () => {
    const input = commandCentreFixture({
      spend: { state: "noAccess" },
      health: { state: "loading" },
    });
    const b = briefing(input, []);
    expect(b.tone).toBe("calm");
    expect(b.lead).toBe(
      "All clear: everything EYEON checks is within its thresholds.",
    );
    const all = b.sentences.map(text).join(" ");
    expect(all).not.toMatch(/\$/);
    expect(all).not.toMatch(/AI calls/);
    expect(all).not.toMatch(/models/);
  });

  it("says no checks were recorded rather than zero refusals", () => {
    const input = commandCentreFixture({
      overview: {
        state: "ready",
        data: overviewFixture({
          decisions: {
            ...overviewFixture().decisions,
            checks: 0,
          },
        }),
      },
    });
    const sentences = briefing(input, []).sentences.map(text);
    expect(sentences).toContain(
      "No guardrail checks were recorded in the last 7 days.",
    );
  });
});

describe("the rings", () => {
  it("are the shares the pages state", () => {
    const rings = postureRings(commandCentreFixture());
    expect(rings.map((r) => [r.key, r.centerText, r.tone])).toEqual([
      ["enforced", "0%", "block"],
      ["answered", "97%", "redact"],
      ["healthy", "4/7", "block"],
    ]);
  });

  it("draw an empty track, never a zero, when there is nothing to divide", () => {
    const rings = postureRings(
      commandCentreFixture({
        overview: {
          state: "ready",
          data: overviewFixture({
            decisions: {
              ...overviewFixture().decisions,
              checks: 0,
              enforcedPct: null,
            },
          }),
        },
        spend: { state: "noAccess" },
        health: { state: "ready", data: healthFixture({ failures: null }) },
      }),
    );
    const enforced = rings.find((r) => r.key === "enforced")!;
    expect(enforced.fraction).toBeNull();
    expect(enforced.centerText).toBe("–");
    expect(rings.map((r) => r.key)).not.toContain("answered");
  });
});

describe("the greeting", () => {
  it("follows the viewer's clock and first name", () => {
    expect(greeting(8, "Sam Rayin")).toBe("Good morning, Sam");
    expect(greeting(14, "Sam")).toBe("Good afternoon, Sam");
    expect(greeting(20, null)).toBe("Good evening");
    expect(greeting(9, "  ")).toBe("Good morning");
  });
});
