/**
 * ACME addition (ADR-0003, CHG-2026-005): what CAIRO does to the LiteLLM
 * gateway, independent of tRPC so it can be unit-tested with fakes.
 *
 * Invariants:
 *  - Every mutation goes through `auditedMutation` (INTENT row first,
 *    OUTCOME row before the caller gets a result).
 *  - A CAIRO row is written BEFORE LiteLLM is called (status PENDING), so
 *    CAIRO always knows about anything it may have created.
 *  - Metadata sent to LiteLLM is always the MERGED object: /key/update
 *    replaces the whole metadata object, and LiteLLM keeps its own settings
 *    inside it. CAIRO only ever touches `cairo_*` keys.
 *  - Rotation is an OSS-tier composition (create, then delete), NOT native
 *    rotation: /key/{key}/regenerate is Enterprise-gated. It never reports
 *    success unless both steps succeeded.
 *  - Drift is matched on metadata.cairo_key_id, not on the token hash.
 */
import { createHash, randomUUID } from "crypto";
import { type Prisma, type PrismaClient } from "@prisma/client";
import {
  LitellmHttpError,
  LitellmUnreachableError,
  type LitellmActivityMetrics,
  type LitellmClient,
  type LitellmKeyRow,
  type LitellmKeySettings,
} from "./acmeLitellmClient";
import {
  auditedMutation,
  type LitellmEventActor,
  type LitellmEventWriteFn,
} from "./acmeLitellmEventWriter";

export type LitellmDb = Pick<
  PrismaClient,
  "acmeLitellmKey" | "acmeLitellmTeam" | "acmeLitellmSpendSnapshot"
>;

export type LitellmServiceDeps = {
  client: LitellmClient;
  db: LitellmDb;
  write: LitellmEventWriteFn;
  now?: () => Date;
};

export type LitellmScope = { orgId: string; projectId: string };

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const CAIRO_METADATA_PREFIX = "cairo_";

export type CairoKeyMetadata = {
  cairo_managed: true;
  cairo_key_id: string;
  cairo_lineage_id: string;
  cairo_org_id: string;
  cairo_project_id: string;
  cairo_created_by: string;
};

/**
 * Returns `existing` with every `cairo_*` key replaced by `cairo`, and
 * everything else untouched. LiteLLM stores its own key settings inside the
 * same metadata object (tags, guardrails, temp_budget_increase,
 * model_rpm_limit, ...), and /key/update REPLACES the object, so sending only
 * CAIRO's fields would silently erase them.
 */
