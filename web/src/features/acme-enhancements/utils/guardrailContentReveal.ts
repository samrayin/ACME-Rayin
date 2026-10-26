/**
 * ACME (blocked-prompt review, piece 2): the parts of reading blocked
 * content that the browser and the server share: the purposes a reader picks
 * from, the reason schema, and how control characters are made visible.
 * Safe in the browser; the decryption and the checks are in
 * server/acmeGuardrailContentReveal.ts.
 */
import { z } from "zod";

/** Why the reader needs it: a fixed purpose and a note. */
export const REVEAL_PURPOSES = [
  "false_positive_review",
  "incident_investigation",
  "audit_sample",
  "policy_tuning",
] as const;
export type RevealPurpose = (typeof REVEAL_PURPOSES)[number];

export const REVEAL_PURPOSE_LABELS: Record<RevealPurpose, string> = {
  false_positive_review: "Reviewing a reported false positive",
  incident_investigation: "Investigating a security incident",
  audit_sample: "Audit sample",
  policy_tuning: "Tuning the guardrail policy",
};

export const RevealReasonSchema = z.object({
  purpose: z.enum(REVEAL_PURPOSES),
  note: z
    .string()
    .trim()
    .min(20, "Add a note of at least 20 characters.")
    .max(500),
});

/**
 * Control and bidirectional-override characters made visible, so a pasted
 * or injected text cannot hide or reorder what a reviewer reads
 * (SF-2026-049). Line breaks and tabs are kept.
 */
export function visibleControls(text: string): string {
  return text.replace(
    // C0 and C1 controls except tab and newline, zero-width and bidi marks.
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g,
    (ch) =>
      `⟦U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`,
  );
}
