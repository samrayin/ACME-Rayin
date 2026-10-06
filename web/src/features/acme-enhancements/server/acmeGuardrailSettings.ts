/**
 * ACME: CAIRO-held guardrail settings (ADR-0005-B part a, CHG-2026-089).
 *
 * CAIRO is the source of truth for the guardrail policy rayin-guardrails
 * applies: which personal-data types it detects, and whether its jailbreak
 * and topic checks run. Each change is a new row in acme_guardrail_settings
 * (append-only; the highest version is in force) and an audit-log entry with
 * the values before and after. Every rayin-guardrails pod pulls the current
 * version (POST /api/public/guardrails-settings) at start and every 30
 * seconds, and reports which version it applied, so a restart restores the
 * policy and every replica converges (ADR-0005-B Q1-Q3, Q6).
 *
 * The settings apply to the whole deployment, so the authority to change
 * them is a named list of deployment administrators (CAIRO_GUARDRAIL_ADMINS),
 * not an organisation or project role (ADR-0005-B §3.4, test B12).
 *
 * Part b (the enforcement switch) adds the mode to the same versions:
 * "record" or "enforce". Enforce takes effect only where the deployment
 * ceiling, CAIRO_GUARDRAIL_MODE_MAX, allows it; an enforce version can carry
 * an automatic switch-back time, after which it reads as record and the next
 * pull writes an audited automatic version (owner decision D-B2).
 *
 * The decision logic is in pure functions, unit-tested without a database
 * (acmeGuardrailSettings.servertest.ts); the Prisma calls are thin wrappers.
 */
import { type PrismaClient } from "@langfuse/shared/src/db";

/** Keep in step with rayin-guardrails' own ALL_PII_ENTITIES. */
export const ALL_PII_ENTITIES = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "CREDIT_CARD",
  "PERSON",
  "IBAN_CODE",
  "IP_ADDRESS",
  // Bahrain CPR number (rayin-guardrails, CHG-2026-078).
  "BH_CPR",
] as const;
type PiiEntity = (typeof ALL_PII_ENTITIES)[number];

export const GUARDRAIL_MODES = ["record", "enforce"] as const;
export type GuardrailMode = (typeof GUARDRAIL_MODES)[number];

type GuardrailPolicy = {
  piiEntities: PiiEntity[];
  jailbreakEnabled: boolean;
  topicalEnabled: boolean;
};

export type GuardrailSettingsVersion = GuardrailPolicy & {
  version: number;
  mode: GuardrailMode;
  /** Enforce versions only: when the automatic switch-back is due. */
  revertAt: Date | null;
  /** True for a version the automatic switch-back wrote. */
  automatic: boolean;
  reason: string;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
};

/** Switch-back choices offered for an enforce trial, in minutes (D-B2). */
export const REVERT_AFTER_MINUTES_OPTIONS = [5, 15, 30, 60, 120] as const;
export const DEFAULT_REVERT_AFTER_MINUTES = 30;

/** Typed by the administrator to switch to enforce (ADR-0005-B §3.4). */
export const ENFORCE_CONFIRMATION = "ENFORCE";

/** createdBy of a version written by the automatic switch-back. */
export const AUTOMATIC_CREATOR = "automatic";

/** The Enforcement card's evidence covers this many days of decisions. */
const EVIDENCE_WINDOW_DAYS = 7;

/**
 * A gateway replica reports only when a request passes through it, so the
 * card lists those seen within this window, with when each was last seen.
 */
const GATEWAY_REPORT_WINDOW_HOURS = 24;

/** At most this many settings versions are read for the mode history. */
const MODE_HISTORY_MAX_VERSIONS = 500;

/** A pod that has not pulled for this long is shown as not reporting. */
export const POD_STALE_AFTER_SECONDS = 120;

const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 500;

/** Postgres INTEGER maximum: version numbers above it cannot be stored. */
export const MAX_SETTINGS_VERSION = 2147483647;

/**
 * A pod name as Kubernetes issues it: a DNS-1123 label (lower-case letters,
 * digits and hyphens, at most 63 characters). Bounds what a caller can write
 * into the pod-status table (security review SF-2026-016).
 */
export const POD_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/** At most this many pods are listed; a guardrails deployment has a few. */
export const MAX_LISTED_PODS = 32;