export function mergeCairoMetadata(
  existing: Record<string, unknown> | null | undefined,
  cairo: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing ?? {})) {
    if (!k.startsWith(CAIRO_METADATA_PREFIX)) merged[k] = v;
  }
  for (const [k, v] of Object.entries(cairo)) {
    if (!k.startsWith(CAIRO_METADATA_PREFIX)) {
      throw new Error(
        `CAIRO may only write ${CAIRO_METADATA_PREFIX}* metadata keys, got "${k}"`,
      );
    }
    merged[k] = v;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** LiteLLM's token hash is the SHA-256 hex digest of the key. */
export function hashLitellmKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function buildKeyAlias(
  displayName: string,
  keyId: string,
  generation: number,
): string {
  const slug =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "key";
  // Aliases are unique across the whole gateway: the id fragment makes them
  // unique across projects, the generation suffix across rotations.
  const base = `cairo-${slug}-${keyId.replace(/-/g, "").slice(0, 8)}`;
  return generation > 1 ? `${base}-r${generation}` : base;
}

export type KeyLimits = {
  models: string[];
  maxBudget: number | null;
  budgetDuration: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
};

export type CreateKeyInput = KeyLimits & {
  displayName: string;
  teamId: string | null;
  /** Days until the key expires; null = no expiry. */
  expiresInDays: number | null;
};

function limitsToLitellm(l: KeyLimits): LitellmKeySettings {
  return {
    models: l.models,
    max_budget: l.maxBudget,
    budget_duration: l.budgetDuration,
    rpm_limit: l.rpmLimit,
    tpm_limit: l.tpmLimit,
  };
}

/** What may be written to the record about a key. Never key material. */
function safeKeyView(row: {
  id: string;
  displayName: string;
  litellmKeyAlias: string;
  tokenHash: string | null;
  litellmTeamId: string | null;
  status: string;
  models: string[];
  maxBudget: number | null;
  budgetDuration: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  expiresAt: Date | null;
  generation: number;
  lineageId: string;
}) {
  return {
    id: row.id,
    displayName: row.displayName,
    alias: row.litellmKeyAlias,
    tokenHash: row.tokenHash,
    teamId: row.litellmTeamId,
    status: row.status,
    models: row.models,
    maxBudget: row.maxBudget,
    budgetDuration: row.budgetDuration,
    rpmLimit: row.rpmLimit,
    tpmLimit: row.tpmLimit,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    generation: row.generation,
    lineageId: row.lineageId,
  };
}

export class LitellmNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found in this project.`);
    this.name = "LitellmNotFoundError";
  }
}

export class LitellmInvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LitellmInvalidStateError";
  }
}

/** Rotation failed and was undone: the original key is unchanged and still valid. */
export class LitellmRotationRolledBackError extends Error {
  constructor(cause: string) {
    super(
      `Rotation failed and was undone: the existing key is unchanged and still valid. Cause: ${cause}`,
    );
    this.name = "LitellmRotationRolledBackError";
  }
}

/** Rotation is half-done: BOTH keys are live. Needs operator action. */
export class LitellmRotationPartialError extends Error {
  constructor(
    public readonly oldKeyId: string,
    public readonly newKeyId: string,
    public readonly correlationId: string,
  ) {
    super(
      "Rotation did NOT complete: a new key was created, the old key could not be revoked, and the new key " +
        "could not be removed either. Both keys are currently valid. The key is marked as needing action; " +
        "use 'Resolve' to remove the new key. The new secret was not revealed. " +
        `Correlation ID ${correlationId}.`,
    );
    this.name = "LitellmRotationPartialError";
  }
}

async function requireTeam(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  teamId: string,
) {
  const team = await deps.db.acmeLitellmTeam.findFirst({
    where: { id: teamId, projectId: scope.projectId, status: "ACTIVE" },
  });
  if (!team) throw new LitellmNotFoundError("The team");
  return team;
}

async function requireKey(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  keyId: string,
) {
  // projectId is part of the WHERE clause, never a client-supplied afterthought:
  // a key id from another project simply does not exist here.
  const key = await deps.db.acmeLitellmKey.findFirst({
    where: { id: keyId, projectId: scope.projectId },
  });
  if (!key) throw new LitellmNotFoundError("The key");
  return key;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

type InternalCreate = {
  keyId: string;
  lineageId: string;
  generation: number;
  displayName: string;
  limits: KeyLimits;
  teamId: string | null;
  duration: string | null;
  carriedSpend?: number;
};

/**
 * PENDING row -> /key/generate -> ACTIVE row. Returns the secret (once).
 * If LiteLLM created the key but CAIRO cannot record it, the new LiteLLM key
 * is deleted again so nothing CAIRO does not know about is left behind.
 */
async function createKeyInLitellm(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  p: InternalCreate,
) {
  const alias = buildKeyAlias(p.displayName, p.keyId, p.generation);
  await deps.db.acmeLitellmKey.create({
    data: {
      id: p.keyId,
      orgId: scope.orgId,
      projectId: scope.projectId,
      lineageId: p.lineageId,
      generation: p.generation,
      displayName: p.displayName,
      litellmKeyAlias: alias,
      litellmTeamId: p.teamId,
      status: "PENDING",
      models: p.limits.models,
      maxBudget: p.limits.maxBudget,
      budgetDuration: p.limits.budgetDuration,
      rpmLimit: p.limits.rpmLimit,
      tpmLimit: p.limits.tpmLimit,
      createdByUserId: actor.userId,
    },
  });

  const metadata: CairoKeyMetadata = {
    cairo_managed: true,
    cairo_key_id: p.keyId,
    cairo_lineage_id: p.lineageId,
    cairo_org_id: scope.orgId,
    cairo_project_id: scope.projectId,
    cairo_created_by: actor.userId,
  };

  let generated;
  try {
    generated = await deps.client.generateKey(
      {
        ...limitsToLitellm(p.limits),
        key_alias: alias,
        team_id: p.teamId,
        duration: p.duration,
        ...(p.carriedSpend && p.carriedSpend > 0
          ? { spend: p.carriedSpend }
          : {}),
        metadata: mergeCairoMetadata({}, metadata),
      },
      actor.userId,
    );
  } catch (e) {
    await deps.db.acmeLitellmKey
      .update({ where: { id: p.keyId }, data: { status: "FAILED" } })
      .catch(() => undefined);
    throw e;
  }

  const tokenHash = generated.token ?? hashLitellmKey(generated.key);
  try {
    const row = await deps.db.acmeLitellmKey.update({
      where: { id: p.keyId },
      data: {
        status: "ACTIVE",
        tokenHash,
        expiresAt: generated.expires ? new Date(generated.expires) : null,
      },
    });
    return { row, secret: generated.key };
  } catch (e) {
    // LiteLLM has a key CAIRO could not record. Remove it again.
    await deps.client.deleteKey(tokenHash, actor.userId).catch(() => undefined);
    await deps.db.acmeLitellmKey
      .update({ where: { id: p.keyId }, data: { status: "FAILED" } })
      .catch(() => undefined);
    throw e;
  }
}

export async function createKey(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  input: CreateKeyInput,
) {
  if (input.teamId) await requireTeam(deps, scope, input.teamId);
  const keyId = randomUUID();
  const { teamId, displayName, expiresInDays, ...limits } = input;

  return auditedMutation(
    {
      action: "key.create",
      resourceType: "litellmKey",
      resourceId: keyId,
      actor,
      ...scope,
      before: null,
    },
    async () => {
      const { row, secret } = await createKeyInLitellm(deps, scope, actor, {
        keyId,
        lineageId: keyId,
        generation: 1,
        displayName,
        limits,
        teamId,
        duration: expiresInDays ? `${expiresInDays}d` : null,
      });
      // `secret` goes to the caller only. `after` is the safe view.
      return {
        result: { key: safeKeyView(row), secret },
        after: safeKeyView(row),
      };
    },
    deps.write,
  );
}

export async function updateKeyLimits(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  keyId: string,
  limits: KeyLimits,
) {
  const key = await requireKey(deps, scope, keyId);
  if (key.status !== "ACTIVE" || !key.tokenHash) {
    throw new LitellmInvalidStateError(
      `Only an active key can be changed (this one is ${key.status.toLowerCase()}).`,
    );
  }
  const tokenHash = key.tokenHash;

  return auditedMutation(
    {
      action: "key.update",
      resourceType: "litellmKey",
      resourceId: key.id,
      actor,
      ...scope,
      before: safeKeyView(key),
    },
    async () => {
      // Read-merge-write: never send a bare metadata object to /key/update.
      const live = await deps.client.keyInfo(tokenHash);
      if (!live)
        throw new LitellmInvalidStateError(
          "LiteLLM no longer has this key (drift: missing).",
        );
      const metadata = mergeCairoMetadata(live.metadata ?? {}, {
        cairo_managed: true,
        cairo_key_id: key.id,
        cairo_lineage_id: key.lineageId,
        cairo_org_id: key.orgId,
        cairo_project_id: key.projectId,
        cairo_created_by: key.createdByUserId,
      });
      await deps.client.updateKey(
        tokenHash,
        { ...limitsToLitellm(limits), metadata },
        actor.userId,
      );
      const row = await deps.db.acmeLitellmKey.update({
        where: { id: key.id },
        data: { ...limits },
      });
      return { result: safeKeyView(row), after: safeKeyView(row) };
    },
    deps.write,
  );
}

async function deleteInLitellm(
  deps: LitellmServiceDeps,
  tokenHash: string,
  changedBy: string,
) {
  try {
    await deps.client.deleteKey(tokenHash, changedBy);
    return { alreadyGone: false };
  } catch (e) {
    // Already absent in LiteLLM: the desired end state holds.
    if (e instanceof LitellmHttpError && e.status === 404)
      return { alreadyGone: true };
    throw e;
  }
}

export async function revokeKey(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  keyId: string,
) {
  const key = await requireKey(deps, scope, keyId);
  if (!key.tokenHash || !["ACTIVE", "ROTATION_PARTIAL"].includes(key.status)) {
    throw new LitellmInvalidStateError(
      `This key is ${key.status.toLowerCase()} and cannot be revoked.`,
    );
  }
  const tokenHash = key.tokenHash;
  const now = (deps.now ?? (() => new Date()))();

  return auditedMutation(
    {
      action: "key.revoke",
      resourceType: "litellmKey",
      resourceId: key.id,
      actor,
      ...scope,
      before: safeKeyView(key),
    },
    async () => {
      const { alreadyGone } = await deleteInLitellm(
        deps,
        tokenHash,
        actor.userId,
      );
      const row = await deps.db.acmeLitellmKey.update({
        where: { id: key.id },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedByUserId: actor.userId,
        },
      });
      return {
        result: safeKeyView(row),
        after: { ...safeKeyView(row), alreadyAbsentInLitellm: alreadyGone },
      };
    },
    deps.write,
  );
}

export type RotateKeyResult =
  | { status: "rotated"; key: ReturnType<typeof safeKeyView>; secret: string }
  | {
      status: "partial";
      oldKeyId: string;
      newKeyId: string;
      correlationId: string;
    };

/**
 * Compose-and-revoke rotation. One correlation ID across every row:
 *   key.rotate (INTENT) -> key.rotate.create -> key.rotate.revoke
 *   [-> key.rotate.compensate] -> key.rotate (OUTCOME)
 */
export async function rotateKey(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  keyId: string,
): Promise<Extract<RotateKeyResult, { status: "rotated" }>> {
  const old = await requireKey(deps, scope, keyId);
  if (old.status !== "ACTIVE" || !old.tokenHash) {
    throw new LitellmInvalidStateError(
      `Only an active key can be rotated (this one is ${old.status.toLowerCase()}).`,
    );
  }
  const oldHash = old.tokenHash;
  const newKeyId = randomUUID();
  const now = deps.now ?? (() => new Date());
  const step = { resourceType: "litellmKey" as const, actor, ...scope };

  return auditedMutation<RotateKeyResult>(
    {
      ...step,
      action: "key.rotate",
      resourceId: old.id,
      before: safeKeyView(old),
    },
    async (correlationId) => {
      // Carry spend and remaining lifetime so rotating cannot reset a budget
      // or extend an expiry.
      const live = await deps.client.keyInfo(oldHash);
      if (!live)
        throw new LitellmInvalidStateError(
          "LiteLLM no longer has this key (drift: missing).",
        );
      const remainingMs = old.expiresAt
        ? old.expiresAt.getTime() - now().getTime()
        : null;
      if (remainingMs !== null && remainingMs <= 0) {
        throw new LitellmInvalidStateError(
          "This key has already expired; create a new key instead.",
        );
      }

      // (a) create the replacement
      const created = await auditedMutation(
        {
          ...step,
          action: "key.rotate.create",
          resourceId: newKeyId,
          correlationId,
          before: null,
        },
        async () => {
          const c = await createKeyInLitellm(deps, scope, actor, {
            keyId: newKeyId,
            lineageId: old.lineageId,
            generation: old.generation + 1,
            displayName: old.displayName,
            limits: {
              models: old.models,
              maxBudget: old.maxBudget,
              budgetDuration: old.budgetDuration,
              rpmLimit: old.rpmLimit,
              tpmLimit: old.tpmLimit,
            },
            teamId: old.litellmTeamId,
            duration:
              remainingMs === null
                ? null
                : `${Math.max(1, Math.ceil(remainingMs / 1000))}s`,
            carriedSpend: live.spend ?? 0,
          });
          return { result: c, after: safeKeyView(c.row) };
        },
        deps.write,
      );
      const newHash = created.row.tokenHash!;

      // (b) revoke the old key
      try {
        await auditedMutation(
          {
            ...step,
            action: "key.rotate.revoke",
            resourceId: old.id,
            correlationId,
            before: safeKeyView(old),
          },
          async () => {
            await deleteInLitellm(deps, oldHash, actor.userId);
            const row = await deps.db.acmeLitellmKey.update({
              where: { id: old.id },
              data: {
                status: "ROTATED",
                revokedAt: now(),
                revokedByUserId: actor.userId,
                rotatedToKeyId: newKeyId,
              },
            });
            return { result: row, after: safeKeyView(row) };
          },
          deps.write,
        );
      } catch (revokeError) {
        const cause =
          revokeError instanceof Error
            ? revokeError.message
            : String(revokeError);
        // (c) compensate: remove the new key so the starting state holds.
        let compensated = false;
        try {
          await auditedMutation(
            {
              ...step,
              action: "key.rotate.compensate",
              resourceId: newKeyId,
              correlationId,
              before: safeKeyView(created.row),
            },
            async () => {
              await deleteInLitellm(deps, newHash, actor.userId);
              const row = await deps.db.acmeLitellmKey.update({
                where: { id: newKeyId },
                data: {
                  status: "REVOKED",
                  revokedAt: now(),
                  revokedByUserId: actor.userId,
                },
              });
              return { result: row, after: safeKeyView(row) };
            },
            deps.write,
          );
          compensated = true;
        } catch {
          compensated = false;
        }
        if (compensated) throw new LitellmRotationRolledBackError(cause);

        // Both keys are live. Record it; never report success.
        await deps.db.acmeLitellmKey
          .update({
            where: { id: old.id },
            data: { status: "ROTATION_PARTIAL", rotatedToKeyId: newKeyId },
          })
          .catch(() => undefined);
        return {
          result: {
            status: "partial",
            oldKeyId: old.id,
            newKeyId,
            correlationId,
          },
          outcome: "PARTIAL",
          after: { oldKeyId: old.id, newKeyId, bothKeysLive: true },
          errorMessage: `revoke of old key failed and compensation failed: ${cause}`,
        };
      }

      return {
        result: {
          status: "rotated",
          key: safeKeyView(created.row),
          secret: created.secret,
        },
        after: { oldKeyId: old.id, newKey: safeKeyView(created.row) },
      };
    },
    deps.write,
  ).then((r) => {
    if (r.status === "partial")
      throw new LitellmRotationPartialError(
        r.oldKeyId,
        r.newKeyId,
        r.correlationId,
      );
    return r;
  });
  // (the partial branch never reaches a caller: it is thrown above)
}

/**
 * Finishes the compensation of a ROTATION_PARTIAL key: removes the NEW key
 * (whose secret was never revealed) so the original key is the only one live.
 */
export async function resolvePartialRotation(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  keyId: string,
) {
  const old = await requireKey(deps, scope, keyId);
  if (old.status !== "ROTATION_PARTIAL" || !old.rotatedToKeyId) {
    throw new LitellmInvalidStateError(
      "This key is not in a partial-rotation state.",
    );
  }
  const fresh = await requireKey(deps, scope, old.rotatedToKeyId);
  const now = (deps.now ?? (() => new Date()))();

  return auditedMutation(
    {
      action: "key.rotate.compensate",
      resourceType: "litellmKey",
      resourceId: fresh.id,
      actor,
      ...scope,
      before: safeKeyView(fresh),
    },
    async () => {
      if (fresh.tokenHash)
        await deleteInLitellm(deps, fresh.tokenHash, actor.userId);
      await deps.db.acmeLitellmKey.update({
        where: { id: fresh.id },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedByUserId: actor.userId,
        },
      });
      const row = await deps.db.acmeLitellmKey.update({
        where: { id: old.id },
        data: { status: "ACTIVE", rotatedToKeyId: null },
      });
      return { result: safeKeyView(row), after: safeKeyView(row) };
    },
    deps.write,
  );
}

// ---------------------------------------------------------------------------
// Listing and drift
// ---------------------------------------------------------------------------

export type KeyDrift = "in_sync" | "missing" | "drifted" | "unknown";

function sameSet(a: string[], b: string[]) {
  return (
    a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ")
  );
}

export function compareKeyWithLive(
  row: {
    models: string[];
    maxBudget: number | null;
    rpmLimit: number | null;
    tpmLimit: number | null;
    litellmTeamId: string | null;
  },
  live: LitellmKeyRow,
): string[] {
  const diffs: string[] = [];
  if (!sameSet(row.models, live.models ?? [])) diffs.push("models");
  if ((row.maxBudget ?? null) !== (live.max_budget ?? null))
    diffs.push("maxBudget");
  if ((row.rpmLimit ?? null) !== (live.rpm_limit ?? null))
    diffs.push("rpmLimit");
  if ((row.tpmLimit ?? null) !== (live.tpm_limit ?? null))
    diffs.push("tpmLimit");
  if ((row.litellmTeamId ?? null) !== (live.team_id ?? null))
    diffs.push("team");
  return diffs;
}

function cairoKeyIdOf(live: LitellmKeyRow): string | null {
  const v = live.metadata?.cairo_key_id;
  return typeof v === "string" ? v : null;
}

/**
 * The project's keys, joined to LiteLLM's live view. When the gateway is
 * unreachable the CAIRO rows are still returned, with `reachable: false`.
 */
export async function listProjectKeys(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
) {
  const rows = await deps.db.acmeLitellmKey.findMany({
    where: { projectId: scope.projectId },
    orderBy: { createdAt: "desc" },
  });

  let liveById: Map<string, LitellmKeyRow> | null = null;
  let unreachableReason: string | null = null;
  try {
    const live = await deps.client.listAllKeys();
    liveById = new Map();
    for (const k of live) {
      const id = cairoKeyIdOf(k);
      if (id) liveById.set(id, k);
    }
  } catch (e) {
    if (
      !(e instanceof LitellmUnreachableError) &&
      !(e instanceof LitellmHttpError)
    )
      throw e;
    unreachableReason = e.message;
  }

  return {
    reachable: liveById !== null,
    unreachableReason,
    keys: rows.map((row) => {
      const live = liveById?.get(row.id);
      let drift: KeyDrift = "unknown";
      let driftFields: string[] = [];
      if (liveById) {
        if (row.status === "ACTIVE" || row.status === "ROTATION_PARTIAL") {
          if (!live) drift = "missing";
          else {
            driftFields = compareKeyWithLive(row, live);
            drift = driftFields.length ? "drifted" : "in_sync";
          }
        } else {
          // A revoked/rotated key that still exists in LiteLLM is drift too.
          drift = live ? "drifted" : "in_sync";
          if (live) driftFields = ["stillPresentInLitellm"];
        }
      }
      return {
        ...safeKeyView(row),
        createdAt: row.createdAt.toISOString(),
        createdByUserId: row.createdByUserId,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        rotatedToKeyId: row.rotatedToKeyId,
        liveSpend: live?.spend ?? null,
        lastActive: live?.last_active ?? null,
        drift,
        driftFields,
      };
    }),
  };
}

/**
 * Keys that exist in LiteLLM without CAIRO's metadata. They belong to no
 * project, so the router shows them to organisation owners only. Read-only.
 */
export async function listUnmanagedKeys(deps: LitellmServiceDeps) {
  const live = await deps.client.listAllKeys();
  return live
    .filter((k) => k.metadata?.cairo_managed !== true)
    .map((k) => ({
      tokenHashPrefix: k.token.slice(0, 12),
      alias: k.key_alias ?? null,
      models: k.models ?? [],
      maxBudget: k.max_budget ?? null,
      spend: k.spend ?? null,
      teamId: k.team_id ?? null,
      expires: k.expires ?? null,
      createdAt: k.created_at ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export type TeamInput = KeyLimits & { teamAlias: string };

function safeTeamView(row: {
  id: string;
  teamAlias: string;
  status: string;
  models: string[];
  maxBudget: number | null;
  budgetDuration: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
}) {
  return {
    id: row.id,
    teamAlias: row.teamAlias,
    status: row.status,
    models: row.models,
    maxBudget: row.maxBudget,
    budgetDuration: row.budgetDuration,
    rpmLimit: row.rpmLimit,
    tpmLimit: row.tpmLimit,
  };
}

export async function createTeam(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  input: TeamInput,
) {
  const teamId = randomUUID();
  const { teamAlias, ...limits } = input;
  return auditedMutation(
    {
      action: "team.create",
      resourceType: "litellmTeam",
      resourceId: teamId,
      actor,
      ...scope,
      before: null,
    },
    async () => {
      await deps.db.acmeLitellmTeam.create({
        data: {
          id: teamId,
          ...scope,
          teamAlias,
          status: "PENDING",
          ...limits,
          createdByUserId: actor.userId,
        },
      });
      try {
        await deps.client.newTeam(
          {
            team_id: teamId,
            // Aliases are gateway-wide; the id fragment keeps two projects'
            // "default" teams apart.
            team_alias: `${teamAlias} (${teamId.slice(0, 8)})`,
            models: limits.models,
            max_budget: limits.maxBudget,
            budget_duration: limits.budgetDuration,
            rpm_limit: limits.rpmLimit,
            tpm_limit: limits.tpmLimit,
            metadata: mergeCairoMetadata(
              {},
              {
                cairo_managed: true,
                cairo_team_id: teamId,
                cairo_org_id: scope.orgId,
                cairo_project_id: scope.projectId,
                cairo_created_by: actor.userId,
              },
            ),
          },
          actor.userId,
        );
      } catch (e) {
        await deps.db.acmeLitellmTeam
          .update({ where: { id: teamId }, data: { status: "FAILED" } })
          .catch(() => undefined);
        throw e;
      }
      const row = await deps.db.acmeLitellmTeam.update({
        where: { id: teamId },
        data: { status: "ACTIVE" },
      });
      return { result: safeTeamView(row), after: safeTeamView(row) };
    },
    deps.write,
  );
}

export async function updateTeamLimits(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  teamId: string,
  limits: KeyLimits,
) {
  const team = await requireTeam(deps, scope, teamId);
  return auditedMutation(
    {
      action: "team.update",
      resourceType: "litellmTeam",
      resourceId: team.id,
      actor,
      ...scope,
      before: safeTeamView(team),
    },
    async () => {
      // No metadata sent: /team/update leaves metadata alone when it is absent.
      await deps.client.updateTeam(
        team.id,
        {
          models: limits.models,
          max_budget: limits.maxBudget,
          budget_duration: limits.budgetDuration,
          rpm_limit: limits.rpmLimit,
          tpm_limit: limits.tpmLimit,
        },
        actor.userId,
      );
      const row = await deps.db.acmeLitellmTeam.update({
        where: { id: team.id },
        data: { ...limits },
      });
      return { result: safeTeamView(row), after: safeTeamView(row) };
    },
    deps.write,
  );
}

export async function deleteTeam(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  actor: LitellmEventActor,
  teamId: string,
) {
  const team = await requireTeam(deps, scope, teamId);
  const liveKeys = await deps.db.acmeLitellmKey.count({
    where: {
      projectId: scope.projectId,
      litellmTeamId: team.id,
      status: { in: ["ACTIVE", "PENDING", "ROTATION_PARTIAL"] },
    },
  });
  if (liveKeys > 0) {
    throw new LitellmInvalidStateError(
      `This team still has ${liveKeys} live key(s). Revoke them first.`,
    );
  }
  const now = (deps.now ?? (() => new Date()))();
  return auditedMutation(
    {
      action: "team.delete",
      resourceType: "litellmTeam",
      resourceId: team.id,
      actor,
      ...scope,
      before: safeTeamView(team),
    },
    async () => {
      try {
        await deps.client.deleteTeam(team.id, actor.userId);
      } catch (e) {
        if (!(e instanceof LitellmHttpError && e.status === 404)) throw e;
      }
      const row = await deps.db.acmeLitellmTeam.update({
        where: { id: team.id },
        data: { status: "DELETED", deletedAt: now },
      });
      return { result: safeTeamView(row), after: safeTeamView(row) };
    },
    deps.write,
  );
}

export async function listProjectTeams(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
) {
  const rows = await deps.db.acmeLitellmTeam.findMany({
    where: {
      projectId: scope.projectId,
      status: { in: ["ACTIVE", "PENDING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  let live: Map<
    string,
    { spend: number | null; hasLitellmAdmin: boolean }
  > | null = null;
  try {
    live = new Map();
    for (const t of await deps.client.listAllTeams()) {
      live.set(t.team_id, {
        spend: t.spend ?? null,
        // LiteLLM's team "admin" role is Enterprise-gated and would let
        // someone manage keys around CAIRO. It should never be present.
        hasLitellmAdmin: (t.members_with_roles ?? []).some(
          (m) => m.role === "admin",
        ),
      });
    }
  } catch (e) {
    if (
      !(e instanceof LitellmUnreachableError) &&
      !(e instanceof LitellmHttpError)
    )
      throw e;
    live = null;
  }
  return {
    reachable: live !== null,
    teams: rows.map((row) => ({
      ...safeTeamView(row),
      createdAt: row.createdAt.toISOString(),
      liveSpend: live?.get(row.id)?.spend ?? null,
      missingInLitellm: live ? !live.has(row.id) : null,
      hasLitellmAdmin: live?.get(row.id)?.hasLitellmAdmin ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Snapshots (read degradation)
// ---------------------------------------------------------------------------

type Snapshotted<T> = {
  data: T;
  fetchedAt: string;
  stale: boolean;
  staleReason: string | null;
};

async function withSnapshot<T>(
  deps: LitellmServiceDeps,
  cacheKey: string,
  maxAgeMs: number,
  fetchFresh: () => Promise<T>,
  forceRefresh = false,
): Promise<
  | Snapshotted<T>
  | { data: null; fetchedAt: null; stale: true; staleReason: string }
> {
  const now = (deps.now ?? (() => new Date()))();
  const cached = await deps.db.acmeLitellmSpendSnapshot.findUnique({
    where: { cacheKey },
  });
  if (
    cached &&
    !forceRefresh &&
    now.getTime() - cached.fetchedAt.getTime() < maxAgeMs
  ) {
    return {
      data: cached.payload as T,
      fetchedAt: cached.fetchedAt.toISOString(),
      stale: false,
      staleReason: null,
    };
  }
  try {
    const data = await fetchFresh();
    await deps.db.acmeLitellmSpendSnapshot.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        payload: data as Prisma.InputJsonValue,
        fetchedAt: now,
      },
      update: { payload: data as Prisma.InputJsonValue, fetchedAt: now },
    });
    return {
      data,
      fetchedAt: now.toISOString(),
      stale: false,
      staleReason: null,
    };
  } catch (e) {
    if (
      !(e instanceof LitellmUnreachableError) &&
      !(e instanceof LitellmHttpError)
    )
      throw e;
    if (cached) {
      return {
        data: cached.payload as T,
        fetchedAt: cached.fetchedAt.toISOString(),
        stale: true,
        staleReason: e.message,
      };
    }
    return { data: null, fetchedAt: null, stale: true, staleReason: e.message };
  }
}

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

export type CatalogueEntry = {
  modelName: string;
  providers: string[];
  mode: string | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputCostPerToken: number | null;
  outputCostPerToken: number | null;
  health: "healthy" | "unhealthy" | "unknown";
  healthError: string | null;
};

const CATALOGUE_MAX_AGE_MS = 5 * 60_000;

/**
 * Health comes from GET /health, which makes a REAL call to every provider
 * (/model_group/info reports health_status: null on 1.100.1). So the result
 * is cached for 5 minutes and only refreshed on demand. An unhealthy provider
 * is shown as unhealthy, with LiteLLM's own reason -- it is never hidden.
 */
export function getCatalogue(deps: LitellmServiceDeps, forceRefresh = false) {
  return withSnapshot<CatalogueEntry[]>(
    deps,
    "catalogue",
    CATALOGUE_MAX_AGE_MS,
    async () => {
      const [groups, models, health] = await Promise.all([
        deps.client.modelGroups(),
        deps.client.models(),
        deps.client.health(),
      ]);
      // /health reports the provider model string; map it back to model_name.
      const nameByProviderModel = new Map<string, string>();
      for (const m of models) {
        if (m.litellm_params?.model)
          nameByProviderModel.set(m.litellm_params.model, m.model_name);
      }
      const state = new Map<
        string,
        { health: "healthy" | "unhealthy"; error: string | null }
      >();
      for (const h of health.healthy_endpoints ?? []) {
        const name = h.model ? nameByProviderModel.get(h.model) : undefined;
        if (name) state.set(name, { health: "healthy", error: null });
      }
      for (const h of health.unhealthy_endpoints ?? []) {
        const name = h.model ? nameByProviderModel.get(h.model) : undefined;
        if (name) {
          const raw =
            typeof h.error === "string"
              ? h.error
              : JSON.stringify(h.error ?? "");
          state.set(name, {
            health: "unhealthy",
            error: raw.replace(/\s+/g, " ").slice(0, 300),
          });
        }
      }
      return groups.map((g) => ({
        modelName: g.model_group,
        providers: g.providers ?? [],
        mode: g.mode ?? null,
        maxInputTokens: g.max_input_tokens ?? null,
        maxOutputTokens: g.max_output_tokens ?? null,
        inputCostPerToken: g.input_cost_per_token ?? null,
        outputCostPerToken: g.output_cost_per_token ?? null,
        health: state.get(g.model_group)?.health ?? "unknown",
        healthError: state.get(g.model_group)?.error ?? null,
      }));
    },
    forceRefresh,
  );
}

// ---------------------------------------------------------------------------
// Spend and usage
// ---------------------------------------------------------------------------

export type UsageTotals = {
  spend: number;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

const zeroTotals = (): UsageTotals => ({
  spend: 0,
  requests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

function add(t: UsageTotals, m: LitellmActivityMetrics) {
  t.spend += m.spend ?? 0;
  t.requests += m.api_requests ?? 0;
  t.successfulRequests += m.successful_requests ?? 0;
  t.failedRequests += m.failed_requests ?? 0;
  t.promptTokens += m.prompt_tokens ?? 0;
  t.completionTokens += m.completion_tokens ?? 0;
  t.totalTokens += m.total_tokens ?? 0;
}

export type ProjectSpend = {
  startDate: string;
  endDate: string;
  totals: UsageTotals;
  byKey: Array<
    {
      keyId: string;
      displayName: string;
      status: string;
      teamId: string | null;
    } & UsageTotals
  >;
  byTeam: Array<{ teamId: string | null; teamAlias: string } & UsageTotals>;
  byModel: Array<{ model: string } & UsageTotals>;
  byDay: Array<{ date: string } & UsageTotals>;
};

const SPEND_MAX_AGE_MS = 60_000;

/**
 * Project spend is built by asking LiteLLM for ONE key at a time (api_key =
 * token hash) and adding up the keys this project owns -- including revoked
 * and rotated ones, whose history still belongs to the project. LiteLLM's
 * unfiltered breakdown covers the whole gateway and must never be shown to a
 * project. /global/spend/report, which does this natively, is Enterprise.
 */
export function getProjectSpend(
  deps: LitellmServiceDeps,
  scope: LitellmScope,
  startDate: string,
  endDate: string,
) {
  return withSnapshot<ProjectSpend>(
    deps,
    `spend:${scope.projectId}:${startDate}:${endDate}`,
    SPEND_MAX_AGE_MS,
    async () => {
      const [keys, teams] = await Promise.all([
        deps.db.acmeLitellmKey.findMany({
          where: { projectId: scope.projectId, tokenHash: { not: null } },
        }),
        deps.db.acmeLitellmTeam.findMany({
          where: { projectId: scope.projectId },
        }),
      ]);
      const teamAlias = new Map(teams.map((t) => [t.id, t.teamAlias]));

      const totals = zeroTotals();
      const byKey: ProjectSpend["byKey"] = [];
      const byTeam = new Map<
        string,
        { teamId: string | null; teamAlias: string } & UsageTotals
      >();
      const byModel = new Map<string, UsageTotals>();
      const byDay = new Map<string, UsageTotals>();

      // Small, bounded fan-out: 4 keys at a time.
      for (let i = 0; i < keys.length; i += 4) {
        const batch = keys.slice(i, i + 4);
        const activities = await Promise.all(
          batch.map((k) =>
            deps.client.dailyActivityForKey(k.tokenHash!, startDate, endDate),
          ),
        );
        batch.forEach((k, idx) => {
          const keyTotals = zeroTotals();
          for (const day of activities[idx]!.results) {
            add(keyTotals, day.metrics);
            add(totals, day.metrics);
            if (!byDay.has(day.date)) byDay.set(day.date, zeroTotals());
            add(byDay.get(day.date)!, day.metrics);
            // model_groups is the model_name a caller asked for.
            for (const [model, entry] of Object.entries(
              day.breakdown?.model_groups ?? {},
            )) {
              if (!byModel.has(model)) byModel.set(model, zeroTotals());
              add(byModel.get(model)!, entry.metrics);
            }
          }
          byKey.push({
            keyId: k.id,
            displayName: k.displayName,
            status: k.status,
            teamId: k.litellmTeamId,
            ...keyTotals,
          });
          const teamKey = k.litellmTeamId ?? "";
          if (!byTeam.has(teamKey)) {
            byTeam.set(teamKey, {
              teamId: k.litellmTeamId,
              teamAlias: k.litellmTeamId
                ? (teamAlias.get(k.litellmTeamId) ?? "(deleted team)")
                : "No team",
              ...zeroTotals(),
            });
          }
          const t = byTeam.get(teamKey)!;
          (Object.keys(keyTotals) as Array<keyof UsageTotals>).forEach(
            (f) => (t[f] += keyTotals[f]),
          );
        });
      }

      return {
        startDate,
        endDate,
        totals,
        byKey: byKey.sort((a, b) => b.requests - a.requests),
        byTeam: [...byTeam.values()].sort((a, b) => b.requests - a.requests),
        byModel: [...byModel.entries()]
          .map(([model, t]) => ({ model, ...t }))
          .sort((a, b) => b.requests - a.requests),
        byDay: [...byDay.entries()]
          .map(([date, t]) => ({ date, ...t }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  );
}
