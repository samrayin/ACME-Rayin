/**
 * ACME (CHG-2026-101, ADR-0011): masking of audit-log entries for the
 * content-free roles (Security Analyst, Business Analyst, Auditor).
 *
 * An audit-log entry stores the audited resource's state before and after
 * the change as JSON. For a prompt that is the prompt text, for a score its
 * value and comment, for a dataset run item its input; none of which these
 * roles may read anywhere else. The entry is still evidence they need, so
 * instead of hiding it, each state keeps only the fields named below and
 * every other field is replaced by a marker that says whether it changed.
 *
 * An allow-list, not a deny-list, on purpose: a resource type or field added
 * by a future upstream merge is masked until someone deliberately allows it.
 * A field is kept only when its value is a primitive or a list of
 * primitives; an object under an allowed name is masked too.
 */

/** Field names whose values are metadata, not content. */
export const AUDIT_LOG_METADATA_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "projectId",
  "orgId",
  "organizationId",
  "userId",
  "apiKeyId",
  "datasetId",
  "datasetItemId",
  "datasetRunId",
  "promptId",
  "dashboardId",
  "queueId",
  "traceId",
  "observationId",
  "name",
  "version",
  "labels",
  "tags",
  "type",
  "kind",
  "role",
  "projectRole",
  "orgRole",
  "status",
  "isActive",
  "enabled",
  "provider",
  "adapter",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "expiresAt",
  "lastUsedAt",
  "createdBy",
  "updatedBy",
]);

/**
 * Resource types whose stored state is shown unmasked. Guardrail settings
 * are written through `settingsForAudit`, a curated configuration snapshot
 * that these roles already read through `acmeGuardrails.getConfig` and
 * `acmeGuardrails.modeChanges`.
 */
// Not exported: used only inside this module (knip, CHG-2026-113).
const UNMASKED_AUDIT_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "acmeGuardrailSettings",
]);

export const MASKED = "[masked]";
export const MASKED_CHANGED = "[masked: changed]";

type Json = unknown;

function isPrimitive(v: Json): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function isMetadataValue(v: Json): boolean {
  return isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive));
}

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parses a stored state; undefined when it is not valid JSON. */
function parse(state: string): Json | undefined {
  try {
    return JSON.parse(state) as Json;
  } catch {
    return undefined;
  }
}

function sameValue(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Masks one entry's before and after states for a content-free reader. Each
 * state is a JSON string or null, as stored; the result has the same shape.
 * A masked field reads MASKED_CHANGED in both states when its value differs
 * between them (or exists in only one), and MASKED otherwise.
 */
export function maskAuditLogStates(entry: {
  resourceType: string;
  before: string | null;
  after: string | null;
}): { before: string | null; after: string | null } {
  if (UNMASKED_AUDIT_RESOURCE_TYPES.has(entry.resourceType)) {
    return { before: entry.before, after: entry.after };
  }

  const before = entry.before === null ? null : parse(entry.before);
  const after = entry.after === null ? null : parse(entry.after);

  const maskState = (
    raw: string | null,
    state: Json | undefined,
    other: Json | undefined,
  ) => {
    if (raw === null) return null;
    // Not JSON, or not an object: nothing can be told apart from content.
    if (!isPlainObject(state)) {
      return JSON.stringify(
        entry.before === entry.after ? MASKED : MASKED_CHANGED,
      );
    }
    const otherObj = isPlainObject(other) ? other : {};
    const masked: Record<string, Json> = {};
    for (const [key, value] of Object.entries(state)) {
      if (AUDIT_LOG_METADATA_FIELDS.has(key) && isMetadataValue(value)) {
        masked[key] = value;
      } else {
        masked[key] =
          key in otherObj && sameValue(value, otherObj[key])
            ? MASKED
            : MASKED_CHANGED;
      }
    }
    return JSON.stringify(masked);
  };

  return {
    before: maskState(entry.before, before, after),
    after: maskState(entry.after, after, before),
  };
}