/** Pod-status rows older than this are removed on the next pull. */
const POD_ROW_RETENTION_HOURS = 24;

/** A bad input from the person saving: the router answers 400 for these. */
export class GuardrailSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailSettingsValidationError";
  }
}

/**
 * Enforce requested where the deployment ceiling is record. Not a bad input
 * but a deployment decision the console cannot override (ADR-0005-B Q4).
 */
export class GuardrailModeNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailModeNotAllowedError";
  }
}

// ---------------------------------------------------------------- pure logic

/**
 * Parses CAIRO_GUARDRAIL_ADMINS: a comma-separated list of sign-in emails,
 * compared case-insensitively. Blank entries are dropped.
 */
export function parseAdminList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Whether this signed-in user is one of the named deployment administrators.
 * Fails closed: no email, or no list configured, means no.
 */
export function isDeploymentAdmin(
  email: string | null | undefined,
  rawAdminList: string | undefined | null,
): boolean {
  if (!email) return false;
  const admins = parseAdminList(rawAdminList);
  return admins.includes(email.trim().toLowerCase());
}

/**
 * Whether nobody can register an arbitrary email address themselves. The
 * admin check trusts the sign-in email, so it is only sound when open
 * sign-up is off, or when sign-up requires a verified email (security
 * review SF-2026-015). Reads the deployment's own auth settings.
 */
export function selfSignupClosed(authEnv: {
  AUTH_DISABLE_SIGNUP?: string;
  NEXT_PUBLIC_SIGN_UP_DISABLED?: string;
  AUTH_EMAIL_VERIFICATION_REQUIRED?: string;
}): boolean {
  return (
    authEnv.AUTH_DISABLE_SIGNUP === "true" ||
    authEnv.NEXT_PUBLIC_SIGN_UP_DISABLED === "true" ||
    authEnv.AUTH_EMAIL_VERIFICATION_REQUIRED === "true"
  );
}

/**
 * The single authority rule for changing the guardrail settings
 * (ADR-0005-B §3.4, test B12): a named deployment administrator, on a
 * deployment where open sign-up cannot be used to claim that email.
 * Organisation and project roles play no part.
 */
export function canEditGuardrailSettings(input: {
  email: string | null | undefined;
  rawAdminList: string | undefined | null;
  signupClosed: boolean;
}): boolean {
  return (
    input.signupClosed && isDeploymentAdmin(input.email, input.rawAdminList)
  );
}

/**
 * Returns the policy in a canonical form: entities de-duplicated and in the
 * order of ALL_PII_ENTITIES, so two equal policies compare equal. Throws on
 * an unknown entity rather than storing a value rayin-guardrails would
 * reject.
 */
export function normalisePolicy(policy: {
  piiEntities: readonly string[];
  jailbreakEnabled: boolean;
  topicalEnabled: boolean;
}): GuardrailPolicy {
  for (const e of policy.piiEntities) {
    if (!(ALL_PII_ENTITIES as readonly string[]).includes(e)) {
      throw new GuardrailSettingsValidationError(
        `Unknown personal-data type: ${e}`,
      );
    }
  }
  const wanted = new Set(policy.piiEntities);
  return {
    piiEntities: ALL_PII_ENTITIES.filter((e) => wanted.has(e)),
    jailbreakEnabled: policy.jailbreakEnabled,
    topicalEnabled: policy.topicalEnabled,
  };
}

export function policiesEqual(a: GuardrailPolicy, b: GuardrailPolicy): boolean {
  return (
    a.jailbreakEnabled === b.jailbreakEnabled &&
    a.topicalEnabled === b.topicalEnabled &&
    a.piiEntities.length === b.piiEntities.length &&
    a.piiEntities.every((e, i) => e === b.piiEntities[i])
  );
}

