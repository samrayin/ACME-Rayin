/**
 * ACME addition (ADR-0010 §6, CHG-2026-056): what a console-added model may
 * point the gateway at.
 *
 * LiteLLM does not restrict `api_base`, so without this a console admin could
 * make the gateway call an internal address (cluster services, the Azure
 * metadata endpoint, the guardrails service). The owner chose the strict
 * form (ADR-0010 §12, decision 3). Every one of these must hold:
 *  - the provider is one of a fixed set (a provider like `ollama/` defaults to
 *    a localhost endpoint, so the provider itself is part of the control);
 *  - `api_base`, when given, is https, on the default port, with no
 *    credentials in the URL, not an IP literal;
 *  - its host is on the allowlist (CAIRO_LITELLM_MODEL_ENDPOINT_ALLOWLIST);
 *  - every address it resolves to is public.
 *
 * Limit, stated in ADR-0010 §6: this is a save-time check. DNS can change
 * after it. The durable control is an egress NetworkPolicy on the gateway
 * (a follow-up change).
 */
import { BlockList, isIP } from "net";
import { lookup } from "dns/promises";

/** Providers a console-added model may use. `azure` needs an api_base. */
const ALLOWED_PROVIDERS = [
  "anthropic",
  "openrouter",
  "groq",
  "gemini",
  "openai",
  "azure",
] as const;
export type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

/** Used when CAIRO_LITELLM_MODEL_ENDPOINT_ALLOWLIST is unset. */
export const DEFAULT_ENDPOINT_ALLOWLIST = [
  "api.anthropic.com",
  "openrouter.ai",
  "api.groq.com",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "*.openai.azure.com",
] as const;

export class EndpointRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointRejectedError";
  }
}

const MODEL_REST = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;

/** `openai/gpt-4o` -> { provider: "openai", rest: "gpt-4o" }, or throws. */
export function parseProviderModel(model: string): {
  provider: AllowedProvider;
  rest: string;
} {
  const slash = model.indexOf("/");
  if (slash <= 0) {
    throw new EndpointRejectedError(
      `The provider model must look like "<provider>/<model>", e.g. "openai/gpt-4o".`,
    );
  }
  const provider = model.slice(0, slash);
  const rest = model.slice(slash + 1);
  if (!(ALLOWED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new EndpointRejectedError(
      `Provider "${provider}" is not allowed. Allowed: ${ALLOWED_PROVIDERS.join(", ")}.`,
    );
  }
  if (!MODEL_REST.test(rest) || rest.includes("..")) {
    throw new EndpointRejectedError(
      "The model identifier has invalid characters.",
    );
  }
  return { provider: provider as AllowedProvider, rest };
}

/** Parses the env allowlist: comma-separated hosts or `*.suffix` patterns. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw || raw.trim() === "") return [...DEFAULT_ENDPOINT_ALLOWLIST];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function hostAllowed(
  host: string,
  allowlist: readonly string[],
): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowlist.some((entry) => {
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".openai.azure.com"
      return h.endsWith(suffix) && h.length > suffix.length;
    }
    return h === entry;
  });
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. the cloud metadata endpoint
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  // No ::ffff:0:0/96 rule: Node's BlockList applies IPv4-mapped rules to
  // plain IPv4 addresses too, so it would block every IPv4 address. Mapped
  // forms are refused outright in isBlockedAddress instead.
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True for any address a model endpoint must never resolve to. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return true; // never accept an IPv4-mapped form at all
    return blocked.check(address, "ipv6");
  }
  return true; // not an address: refuse rather than guess
}

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Validates an api_base and returns its normalised form. Throws
 * EndpointRejectedError with a reason the admin can act on.
 */
export async function validateApiBase(
  raw: string,
  options: { allowlist: readonly string[]; resolve?: Resolver },
): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new EndpointRejectedError("The endpoint is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new EndpointRejectedError("The endpoint must use https.");
  }
  if (url.username || url.password) {
    throw new EndpointRejectedError(
      "The endpoint must not contain credentials.",
    );
  }
  // No query string: providers take keys as query parameters (?key=), and
  // the endpoint is shown back to admins, so it must never carry one.
  if (url.search !== "") {
    throw new EndpointRejectedError(
      "The endpoint must not contain a query string.",
    );
  }
  if (url.port !== "") {
    throw new EndpointRejectedError(
      "The endpoint must use the default https port.",
    );
  }
  // WHATWG URL has already normalised decimal, octal and hex IPv4 forms to
  // dotted quads, and wraps IPv6 in brackets.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    throw new EndpointRejectedError(
      "The endpoint must be a host name, not an IP address.",
    );
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    !host.includes(".")
  ) {
    throw new EndpointRejectedError("The endpoint must be a public host name.");
  }
  if (/\.(local|internal|cluster\.local|svc)$/i.test(host)) {
    throw new EndpointRejectedError("The endpoint must be a public host name.");
  }
  if (!hostAllowed(host, options.allowlist)) {
    throw new EndpointRejectedError(
      `Host "${host}" is not on the endpoint allowlist. Allowed: ${options.allowlist.join(", ")}.`,
    );
  }
  let addresses: string[];
  try {
    addresses = await (options.resolve ?? systemResolver)(host);
  } catch {
    throw new EndpointRejectedError(`Host "${host}" could not be resolved.`);
  }
  if (addresses.length === 0) {
    throw new EndpointRejectedError(`Host "${host}" could not be resolved.`);
  }
  const bad = addresses.find((a) => isBlockedAddress(a));
  if (bad !== undefined) {
    throw new EndpointRejectedError(
      `Host "${host}" resolves to a private or reserved address.`,
    );
  }
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * A reference to a key already in the gateway Secret (ADR-0010 §4, Option A).
 * Only provider-key-shaped names: never the gateway's own secrets.
 */
export function validateCredentialReference(name: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,62}_API_KEY$/.test(name)) {
    throw new EndpointRejectedError(
      "A key reference must be an environment variable name ending in _API_KEY.",
    );
  }
  if (/^(LITELLM|CAIRO|RAYIN|DATABASE|REDIS|LANGFUSE)_/.test(name)) {
    throw new EndpointRejectedError("That variable is not a provider key.");
  }
  return name;
}
