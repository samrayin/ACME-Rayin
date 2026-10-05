/**
 * ACME enhancement (CHG-2026-116): how the console names a guardrail decision.
 *
 * rayin-guardrails decides; the gateway applies the decision only in enforce
 * mode. In record mode a "block" verdict was recorded and the request went
 * through, so calling it "Blocked" misleads. Each event carries the mode the
 * calling gateway replica reported (`gateway_mode`, CHG-2026-089 part b), and
 * the label follows it: "Blocked" and "Redacted" only when the gateway was
 * enforcing, "Would block" and "Would redact" otherwise. An event with no
 * reported mode (a caller other than the gateway, or an event older than the
 * column) is treated as not enforced, because nothing says it was.
 */

export type GuardrailAction = "allow" | "redact" | "block" | "unavailable";
export type GatewayMode = "record" | "enforce";

/** The stored `gateway_mode` as a mode, or null when unreported or unknown. */
export function gatewayModeFromDb(
  value: string | null | undefined,
): GatewayMode | null {
  return value === "enforce" || value === "record" ? value : null;
}

export type VerdictBadgeVariant = "error" | "warning" | "secondary" | "success";

export function guardrailVerdictLabel(
  action: GuardrailAction,
  mode: GatewayMode | null,
): { label: string; variant: VerdictBadgeVariant } {
  const enforced = mode === "enforce";
  if (action === "block")
    return { label: enforced ? "Blocked" : "Would block", variant: "error" };
  if (action === "redact")
    return {
      label: enforced ? "Redacted" : "Would redact",
      variant: "warning",
    };
  // N-64: the judge model could not answer, so there is no verdict. In
  // enforce the gateway refuses such a request.
  if (action === "unavailable")
    return { label: "No verdict", variant: "secondary" };
  return { label: "Allowed", variant: "success" };
}

export function gatewayModeLabel(mode: GatewayMode | null): string {
  if (mode === "enforce") return "Enforce";
  if (mode === "record") return "Record";
  return "Not reported";
}
