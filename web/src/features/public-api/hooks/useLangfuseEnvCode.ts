import { useUiCustomization } from "@/src/ee/features/ui-customization/useUiCustomization";
import { env } from "@/src/env.mjs";

type LangfuseKeys = {
  secretKey: string;
  publicKey: string;
};

// ACME (CHG-2026-065): CAIRO label. The variable names stay LANGFUSE_*,
// because the Langfuse SDKs and OpenTelemetry exporters read exactly these.
const ENV_HEADER = "# ACME CAIRO";

function getLangfuseBaseUrl(baseUrl: string): string {
  return `${baseUrl}${env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
}

export function getLangfuseEnvCode(
  baseUrl: string,
  keys?: LangfuseKeys,
): string {
  if (keys) {
    return `
${ENV_HEADER}
LANGFUSE_SECRET_KEY="${keys.secretKey}"
LANGFUSE_PUBLIC_KEY="${keys.publicKey}"
LANGFUSE_BASE_URL="${baseUrl}"
`.trim();
  }

  return `
${ENV_HEADER}
LANGFUSE_SECRET_KEY="sk-lf-..."
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_BASE_URL="${baseUrl}"
`.trim();
}

export function useLangfuseBaseUrl(): string {
  const uiCustomization = useUiCustomization();

  return getLangfuseBaseUrl(uiCustomization?.hostname ?? window.origin);
}

export function useLangfuseEnvCode(keys?: {
  secretKey: string;
  publicKey: string;
}): string {
  const baseUrl = useLangfuseBaseUrl();

  return getLangfuseEnvCode(baseUrl, keys);
}
