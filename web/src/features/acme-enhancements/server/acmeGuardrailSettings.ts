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

/** Part a never enforces; part b (the enforcement switch) widens this. */
type GuardrailMode = "record";

type GuardrailPolicy = {
  piiEntities: PiiEntity[];
  jailbreakEnabled: boolean;
  topicalEnabled: boolean;
};

export type GuardrailSettingsVersion = GuardrailPolicy & {
  version: number;
  mode: GuardrailMode;
  reason: string;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
};

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

/** The body a rayin-guardrails pod receives on a pull. */
export function toSyncResponse(current: GuardrailSettingsVersion) {
  return {
    version: current.version,
    mode: current.mode,
    pii_entities: [...current.piiEntities],
    jailbreak_enabled: current.jailbreakEnabled,
    topical_enabled: current.topicalEnabled,
    updated_at: current.createdAt.toISOString(),
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
}): GuardrailSettingsVersion {
  return {
    ...normalisePolicy(row),
    version: row.version,
    // Part a stores only "record" (a CHECK constraint holds it there).
    mode: "record",
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

/**
 * Stores a new version if the policy differs from the one in force. Version
 * numbers are allocated inside the transaction; a concurrent save that takes
 * the same number fails on the unique version index and is retried once.
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
  },
  audit: (
    tx: Tx,
    change: {
      before: GuardrailSettingsVersion | null;
      current: GuardrailSettingsVersion;
    },
  ) => Promise<void>,
): Promise<SaveResult> {
  const policy = normalisePolicy(input.policy);
  const reason = validateReason(input.reason);

  const attempt = () =>
    db.$transaction(async (tx) => {
      const before = await getCurrentSettings(tx);
      if (before && policiesEqual(before, policy)) {
        return { changed: false as const, current: before };
      }
      const row = await tx.acmeGuardrailSettings.create({
        data: {
          version: (before?.version ?? 0) + 1,
          mode: "record",
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
    });

  try {
    return await attempt();
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return await attempt();
    throw e;
  }
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
