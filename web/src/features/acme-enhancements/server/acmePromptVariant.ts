/**
 * ACME addition: A/B prompt testing & canary rollout for the ACME AI chat
 * widget (capability 2 of 5 in the GTM plan). Weighted-picks between a
 * "production" and an optional "canary" labeled Prompt, so a new system
 * prompt can be rolled out to a percentage of requests instead of
 * all-or-nothing -- and every resulting trace/generation carries which
 * variant served it (promptName/promptVersion), so the comparison side is
 * just the existing Custom Dashboards/Metrics API filtered by that tag. No
 * new comparison UI needed -- that's already-verified infra, not built here.
 *
 * Env-var-driven rather than a new DB table/UI: ACME_CHAT_PROMPT_LABEL
 * (default "chat-production"), ACME_CHAT_PROMPT_CANARY_LABEL (optional),
 * ACME_CHAT_PROMPT_CANARY_WEIGHT (0-1, default 0 -- canary off unless a
 * weight is explicitly set). Keeps this capability's footprint small: a
 * canary rollout percentage is an operational dial, not something that
 * needs its own schema.
 */
import { prisma } from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";

export type PromptVariant = {
  variant: "production" | "canary" | "fallback";
  label: string;
  promptName: string | null;
  promptVersion: number | null;
  text: string | null;
};

async function fetchTextPrompt(
  projectId: string,
  label: string,
): Promise<{ name: string; version: number; text: string } | null> {
  const row = await prisma.prompt.findFirst({
    where: { projectId, labels: { has: label }, type: "text" },
    select: { name: true, version: true, prompt: true },
  });
  if (!row || typeof row.prompt !== "string") return null;
  return { name: row.name, version: row.version, text: row.prompt };
}

/**
 * Picks which labeled prompt variant should serve this request. Falls back
 * to variant "fallback" (text: null) when neither label resolves to a text
 * prompt -- the caller is expected to use its own hardcoded default in that
 * case, so a deployment that hasn't configured either label yet behaves
 * exactly as it did before this feature existed.
 */
export async function pickChatPromptVariant(
  projectId: string,
): Promise<PromptVariant> {
  const productionLabel = env.ACME_CHAT_PROMPT_LABEL ?? "chat-production";
  const canaryLabel = env.ACME_CHAT_PROMPT_CANARY_LABEL;
  const canaryWeight = Math.min(
    Math.max(Number(env.ACME_CHAT_PROMPT_CANARY_WEIGHT ?? "0") || 0, 0),
    1,
  );

  const useCanary = Boolean(canaryLabel) && canaryWeight > 0 && Math.random() < canaryWeight;
  const label = useCanary ? canaryLabel! : productionLabel;
  const variant: PromptVariant["variant"] = useCanary ? "canary" : "production";

  const prompt = await fetchTextPrompt(projectId, label);

  // Canary label configured but not resolvable this request (deleted, wrong
  // type) -- fail back to production rather than to the hardcoded default,
  // so a bad canary config degrades to "as if canary were off," not to
  // losing the configured production prompt too.
  if (!prompt && useCanary) {
    const productionPrompt = await fetchTextPrompt(projectId, productionLabel);
    if (productionPrompt) {
      return {
        variant: "production",
        label: productionLabel,
        promptName: productionPrompt.name,
        promptVersion: productionPrompt.version,
        text: productionPrompt.text,
      };
    }
  }

  if (!prompt) {
    return { variant: "fallback", label, promptName: null, promptVersion: null, text: null };
  }

  return {
    variant,
    label,
    promptName: prompt.name,
    promptVersion: prompt.version,
    text: prompt.text,
  };
}