export function validateReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN_LENGTH) {
    throw new GuardrailSettingsValidationError(
      `A reason of at least ${REASON_MIN_LENGTH} characters is required.`,
    );
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new GuardrailSettingsValidationError(
      `The reason is limited to ${REASON_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/**
 * The deployment ceiling (CAIRO_GUARDRAIL_MODE_MAX). Anything but an explicit
 * "enforce" is record, so an unset or mistyped value fails safe (Q4).
 */
export function parseModeCeiling(
  raw: string | undefined | null,
): GuardrailMode {
  return raw?.trim().toLowerCase() === "enforce" ? "enforce" : "record";
}

/** Whether an enforce version's automatic switch-back time has passed. */
export function trialExpired(
  v: Pick<GuardrailSettingsVersion, "mode" | "revertAt">,
  now: Date,
): boolean {
  return (
    v.mode === "enforce" &&
    v.revertAt !== null &&
    v.revertAt.getTime() <= now.getTime()
  );
}

/** The mode a version stands for now: an expired trial reads as record. */
export function effectiveMode(
  v: Pick<GuardrailSettingsVersion, "mode" | "revertAt">,
  now: Date,
): GuardrailMode {
  return trialExpired(v, now) ? "record" : v.mode;
}

/**
 * Checks a request to change the mode before anything is read or written,
 * and returns the switch-back time for an enforce request. Switching to
 * record needs no confirmation and is allowed under any ceiling.
 */
export function validateModeChange(input: {
  mode: GuardrailMode;
  ceiling: GuardrailMode;
  confirmation: string | null | undefined;
  revertAfterMinutes: number | null;
  now: Date;
}): { revertAt: Date | null } {
  if (input.mode === "record") return { revertAt: null };
  if (input.ceiling !== "enforce") {
    throw new GuardrailModeNotAllowedError(
      "This deployment's ceiling (CAIRO_GUARDRAIL_MODE_MAX) is record, so enforce cannot be chosen here.",
    );
  }
  if ((input.confirmation ?? "").trim() !== ENFORCE_CONFIRMATION) {
    throw new GuardrailSettingsValidationError(
      `Type ${ENFORCE_CONFIRMATION} to confirm the switch to enforce.`,
    );
  }
  if (input.revertAfterMinutes === null) return { revertAt: null };
  if (
    !(REVERT_AFTER_MINUTES_OPTIONS as readonly number[]).includes(
      input.revertAfterMinutes,
    )
  ) {
    throw new GuardrailSettingsValidationError(
      `The automatic switch-back must be one of ${REVERT_AFTER_MINUTES_OPTIONS.join(", ")} minutes, or none.`,
    );
  }
  return {
    revertAt: new Date(input.now.getTime() + input.revertAfterMinutes * 60_000),
  };
}

/** One change of mode in the settings history, for the console. */
export type GuardrailModeChange = {
  version: number;
  mode: GuardrailMode;
  previousMode: GuardrailMode | null;
  revertAt: Date | null;
  automatic: boolean;
  reason: string;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
};

/**
 * The versions that changed the mode, or changed an enforce trial's
 * switch-back time, oldest first. `versions` must be in ascending order. A
 * policy change that keeps the mode is not listed: it is in the Policies
 * card's history and the audit log.
 */
export function modeChangesOf(
  versions: readonly GuardrailSettingsVersion[],
): GuardrailModeChange[] {
  const changes: GuardrailModeChange[] = [];
  let previous: GuardrailSettingsVersion | null = null;
  for (const v of versions) {
    const modeChanged = previous === null || previous.mode !== v.mode;
    const revertChanged =
      previous !== null &&
      v.mode === "enforce" &&
      (previous.revertAt?.getTime() ?? null) !==
        (v.revertAt?.getTime() ?? null);
    // The seeded first version in record mode is not a "change" of mode.
    if (
      (previous !== null || v.mode !== "record") &&
      (modeChanged || revertChanged)
    ) {
      changes.push({
        version: v.version,
        mode: v.mode,
        previousMode: previous?.mode ?? null,
        revertAt: v.revertAt,
        automatic: v.automatic,
        reason: v.reason,
        createdBy: v.createdBy,
        createdByEmail: v.createdByEmail,
        createdAt: v.createdAt,
      });
    }
    previous = v;
  }
  return changes;
}

/** A version as the audit log records it, before and after a change. */
export function settingsForAudit(s: GuardrailSettingsVersion) {
  return {
    version: s.version,
    mode: s.mode,
    revertAt: s.revertAt ? s.revertAt.toISOString() : null,
    automatic: s.automatic,
    piiEntities: s.piiEntities,
    jailbreakEnabled: s.jailbreakEnabled,
    topicalEnabled: s.topicalEnabled,
    reason: s.reason,
  };
}

/**
 * The mode CAIRO serves for a version: its effective mode, capped by this
 * console's own ceiling. A stored enforce version is served as record while
 * the ceiling is record (security review SF-2026-023), so lowering the
 * ceiling during a trial takes effect at the next pull, whatever is stored.
 */
export function servedMode(
  v: Pick<GuardrailSettingsVersion, "mode" | "revertAt">,
  now: Date,
  ceiling: GuardrailMode,
): GuardrailMode {
  return ceiling === "enforce" ? effectiveMode(v, now) : "record";
}

/**
 * The body a rayin-guardrails pod receives on a pull.
 * - The mode is the served one: an expired trial reads as record even before
 *   its automatic version is written, and the ceiling caps it.
 * - While a trial is served as enforce, its switch-back time comes too, so
 *   the pods and gateways end it on time even if later pulls fail
 *   (SF-2026-024).
 * - The ceiling defaults to record, so a caller that forgets it errs safe.
 */
export function toSyncResponse(
  current: GuardrailSettingsVersion,
  now: Date = new Date(),
  ceiling: GuardrailMode = "record",
) {
  const mode = servedMode(current, now, ceiling);
  return {
    version: current.version,
    mode,
    pii_entities: [...current.piiEntities],
    jailbreak_enabled: current.jailbreakEnabled,
    topical_enabled: current.topicalEnabled,
    updated_at: current.createdAt.toISOString(),
    revert_at:
      mode === "enforce" && current.revertAt
        ? current.revertAt.toISOString()
        : null,
  };
}

// ---------------------------------------------------------------- database

type Db = Pick<
  PrismaClient,
  "acmeGuardrailSettings" | "acmeGuardrailSettingsPod" | "$transaction"
>;

function toVersion(row: {
  version: number;
  mode: string;
  piiEntities: string[];
  jailbreakEnabled: boolean;
  topicalEnabled: boolean;
  reason: string;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
  revertAt: Date | null;
  automatic: boolean;
}): GuardrailSettingsVersion {
  return {
    ...normalisePolicy(row),
    version: row.version,
    // A CHECK constraint holds the column to these two values; anything else
    // is read as record, the mode that changes nothing.
    mode: row.mode === "enforce" ? "enforce" : "record",
    revertAt: row.mode === "enforce" ? row.revertAt : null,
    automatic: row.automatic,
    reason: row.reason,
    createdBy: row.createdBy,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt,
  };
}

/** The version in force, or null if none is stored. */
export async function getCurrentSettings(
  db: Pick<Db, "acmeGuardrailSettings">,
): Promise<GuardrailSettingsVersion | null> {
  const row = await db.acmeGuardrailSettings.findFirst({
    orderBy: { version: "desc" },
  });
  return row ? toVersion(row) : null;
}

type SaveResult =
  | { changed: false; current: GuardrailSettingsVersion }
  | {
      changed: true;
      before: GuardrailSettingsVersion | null;
      current: GuardrailSettingsVersion;
    };

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

type AuditFn = (
  tx: Tx,
  change: {
    before: GuardrailSettingsVersion | null;
    current: GuardrailSettingsVersion;
  },
) => Promise<void>;

/**
 * Runs a save. Version numbers are allocated inside the transaction; a
 * concurrent save that takes the same number fails on the unique version
 * index and is retried once, against the version that won.
 */
async function withVersionRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return await attempt();
    throw e;
  }
}

/**
 * Stores a new version if the policy differs from the one in force. The mode
 * is carried over: a policy change during an enforce trial keeps enforce and
 * the trial's switch-back time; once the trial has ended, the new version is
 * record.
 *
 * `audit` runs inside the same transaction, after the new version is
 * written, so a change and its audit-log entry commit together or not at all
 * (ADR-0005-B Q1). It is not called when nothing changed.
 */
export async function saveSettings(
  db: Db,
  input: {
    policy: GuardrailPolicy;
    reason: string;
    userId: string;
    userEmail: string | null;
    projectId: string;
    now?: Date;
  },
  audit: AuditFn,
): Promise<SaveResult> {
  const policy = normalisePolicy(input.policy);
  const reason = validateReason(input.reason);
  const now = input.now ?? new Date();

  return withVersionRetry(() =>
    db.$transaction(async (tx) => {
      const before = await getCurrentSettings(tx);
      if (before && policiesEqual(before, policy)) {
        return { changed: false as const, current: before };
      }
      const keepEnforce =
        before !== null && effectiveMode(before, now) === "enforce";
      const row = await tx.acmeGuardrailSettings.create({
        data: {
          version: (before?.version ?? 0) + 1,
          mode: keepEnforce ? "enforce" : "record",
          revertAt: keepEnforce ? before.revertAt : null,
          piiEntities: policy.piiEntities,
          jailbreakEnabled: policy.jailbreakEnabled,
          topicalEnabled: policy.topicalEnabled,
          reason,
          createdBy: input.userId,
          createdByEmail: input.userEmail,
          projectId: input.projectId,
        },
      });
      const current = toVersion(row);
      await audit(tx, { before, current });
      return { changed: true as const, before, current };
    }),
  );
}

/**
 * Stores a new version that changes the mode and keeps the policy in force
 * (ADR-0005-B §3.4). The caller has already checked the authority, the
 * ceiling and the confirmation (validateModeChange). No change when the mode
 * in force, and for enforce the switch-back time, already match. Audited in
 * the same transaction, as saveSettings is.
 */
export async function saveMode(
  db: Db,
  input: {
    mode: GuardrailMode;
    revertAt: Date | null;
    reason: string;
    userId: string;
    userEmail: string | null;
    projectId: string;
    now?: Date;
  },
  audit: AuditFn,
): Promise<SaveResult> {
  const reason = validateReason(input.reason);
  const now = input.now ?? new Date();
  const revertAt = input.mode === "enforce" ? input.revertAt : null;

  return withVersionRetry(() =>
    db.$transaction(async (tx) => {
      const before = await getCurrentSettings(tx);
      if (!before) {
        throw new GuardrailSettingsValidationError(
          "No guardrail settings are stored in EYEON yet.",
        );
      }
      const sameMode = effectiveMode(before, now) === input.mode;
      const sameRevert =
        input.mode === "record" ||
        (before.revertAt?.getTime() ?? null) === (revertAt?.getTime() ?? null);
      if (sameMode && sameRevert) {
        return { changed: false as const, current: before };
      }
      const row = await tx.acmeGuardrailSettings.create({
        data: {
          version: before.version + 1,
          mode: input.mode,
          revertAt,
          piiEntities: before.piiEntities,
          jailbreakEnabled: before.jailbreakEnabled,
          topicalEnabled: before.topicalEnabled,
          reason,
          createdBy: input.userId,
          createdByEmail: input.userEmail,
          projectId: input.projectId,
        },
      });
      const current = toVersion(row);
      await audit(tx, { before, current });
      return { changed: true as const, before, current };
    }),
  );
}

/**
 * Writes the automatic switch-back once an enforce trial's time has passed:
 * a new record version with the same policy, marked automatic, audited in
 * the same transaction. Called on each pod pull, so it is written within
 * about 30 seconds of the switch-back time; pulls already serve the trial as
 * record from that moment (toSyncResponse). Two pulls racing write it once:
 * the loser's retry finds record in force and changes nothing.
 */
export async function applyExpiredRevert(
  db: Db,
  input: { projectId: string; now?: Date; ceiling?: GuardrailMode },
  audit: AuditFn,
): Promise<SaveResult | { changed: false; current: null }> {
  const now = input.now ?? new Date();
  // Security review P2-269-2: an enforce version that the console's ceiling
  // serves as record is written down as an automatic record version too, so
  // raising the ceiling later never brings enforce back without a fresh,
  // confirmed choice. Without a ceiling the old behaviour holds.
  const ceiling = input.ceiling ?? "enforce";
  return withVersionRetry(() =>
    db.$transaction(async (tx) => {
      const before = await getCurrentSettings(tx);
      if (!before) return { changed: false as const, current: null };
      const expired = trialExpired(before, now) && before.revertAt !== null;
      const capped =
        !expired &&
        ceiling !== "enforce" &&
        effectiveMode(before, now) === "enforce";
      if (!expired && !capped) {
        return { changed: false as const, current: before };
      }
      const row = await tx.acmeGuardrailSettings.create({
        data: {
          version: before.version + 1,
          mode: "record",
          revertAt: null,
          automatic: true,
          piiEntities: before.piiEntities,
          jailbreakEnabled: before.jailbreakEnabled,
          topicalEnabled: before.topicalEnabled,
          reason:
            expired && before.revertAt
              ? `Automatic switch-back to record: the enforce trial in version ${before.version} ended at ${before.revertAt.toISOString()}.`
              : `Automatic switch-back to record: the deployment ceiling (CAIRO_GUARDRAIL_MODE_MAX) is record, so the enforce version ${before.version} is not kept.`,
          createdBy: AUTOMATIC_CREATOR,
          createdByEmail: null,
          projectId: input.projectId,
        },
      });
      const current = toVersion(row);
      await audit(tx, { before, current });
      return { changed: true as const, before, current };
    }),
  );
}

/** The mode history: every version that changed the mode, oldest first. */
export async function listModeChanges(
  db: Pick<Db, "acmeGuardrailSettings">,
): Promise<GuardrailModeChange[]> {
  const rows = await db.acmeGuardrailSettings.findMany({
    orderBy: { version: "desc" },
    take: MODE_HISTORY_MAX_VERSIONS,
  });
  return modeChangesOf(rows.reverse().map(toVersion));
}

/**
 * Records the version a pod reported, at the time of its pull, and removes
 * rows for pods that stopped reporting more than a day ago (a replaced pod
 * never pulls again). The caller treats this as best effort: a failure here
 * must never deny a pod its settings.
 */
export async function recordPodSync(
  db: Pick<Db, "acmeGuardrailSettingsPod">,
  input: { pod: string; appliedVersion: number | null; projectId: string },
  now: Date = new Date(),
): Promise<void> {
  await db.acmeGuardrailSettingsPod.upsert({
    where: { pod: input.pod },
    create: {
      pod: input.pod,
      appliedVersion: input.appliedVersion,
      projectId: input.projectId,
      lastSyncAt: now,
    },
    update: {
      appliedVersion: input.appliedVersion,
      projectId: input.projectId,
      lastSyncAt: now,
    },
  });
  await db.acmeGuardrailSettingsPod.deleteMany({
    where: {
      lastSyncAt: {
        lt: new Date(now.getTime() - POD_ROW_RETENTION_HOURS * 3600 * 1000),
      },
    },
  });
}

/** Pods that pulled within POD_STALE_AFTER_SECONDS, at most MAX_LISTED_PODS. */
export async function listReportingPods(
  db: Pick<Db, "acmeGuardrailSettingsPod">,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - POD_STALE_AFTER_SECONDS * 1000);
  return db.acmeGuardrailSettingsPod.findMany({
    where: { lastSyncAt: { gte: cutoff } },
    orderBy: { pod: "asc" },
    take: MAX_LISTED_PODS,
    select: { pod: true, appliedVersion: true, lastSyncAt: true },
  });
}

type EventsDb = Pick<PrismaClient, "acmeGuardrailEvent">;

/**
 * How far ahead of the console's clock a stored event time may be and still
 * count. Event times are pushed by rayin-guardrails, so a far-future time
 * could otherwise pin a replica's mode or skew the figures (SF-2026-026).
 */
export const EVENT_FUTURE_SKEW_MS = 5 * 60_000;

/** The event-time window [since, now + skew] the console's figures read. */
function eventTimeWindow(now: Date, since: Date) {
  return { gte: since, lte: new Date(now.getTime() + EVENT_FUTURE_SKEW_MS) };
}

/** Distinct (pod, mode, version) combinations aggregated at most per call. */
const MAX_GATEWAY_REPORT_GROUPS = 500;

/**
 * Gateway replicas seen in guardrail events within the report window, newest
 * report first, one row each (ADR-0005-B §3.4, build decision C1). A replica
 * reports only when a request passes through it, so this is "last seen", not
 * a live heartbeat.
 *
 * Aggregated in the database by (pod, mode, version) with each group's latest
 * time, then reduced to one row per pod here, so a poll reads a handful of
 * groups instead of a day of events (SF-2026-026). Events timed in the future
 * beyond the skew allowance are ignored.
 */
export async function listReportingGateways(
  db: EventsDb,
  input: { projectId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const since = new Date(
    now.getTime() - GATEWAY_REPORT_WINDOW_HOURS * 3600 * 1000,
  );
  const groups = await db.acmeGuardrailEvent.groupBy({
    by: ["gatewayPod", "gatewayMode", "gatewaySettingsVersion"],
    where: {
      projectId: input.projectId,
      eventTime: eventTimeWindow(now, since),
      gatewayPod: { not: null },
    },
    _max: { eventTime: true },
    orderBy: { _max: { eventTime: "desc" } },
    take: MAX_GATEWAY_REPORT_GROUPS,
  });
  const latest = new Map<
    string,
    {
      mode: string | null;
      settingsVersion: number | null;
      lastSeenAt: Date;
    }
  >();
  for (const g of groups) {
    const pod = g.gatewayPod;
    const seen = g._max?.eventTime ?? null;
    if (!pod || !seen) continue;
    const known = latest.get(pod);
    if (!known || seen.getTime() > known.lastSeenAt.getTime()) {
      latest.set(pod, {
        mode: g.gatewayMode,
        settingsVersion: g.gatewaySettingsVersion,
        lastSeenAt: seen,
      });
    }
  }
  return [...latest.entries()]
    .sort((a, b) => b[1].lastSeenAt.getTime() - a[1].lastSeenAt.getTime())
    .slice(0, MAX_LISTED_PODS)
    .map(([pod, r]) => ({
      pod,
      mode:
        r.mode === "enforce" || r.mode === "record"
          ? (r.mode as GuardrailMode)
          : null,
      settingsVersion: r.settingsVersion,
      lastSeenAt: r.lastSeenAt,
    }));
}

/**
 * The evidence the Enforcement card shows before a switch to enforce: the
 * stored decisions of the last EVIDENCE_WINDOW_DAYS, and how many would have
 * been refused. Guardrail availability and added latency are not stored in
 * CAIRO yet (they are in the gateway's health log lines), so they are not
 * computed here (build decision C5).
 */
export async function guardrailEvidence(
  db: EventsDb,
  input: { projectId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000);
  const counts = await countByAction(db, input.projectId, now, since);
  return { since, windowDays: EVIDENCE_WINDOW_DAYS, ...counts };
}

async function countByAction(
  db: EventsDb,
  projectId: string,
  now: Date,
  since: Date,
) {
  const groups = await db.acmeGuardrailEvent.groupBy({
    by: ["action"],
    where: { projectId, eventTime: eventTimeWindow(now, since) },
    _count: { _all: true },
  });
  const counts = {
    total: 0,
    blocked: 0,
    redacted: 0,
    allowed: 0,
    unavailable: 0,
  };
  for (const g of groups) {
    const n = g._count._all;
    counts.total += n;
    if (g.action === "BLOCK") counts.blocked += n;
    if (g.action === "REDACT") counts.redacted += n;
    if (g.action === "ALLOW") counts.allowed += n;
    if (g.action === "UNAVAILABLE") counts.unavailable += n;
  }
  return counts;
}

/** The window the judge-availability figure and its alert cover. */
const JUDGE_REPORT_WINDOW_HOURS = 24;

/**
 * The share of guard calls without a verdict at which the console raises its
 * alert (owner decision 2026-10-02: a metric and an alert on the
 * judge-unavailable rate). At or above it, and with at least one case, the
 * Enforcement card shows the alert to the guardrail administrators.
 */
export const JUDGE_UNAVAILABLE_ALERT_RATE = 0.01;

/**
 * How often the judge model could not answer, among the guard calls stored in
 * the last JUDGE_REPORT_WINDOW_HOURS (Readiness Ledger N-64). Each stored
 * event is one guard call; an `unavailable` event is one with no verdict.
 * Under enforce, each of those requests is refused.
 */
export async function judgeAvailability(
  db: EventsDb,
  input: { projectId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const since = new Date(
    now.getTime() - JUDGE_REPORT_WINDOW_HOURS * 3600 * 1000,
  );
  const counts = await countByAction(db, input.projectId, now, since);
  const rate = counts.total > 0 ? counts.unavailable / counts.total : null;
  return {
    since,
    windowHours: JUDGE_REPORT_WINDOW_HOURS,
    calls: counts.total,
    unavailable: counts.unavailable,
    rate,
    alertRate: JUDGE_UNAVAILABLE_ALERT_RATE,
    alert:
      counts.unavailable > 0 &&
      rate !== null &&
      rate >= JUDGE_UNAVAILABLE_ALERT_RATE,
  };
}
