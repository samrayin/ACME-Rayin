/**
 * ACME (CHG-2026-138, ADR-0027): the EYEON Enforcement and policy page's
 * wording.
 *
 * The mode is always named with its ceiling: "Enforce mode", "Record mode"
 * or "Not reported" (prototype README §10). A change of mode is told by
 * when, to what, who and why; who is worded as on the Guardrails page
 * (changedByText). A pod reports the settings version it applied, not a
 * mode, so its agreement is told in versions and counts, never by pod name;
 * a gateway replica reports its mode with each decision. Pure functions,
 * tested without a browser.
 */
import { type GatewayMode } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";

/** "Enforce mode", "Record mode", or "Not reported" for no mode. */
export function modeName(mode: GatewayMode | null): string {
  if (mode === "enforce") return "Enforce mode";
  if (mode === "record") return "Record mode";
  return "Not reported";
}

/** The page's one-line answer: is EYEON enforcing on gateway traffic. */
export function enforcementHeadline(mode: GatewayMode | null): string {
  if (mode === "enforce") return "EYEON is enforcing on gateway traffic.";
  if (mode === "record") return "EYEON is recording, not enforcing.";
  return "No guardrail settings are stored in EYEON yet.";
}

/** What the mode does to a flagged request, in one sentence. */
export function modeMeaning(mode: GatewayMode | null): string {
  if (mode === "enforce")
    return "A refused prompt stops the request, a withheld answer is not returned, and a redaction sends redacted text to the model.";
  if (mode === "record")
    return "Every check is recorded, and every request still reaches the model unchanged. Flagged requests read Would block or Would redact.";
  return "Treat every decision as not applied until a mode is stored.";
}

/** "Record to Enforce", or "Enforce, the first version stored". */
export function changeTitle(from: GatewayMode | null, to: GatewayMode): string {
  const toName = to === "enforce" ? "Enforce" : "Record";
  if (from === null) return `${toName}, the first version stored`;
  if (from === to) return `${toName}, switch-back time changed`;
  return `${from === "enforce" ? "Enforce" : "Record"} to ${toName}`;
}

/** A length in minutes: "5 minutes", "1 hour", "2 hours", "90 minutes". */
export function formatMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

type PodSummary = {
  reporting: number;
  onCurrent: number;
  stale: number;
  currentVersion: number | null;
  agree: boolean | null;
};

/** The pods' agreement in one line, in settings versions. */
export function podsHeadline(p: PodSummary): string {
  if (p.currentVersion === null) return "No settings are stored to apply.";
  if (p.reporting === 0) return "No guardrail pod reported recently.";
  const of = `${p.onCurrent.toLocaleString()} of ${p.reporting.toLocaleString()}`;
  return `${of} reporting ${p.reporting === 1 ? "pod" : "pods"} applied settings v${p.currentVersion}, the version in force.`;
}

/** The pods' agreement as a short status, for a chip or a tile. */
export function podsStatus(p: PodSummary): {
  text: string;
  tone: "good" | "bad" | "neutral";
} {
  if (p.agree === null) return { text: "Nothing to compare", tone: "neutral" };
  return p.agree
    ? { text: "Reporting pods agree", tone: "good" }
    : { text: "Pods disagree", tone: "bad" };
}

type GatewaySummary = {
  replicas: number;
  byMode: { enforce: number; record: number; notReported: number };
  sameMode: boolean | null;
  matchesServed: boolean | null;
  beforeLastChange: number;
};

/** The gateway replicas' reported modes in one line. */
export function gatewaysHeadline(
  g: GatewaySummary,
  served: GatewayMode | null,
): string {
  if (g.replicas === 0)
    return "No gateway replica reported a decision in this project in the last 24 hours.";
  const parts = [
    g.byMode.record > 0
      ? `${g.byMode.record.toLocaleString()} Record mode`
      : "",
    g.byMode.enforce > 0
      ? `${g.byMode.enforce.toLocaleString()} Enforce mode`
      : "",
    g.byMode.notReported > 0
      ? `${g.byMode.notReported.toLocaleString()} no mode`
      : "",
  ].filter((p) => p.length > 0);
  const lead = `${g.replicas.toLocaleString()} gateway ${g.replicas === 1 ? "replica" : "replicas"} reported with their latest decision: ${parts.join(", ")}.`;
  if (g.matchesServed === null)
    return `${lead} None decided since the last change of mode, so none is compared with ${modeName(served)}.`;
  return g.matchesServed
    ? `${lead} Those seen since the last change match ${modeName(served)}, the mode EYEON serves.`
    : `${lead} Some seen since the last change differ from ${modeName(served)}, the mode EYEON serves.`;
}

/** The gateway replicas' agreement as a short status. */
export function gatewaysStatus(g: GatewaySummary): {
  text: string;
  tone: "good" | "bad" | "neutral";
} {
  if (g.matchesServed === null)
    return { text: "Nothing to compare", tone: "neutral" };
  return g.matchesServed
    ? { text: "Match the mode served", tone: "good" }
    : { text: "Differ from the mode served", tone: "bad" };
}
