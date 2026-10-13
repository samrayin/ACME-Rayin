/**
 * ACME addition (EYEON telemetry ingest, LLD section 5, step A): who is sending.
 *
 * The caller presents the SAME gateway virtual key it uses for model calls. It
 * is looked up in the console's own key table by its SHA-256, so no call to the
 * gateway is made, and the project, organisation and lineage come from the
 * ROW. Nothing in the payload is ever consulted for who the caller is.
 *
 * One failure answer. Unknown, revoked, expired, rotated-out, not console-issued
 * and malformed keys all return the identical 401 body (SEC-2), so the endpoint
 * is not an oracle for which keys exist.
 *
 * The presented key is held in a local variable for one hash and is never
 * logged, stored, returned or put in an error message.
 */
import { createHash, timingSafeEqual } from "crypto";

/** What the key table gives us. Matches the AcmeLitellmKey columns used. */
export type KeyRecord = {
  id: string;
  orgId: string;
  projectId: string;
  lineageId: string;
  displayName: string;
  tokenHash: string | null;
  /** Prisma enum member name, e.g. "ACTIVE". */
  status: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type AuthenticatedKey = {
  keyId: string;
  orgId: string;
  projectId: string;
  lineageId: string;
  displayName: string;
};

export const ACTIVE_STATUS = "ACTIVE";

/** The one 401 body. A constant on purpose. */
export const UNAUTHORIZED_BODY = { message: "Unauthorized" } as const;

const MAX_KEY_LENGTH = 512;

type HeaderBag = Record<string, string | string[] | undefined>;

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * `Authorization: Bearer <key>` first, then `x-api-key: <key>` (a neutral alias,
 * so no vendor header name appears in a customer document). Header names are
 * expected lower-cased, as Node delivers them.
 */
export function extractPresentedKey(headers: HeaderBag): string | undefined {
  const auth = firstValue(headers.authorization);
  if (auth !== undefined) {
    const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(auth);
    if (m && m[1].length <= MAX_KEY_LENGTH) return m[1];
  }
  const alias = firstValue(headers["x-api-key"])?.trim();
  if (alias && alias.length <= MAX_KEY_LENGTH && !/\s/.test(alias))
    return alias;
  return undefined;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Active, not revoked, not expired, as of `nowMs`. */
export function isKeyUsable(record: KeyRecord, nowMs: number): boolean {
  if (record.status !== ACTIVE_STATUS) return false;
  if (record.revokedAt !== null) return false;
  if (record.expiresAt !== null && record.expiresAt.getTime() <= nowMs) {
    return false;
  }
  return true;
}

export type AuthDeps = {
  lookup: (tokenHash: string) => Promise<KeyRecord | null>;
  now: () => number;
  /** A found key is trusted for at most this long. Revocation shows within it. */
  ttlMs?: number;
  /** A miss is remembered briefly, so a flood of bad keys is one query each. */
  negativeTtlMs?: number;
  maxEntries?: number;
};

export const KEY_CACHE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 1000;

export function createKeyAuthenticator(deps: AuthDeps) {
  const ttl = Math.min(deps.ttlMs ?? KEY_CACHE_TTL_MS, KEY_CACHE_TTL_MS);
  const negativeTtl = deps.negativeTtlMs ?? NEGATIVE_TTL_MS;
  const maxEntries = deps.maxEntries ?? MAX_CACHE_ENTRIES;
  const cache = new Map<string, { record: KeyRecord | null; at: number }>();

  async function resolve(
    hash: string,
    nowMs: number,
  ): Promise<KeyRecord | null> {
    const hit = cache.get(hash);
    if (hit !== undefined) {
      const limit = hit.record === null ? negativeTtl : ttl;
      if (nowMs - hit.at < limit) return hit.record;
      cache.delete(hash);
    }
    const record = await deps.lookup(hash);
    cache.set(hash, { record, at: nowMs });
    // Bounded: hostile random keys cannot grow this without limit.
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return record;
  }

  return {
    /** The key's owner, or null for EVERY failure reason. */
    async authenticate(headers: HeaderBag): Promise<AuthenticatedKey | null> {
      const presented = extractPresentedKey(headers);
      if (presented === undefined) return null;
      const hash = hashKey(presented);
      const nowMs = deps.now();
      const record = await resolve(hash, nowMs);
      if (record === null || record.tokenHash === null) return null;
      if (!constantTimeEqualHex(hash, record.tokenHash)) return null;
      if (!isKeyUsable(record, nowMs)) return null;
      return {
        keyId: record.id,
        orgId: record.orgId,
        projectId: record.projectId,
        lineageId: record.lineageId,
        displayName: record.displayName,
      };
    },
  };
}
