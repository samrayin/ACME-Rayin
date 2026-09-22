import { fn } from "storybook/test";

import preview from "@/.storybook/preview";
import {
  EditLimitsDialog,
  type KeyRow,
} from "@/src/features/acme-enhancements/components/AcmeLitellmGateway";

/**
 * CHG-2026-030 / ADR-0007. Test/preview-only — not imported by any production
 * page, not part of the shipped bundle. Exists so the owner can review the
 * actual dialog in a browser before deciding to merge/deploy, per the ADR's
 * own note that this was never manually verified, without touching any
 * database, LiteLLM gateway, or other shared/production-adjacent state:
 * EditLimitsDialog takes plain props and makes no network calls of its own.
 *
 * Fake data below mirrors the real reconciliation case this exists to fix
 * (CHG-2026-029's judge key), not a generic example: CAIRO's stale record
 * (models: [], no rpm_limit) versus the gateway's actual live state
 * (groq-safeguard + nvidia-nemotron, rpm_limit 10).
 */

const meta = preview.meta({ component: EditLimitsDialog });

const availableModels = [
  "groq-safeguard",
  "nvidia-nemotron",
  "claude-sonnet",
];

const baseRow = {
  id: "7fe9a9d4-75db-4cda-b0bf-7cb958cec8c9",
  displayName: "cairo-guardrails-judge-rotation-2026-09-20-7fe9a9d4",
  alias: "cairo-guardrails-judge-rotation-2026-09-20-7fe9a9d4",
  tokenHash: "41516476c17dae288b893f75966ea6254191a10f4dbb86949e8187ff8dd082f8",
  teamId: null,
  status: "ACTIVE",
  maxBudget: null,
  budgetDuration: null,
  tpmLimit: null,
  expiresAt: null,
  generation: 1,
  lineageId: "7fe9a9d4-75db-4cda-b0bf-7cb958cec8c9",
  createdAt: "2026-09-20T21:14:29.303Z",
  createdByUserId: "cmt8y5gae0000tv07ru1mwzsi",
  revokedAt: null,
  rotatedToKeyId: null,
  liveSpend: 0.001579575,
  lastActive: "2026-09-21T15:31:47.624Z",
} satisfies Partial<KeyRow>;

/**
 * The real case this dialog exists for: CAIRO's own record is stale (never
 * narrowed, never rate-limited), the gateway's live state is already correct.
 * Editable fields must pre-fill from the LIVE values, not CAIRO's, and the
 * drift banner must be visible -- this is what a reviewer needs to see to
 * trust that reconciling here writes the gateway's actual state back into
 * CAIRO, not the other way around.
 */
export const DriftedPrefillsFromLiveState = meta.story({
  args: {
    row: {
      ...baseRow,
      models: [],
      rpmLimit: null,
      liveModels: ["groq-safeguard", "nvidia-nemotron"],
      liveRpmLimit: 10,
      drift: "drifted",
      driftFields: ["models", "rpmLimit"],
    } as KeyRow,
    availableModels,
    busy: false,
    onClose: fn(),
    onSubmit: fn(),
  },
});

/**
 * The fallback case: no valid live comparison exists (gateway unreachable,
 * or this key missing from it). The dialog must fall back to CAIRO's own
 * row -- not crash, not show blank fields -- and say plainly, visibly, that
 * this is a fallback, not confirmed-live data.
 */
export const LiveStateUnavailableFallsBackToCairoRecord = meta.story({
  args: {
    row: {
      ...baseRow,
      models: [],
      rpmLimit: null,
      liveModels: null,
      liveRpmLimit: null,
      drift: "unknown",
      driftFields: [],
    } as KeyRow,
    availableModels,
    busy: false,
    onClose: fn(),
    onSubmit: fn(),
  },
});

/**
 * Contrast case: a key with no drift at all. CAIRO's record and the live
 * gateway state already agree, so the plain "CAIRO currently records" line
 * shows with no bold disagreement callout, and the editable fields pre-fill
 * from live state exactly matching what's already displayed.
 */
export const NoDriftCleanKey = meta.story({
  args: {
    row: {
      ...baseRow,
      id: "clean-key-id",
      displayName: "promptfoo-eval",
      alias: "promptfoo-eval",
      models: ["claude-sonnet", "nvidia-nemotron"],
      rpmLimit: 60,
      liveModels: ["claude-sonnet", "nvidia-nemotron"],
      liveRpmLimit: 60,
      drift: "in_sync",
      driftFields: [],
    } as KeyRow,
    availableModels,
    busy: false,
    onClose: fn(),
    onSubmit: fn(),
  },
});
