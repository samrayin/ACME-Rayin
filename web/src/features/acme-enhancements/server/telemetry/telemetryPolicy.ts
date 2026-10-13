/**
 * ACME addition (EYEON telemetry ingest, LLD section 6, step B): what this
 * project allows.
 *
 * Reads acme_telemetry_policy (cached, 30 s). A missing row or `enabled = false`
 * is 403. The default for an unconfigured project is therefore "off".
 *
 * Content modes: `redacted` and `full` exist in the schema and are INERT. This
 * change implements neither, so a policy that asks for one is handled as
 * `metadata` and counted `policy_downgraded`, whatever the gate flag says. The
 * flag is read and carried so a later change that implements a mode has the
 * switch in place; turning it on today cannot enable content.
 */
import type { UserIdMode } from "./telemetryFilter";

export type ContentMode = "metadata" | "redacted" | "full";

/** The columns the ingest reads. */
export type PolicyRow = {
  projectId: string;
  enabled: boolean;
  contentMode: ContentMode;
  userIdMode: UserIdMode;
  attributeAllowlistExtra: string[];
  retentionDays: number | null;
  version: number;
  userHashSalt: string;
};

export type EffectivePolicy = {
  projectId: string;
  /** Always `metadata` in this change. This is what gets stamped. */
  contentMode: "metadata";
  requestedContentMode: ContentMode;
  downgraded: boolean;
  /** Whether EYEON_TELEMETRY_CONTENT_MODES_ENABLED was on. Reporting only. */
  gateOpen: boolean;
  userIdMode: UserIdMode;
  extras: string[];
  version: number;
  userHashSalt: string;
};

/** null = answer 403: no row, or the project has not turned telemetry on. */
export function resolveEffectivePolicy(
  row: PolicyRow | null,
  gateOpen: boolean,
): EffectivePolicy | null {
  if (row === null || row.enabled !== true) return null;
  return {
    projectId: row.projectId,
    contentMode: "metadata",
    requestedContentMode: row.contentMode,
    downgraded: row.contentMode !== "metadata",
    gateOpen,
    userIdMode: row.userIdMode,
    extras: row.attributeAllowlistExtra,
    version: row.version,
    userHashSalt: row.userHashSalt,
  };
}

export type PolicyCacheDeps = {
  load: (projectId: string) => Promise<PolicyRow | null>;
  now: () => number;
  ttlMs?: number;
  /** How long a stale row may be served while the table is unreachable. */
  staleMs?: number;
  maxEntries?: number;
};

export const POLICY_CACHE_TTL_MS = 30_000;
export const POLICY_STALE_MS = 5 * 60_000;

export function createPolicyCache(deps: PolicyCacheDeps) {
  const ttl = deps.ttlMs ?? POLICY_CACHE_TTL_MS;
  const stale = deps.staleMs ?? POLICY_STALE_MS;
  const maxEntries = deps.maxEntries ?? 1000;
  const cache = new Map<string, { row: PolicyRow | null; at: number }>();

  return {
    /**
     * The project's policy row, or null if there is none. Throws when the table
     * is unreachable and nothing recent enough is cached: the caller fails
     * closed (503) rather than guess.
     */
    async get(projectId: string): Promise<PolicyRow | null> {
      const nowMs = deps.now();
      const hit = cache.get(projectId);
      if (hit !== undefined && nowMs - hit.at < ttl) return hit.row;
      try {
        const row = await deps.load(projectId);
        cache.delete(projectId);
        cache.set(projectId, { row, at: nowMs });
        while (cache.size > maxEntries) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        return row;
      } catch (error) {
        if (hit !== undefined && nowMs - hit.at < stale) return hit.row;
        throw error;
      }
    },
  };
}
