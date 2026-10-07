/**
 * ACME (CHG-2026-125, ADR-0023 §3.5): the guardrail log's exact agent filter
 * as a link. An application's detail screen links to its guardrail
 * decisions with `?agents=<alias>,<alias>`: every key alias the application
 * has used, so a rotated key's earlier decisions show too. The logs page
 * reads the parameter back here and the history query matches the agent id
 * exactly (`agentId IN (...)`).
 *
 * No server imports: this runs in the browser, and the server's filter
 * schema takes its limits from here.
 */

/** The longest agent id the exact filter accepts. */
export const GUARDRAIL_AGENT_MAX_LENGTH = 200;

/** The most agent ids one exact filter accepts. */
export const GUARDRAIL_AGENTS_MAX = 20;

/** Key aliases never contain one; the gateway service builds them. */
const SEPARATOR = ",";

/**
 * `?agents=` as a list of agent ids: trimmed, empty and over-long ones
 * dropped (an exact match on a cut id would be wrong), duplicates removed,
 * at most GUARDRAIL_AGENTS_MAX. Anything but one string gives an empty list.
 */
export function parseAgentsParam(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const raw = value.slice(
    0,
    GUARDRAIL_AGENTS_MAX * (GUARDRAIL_AGENT_MAX_LENGTH + SEPARATOR.length),
  );
  const agents: string[] = [];
  for (const part of raw.split(SEPARATOR)) {
    const agent = part.trim();
    if (
      agent.length === 0 ||
      agent.length > GUARDRAIL_AGENT_MAX_LENGTH ||
      agents.includes(agent)
    )
      continue;
    agents.push(agent);
    if (agents.length === GUARDRAIL_AGENTS_MAX) break;
  }
  return agents;
}

/**
 * The aliases a link names, oldest first: all of them, or the newest
 * GUARDRAIL_AGENTS_MAX when there are more. `omitted` counts the rest, so
 * the link can say so.
 */
export function linkedAgents(aliases: string[]): {
  agents: string[];
  omitted: number;
} {
  const unique = [...new Set(aliases)];
  const agents = unique.slice(-GUARDRAIL_AGENTS_MAX);
  return { agents, omitted: unique.length - agents.length };
}

/** The `agents` parameter for a list of agent ids. */
export function formatAgentsParam(agents: string[]): string {
  return agents.join(SEPARATOR);
}
