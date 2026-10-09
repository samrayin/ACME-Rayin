import preview from "@/.storybook/preview";
import { EyeonCommandCentre } from "@/src/features/acme-enhancements/components/home/EyeonCommandCentre";
import {
  FIXTURE_NOW,
  commandCentreFixture,
  enforcementFixture,
  healthFixture,
  overviewFixture,
} from "@/src/features/acme-enhancements/components/home/eyeonCommandCentre.fixtures";

/**
 * CHG-2026-147 (owner, 2026-10-09: "create amazing dasboard with useful
 * infomraiton.. you should be able to move the widgets across.. act as a
 * CEO + CISO"). The command centre on fixed figures, so it can be checked in
 * a real browser: the briefing and rings, the headline figures, and the
 * widgets, which Arrange lets each person move, resize and hide. Story-only:
 * no network call, no database; an arrangement made here is kept in this
 * browser under the story's own user.
 *
 * Owner: dev as it stood on 2026-10-09: record mode, three models failing,
 * one key over budget. Auditor: no spend scope, so no spend widgets.
 * Enforcing: the same estate in enforce mode with every model healthy.
 */

const meta = preview.meta({ component: EyeonCommandCentre });

const base = {
  userId: "story-user",
  viewerName: "Sam Rayin",
  now: new Date(FIXTURE_NOW),
  onWindowDaysChange: () => undefined,
};

export const Owner = meta.story({
  args: { ...base, input: commandCentreFixture() },
});

export const Auditor = meta.story({
  args: {
    ...base,
    userId: "story-auditor",
    viewerName: "Audit Lead",
    input: commandCentreFixture({ spend: { state: "noAccess" } }),
  },
});

export const Enforcing = meta.story({
  args: {
    ...base,
    userId: "story-enforcing",
    input: commandCentreFixture({
      overview: {
        state: "ready",
        data: overviewFixture({
          mode: {
            mode: "enforce",
            ceiling: "enforce",
            trialEndsAt: null,
            lastChange: null,
          },
          decisions: {
            checks: 3500,
            promptChecks: 1760,
            answerChecks: 1740,
            allowed: 3374,
            promptsRefused: { enforced: 35, notEnforced: 0 },
            answersWithheld: { enforced: 5, notEnforced: 0 },
            redactions: { enforced: 86, notEnforced: 0 },
            noVerdict: 0,
            enforcedChecks: 3500,
            enforcedPct: 100,
          },
          applications: {
            total: 9,
            byOverall: { green: 8, amber: 1, red: 0, none: 0 },
            topRisks: { risks: [], total: 0 },
            missingBudget: 0,
          },
        }),
      },
      health: {
        state: "ready",
        data: healthFixture({
          health: {
            checkedAt: FIXTURE_NOW,
            fresh: true,
            cacheMinutes: 5,
            models: [],
            counts: { total: 4, healthy: 4, unhealthy: 0, unknown: 0 },
            more: 0,
          },
        }),
      },
      enforcement: {
        state: "ready",
        data: enforcementFixture({
          gateways: {
            replicas: 2,
            byMode: { enforce: 2, record: 0, notReported: 0 },
            versions: [15],
            sameMode: true,
            matchesServed: true,
            beforeLastChange: 0,
            lastSeenAt: FIXTURE_NOW,
          },
        }),
      },
    }),
  },
});

export const Loading = meta.story({
  args: {
    ...base,
    userId: "story-loading",
    input: {
      projectId: "project-1",
      windowDays: 7,
      overview: { state: "loading" },
      spend: { state: "loading" },
      health: { state: "loading" },
      decisions: { state: "loading" },
      enforcement: { state: "off" },
    },
  },
});
