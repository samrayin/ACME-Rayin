import crypto from "crypto";
import { env } from "../env";

const ENCRYPTION_KEY: string | undefined = env.ENCRYPTION_KEY; // Must be 256 bits (32 bytes, 64 hex characters)
const IV_LENGTH = 12; // For AES-GCM, this is always 12
const AUTH_TAG_LENGTH = 16; // 128 bits, the GCM standard -- pinned explicitly below (Semgrep gcm-no-tag-length: an unpinned tag length would let a truncated/corrupted authTagHex be accepted by setAuthTag instead of rejected, weakening GCM's authentication guarantee)

// Alternatively: openssl rand -hex 32
export function keyGen() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Encrypts the given plain text using AES-256-GCM algorithm.
 *
 * @param {string} plainText - The text to encrypt.
 * @param {string} [key] - Hex-encoded 256-bit key. Defaults to the shared
 *   global ENCRYPTION_KEY (existing behavior, unchanged for every existing
 *   caller). Pass an explicit key for a data category that should NOT share
 *   blast radius / rotation lifecycle with the global key -- see
 *   POSTGRES-COMPLIANCE-FRAMEWORK.md decision #7 (GUARDRAILS_ENCRYPTION_KEY
 *   for guardrail-event raw content: a different data owner and sensitivity
 *   profile than the LLM API keys / SSO secrets this module otherwise
 *   protects, so a compromise or rotation of one must not require touching
 *   the other).
 * @returns {string} The encrypted data in hex format, including IV and authentication tag.
 */
export function encrypt(plainText: string, key: string = ENCRYPTION_KEY ?? ""): string {
  if (!key) {
    throw new Error("Missing environment variable: `ENCRYPTION_KEY`");
  }
  const iv = crypto.randomBytes(IV_LENGTH); // Directly use Buffer returned by randomBytes
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    new Uint8Array(Buffer.from(key, "hex")),
    new Uint8Array(iv),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Return iv, encrypted data, and authTag as hex, combined in one line
  return iv.toString("hex") + ":" + encrypted + ":" + authTag.toString("hex");
}

/** See encrypt()'s `key` param doc -- same default, same rationale. */
export function decrypt(text: string, key: string = ENCRYPTION_KEY ?? ""): string {
  if (!key) {
    throw new Error("Missing environment variable: `ENCRYPTION_KEY`");
  }
  const [ivHex, encryptedHex, authTagHex] = text.split(":");
  if (!ivHex || !encryptedHex || !authTagHex) {
    throw new Error("Invalid or corrupted cipher format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const encryptedText = Buffer.from(encryptedHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    new Uint8Array(Buffer.from(key, "hex")),
    new Uint8Array(iv),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(new Uint8Array(authTag));

  let decrypted = decipher.update(
    new Uint8Array(encryptedText),
    undefined,
    "utf8",
  );
  decrypted += decipher.final("utf8");

  return decrypted.toString();
}
