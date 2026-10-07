/**
 * ACME (CHG-2026-132, ADR-0027): the EYEON kit's colours, as the console's
 * own tokens. A chart takes its tone through `currentColor`, so a token
 * change (light or dark, slice 0's palette) recolours it without a redraw.
 *
 * A chart uses the accent or the status tones, never both (prototype README
 * §6). Status colour always comes with a label or an icon, never alone.
 */
export type EyeonTone =
  | "accent"
  | "allow"
  | "redact"
  | "block"
  | "info"
  | "neutral";

export const EYEON_TONE_TEXT: Record<EyeonTone, string> = {
  accent: "text-primary-accent",
  allow: "text-dark-green",
  redact: "text-dark-yellow",
  block: "text-dark-red",
  info: "text-dark-blue",
  neutral: "text-muted-foreground",
};
