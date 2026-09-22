import { env } from "@/src/env.mjs";
import { isProductAnalyticsAvailable } from "@/src/features/posthog-analytics/productAnalyticsAvailability";
import { PostHog } from "posthog-node";

// ACME: no hard-coded fallback PostHog key/host. Upstream fell back to
// Langfuse's own EU PostHog project whenever NEXT_PUBLIC_POSTHOG_KEY was unset
// (unless TELEMETRY_ENABLED === "false"), so a self-hosted RayIn deployment
// sent usage data to a third party by default. Now an unset key or host means
// no client is constructed and every capture is a no-op. An operator who
// wants product analytics sets both variables explicitly. (TF-65 / N-32)
export class ServerPosthog {
  private posthog: PostHog | null;
  private optOut: Promise<void> | undefined;

  constructor() {
    const apiKey = env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = env.NEXT_PUBLIC_POSTHOG_HOST;

    if (apiKey && host) {
      this.posthog = new PostHog(apiKey, { host });
      if (process.env.NODE_ENV === "development") this.posthog.debug();
      // Unlike the browser SDK, posthog-node disable() is a local opt-out:
      // capture becomes a no-op and nothing is sent. HIPAA uses this instead
      // of skipping construction. The flag flips synchronously; the promise is
      // kept so the constructor does not float it.
      if (!isProductAnalyticsAvailable()) {
        this.optOut = this.posthog.disable();
      }
    } else {
      this.posthog = null;
    }
  }

  capture(...args: Parameters<PostHog["capture"]>) {
    this.posthog?.capture(...args);
  }

  async shutdown() {
    await this.optOut;
    await this.posthog?.shutdown();
  }

  async flush() {
    await this.posthog?.flush();
  }
}
