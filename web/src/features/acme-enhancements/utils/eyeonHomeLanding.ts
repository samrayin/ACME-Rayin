/**
 * ACME (CHG-2026-136, ADR-0028): where the project home sends each role.
 *
 * - Security Analyst and Auditor cannot read the classic Home dashboard's
 *   trace data (ADR-0011), so they never see it: they go to the EYEON
 *   Guardrail decisions page while CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED
 *   is on, whatever EYEON Home's flag says, and otherwise to the Guardrails
 *   page, as before this change. Both roles share this path today
 *   (useLandsOnGuardrails), so the Auditor moves with the Security Analyst.
 * - Any other role that can open the overview (llmGateway:read or
 *   evidence:read) gets it as Home while CAIRO_EYEON_HOME_ENABLED and
 *   CAIRO_EYEON_OVERVIEW_ENABLED are both on.
 * - Everyone else, and everyone while the flag is off, keeps the classic
 *   Home.
 *
 * A flag that cannot be read counts as off, so a failure falls back to the
 * landing each role had before. Pure, tested without a browser.
 */

type ProjectHomeLanding =
  | { kind: "wait" }
  | { kind: "redirect"; href: string }
  | { kind: "eyeonHome" }
  | { kind: "classicHome" };

export function projectHomeLanding(p: {
  projectId: string | undefined;
  sessionLoading: boolean;
  /** Security Analyst or Auditor in this project (not an instance admin). */
  landsOnGuardrails: boolean;
  /** The Guardrail decisions page's flag; undefined while still asking. */
  guardrailDecisionsOn: boolean | undefined;
  /** May open the overview: llmGateway:read or evidence:read. */
  canOpenOverview: boolean;
  /** EYEON Home's flag, already combined with the overview's; undefined while still asking. */
  eyeonHomeOn: boolean | undefined;
}): ProjectHomeLanding {
  if (p.projectId === undefined || p.sessionLoading) return { kind: "wait" };
  const base = `/project/${p.projectId}/acme-enhancements`;
  if (p.landsOnGuardrails) {
    if (p.guardrailDecisionsOn === undefined) return { kind: "wait" };
    return {
      kind: "redirect",
      href: p.guardrailDecisionsOn
        ? `${base}/guardrail-decisions`
        : `${base}/guardrails`,
    };
  }
  if (!p.canOpenOverview) return { kind: "classicHome" };
  if (p.eyeonHomeOn === undefined) return { kind: "wait" };
  return { kind: p.eyeonHomeOn ? "eyeonHome" : "classicHome" };
}
