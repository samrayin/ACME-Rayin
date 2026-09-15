/**
 * ACME PREVIEW — a deliberately thin demo, not the production feature.
 *
 * Built to answer one question fast: "does pairing a declared Inherent Risk
 * classification with a measured Residual Assurance signal actually make
 * sense on one screen?" — before committing weeks to the real Asset
 * Inventory (schema, discovery, RBAC-scoped CRUD) and real Assurance
 * (evidence ledger, canary probes, gated scoring) features those two halves
 * eventually become. See the RAYIN Readiness Ledger for that full plan.
 *
 * `demoAssets` is a hardcoded array, not a database query — these are the
 * real IT Ops prompts seeded into this project earlier, with illustrative
 * risk classifications assigned by hand for demo purposes. No schema, no
 * migration, nothing persisted. This is the part that goes away entirely
 * once the real Asset Inventory ships.
 *
 * `liveAssurance` is NOT faked — it's a real server-side call to
 * rayin-guardrails' own GET /v1/config, the exact same call
 * acmeGuardrailsRouter.getConfig already makes. Assurance is shown at the
 * deployment level, not per-asset, because that's the honest truth of what
 * exists today — per-asset assurance is real future work (see the Ledger's
 * Risk/Assurance scoping doc), not something to fake here.
 */
import { z } from "zod";
import { createTRPCRouter, protectedProjectProcedure } from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { env } from "@/src/env.mjs";

type DataSensitivity = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL";
type BusinessCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type DecisionImpact = "ADVISORY" | "ASSISTED_DECISION";
type InherentRiskTier = "LOW" | "MEDIUM" | "HIGH";

type DemoAsset = {
  slug: string;
  name: string;
  description: string;
  dataSensitivity: DataSensitivity;
  businessCriticality: BusinessCriticality;
  decisionImpact: DecisionImpact;
  externalFacing: boolean;
};

// Illustrative classifications, assigned by hand -- not computed, not
// discovered. This is exactly the kind of manual input the real Asset
// Inventory's "register this AI asset" form would capture from an owner.
const DEMO_ASSETS: DemoAsset[] = [
  {
    slug: "itops/network-incident-triage",
    name: "Network incident triage",
    description: "Drafts an incident summary and suggested priority from raw alert text.",
    dataSensitivity: "INTERNAL",
    businessCriticality: "HIGH",
    decisionImpact: "ASSISTED_DECISION",
    externalFacing: false,
  },
  {
    slug: "itops/backup-dr-status-summary",
    name: "Backup / DR status summary",
    description: "Summarizes nightly backup job results for the ops on-call.",
    dataSensitivity: "INTERNAL",
    businessCriticality: "CRITICAL",
    decisionImpact: "ADVISORY",
    externalFacing: false,
  },
  {
    slug: "itops/change-request-risk-assessment",
    name: "Change request risk assessment",
    description: "Flags risk factors in a proposed infrastructure change before CAB review.",
    dataSensitivity: "CONFIDENTIAL",
    businessCriticality: "HIGH",
    decisionImpact: "ASSISTED_DECISION",
    externalFacing: false,
  },
  {
    slug: "itops/ticket-triage-and-priority",
    name: "Ticket triage and priority",
    description: "Suggests a priority label for an incoming support ticket.",
    dataSensitivity: "INTERNAL",
    businessCriticality: "MEDIUM",
    decisionImpact: "ASSISTED_DECISION",
    externalFacing: false,
  },
  {
    slug: "itops/root-cause-analysis-draft",
    name: "Root cause analysis draft",
    description: "Drafts a first-pass RCA from timeline and log excerpts.",
    dataSensitivity: "INTERNAL",
    businessCriticality: "MEDIUM",
    decisionImpact: "ADVISORY",
    externalFacing: false,
  },
  {
    slug: "itops/capacity-planning-summary",
    name: "Capacity planning summary",
    description: "Summarizes utilization trends for a monthly capacity review.",
    dataSensitivity: "INTERNAL",
    businessCriticality: "MEDIUM",
    decisionImpact: "ADVISORY",
    externalFacing: false,
  },
  {
    slug: "itops/maintenance-window-notice",
    name: "Maintenance window notice",
    description: "Drafts a customer-facing notice for a scheduled maintenance window.",
    dataSensitivity: "PUBLIC",
    businessCriticality: "LOW",
    decisionImpact: "ADVISORY",
    externalFacing: true,
  },
  {
    slug: "itops/network-config-change-summary",
    name: "Network config change summary",
    description: "Summarizes a proposed network config diff for reviewer sign-off.",
    dataSensitivity: "CONFIDENTIAL",
    businessCriticality: "HIGH",
    decisionImpact: "ASSISTED_DECISION",
    externalFacing: false,
  },
];

// Simple, transparent, qualitative -- deliberately not a fake precise
// number. The real Asset Inventory scoring formula (weighted points, hard
// floors, an override path) is real future work; collapsing four honest
// badges into one invented score here would be exactly the "false
// precision" failure the Risk/Assurance scoping doc warned against.
function inherentRiskTier(asset: DemoAsset): InherentRiskTier {
  const highSensitivity = asset.dataSensitivity === "CONFIDENTIAL";
  const highCriticality = asset.businessCriticality === "HIGH" || asset.businessCriticality === "CRITICAL";
  if ((highSensitivity && highCriticality) || (highSensitivity && asset.externalFacing)) return "HIGH";
  if (highSensitivity || highCriticality || asset.externalFacing) return "MEDIUM";
  return "LOW";
}

const ConfigResponseSchema = z.object({
  pii_entities: z.array(z.string()),
  jailbreak_enabled: z.boolean(),
  topical_enabled: z.boolean(),
  available_pii_entities: z.array(z.string()),
});

export const acmeAssuranceDemoRouter = createTRPCRouter({
  demoAssets: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      // Same read sensitivity as the real Guardrails/Audit Logs pages --
      // this reveals risk classifications, not just UI preferences.
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      return DEMO_ASSETS.map((asset) => ({
        ...asset,
        inherentRiskTier: inherentRiskTier(asset),
      }));
    }),

  liveAssurance: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "projectGuardrails:read",
      });

      if (!env.RAYIN_GUARDRAILS_URL || !env.RAYIN_GUARDRAILS_CONFIG_SECRET) {
        return { configured: false as const };
      }

      const res = await fetch(`${env.RAYIN_GUARDRAILS_URL}/v1/config`, {
        headers: { "X-Config-Secret": env.RAYIN_GUARDRAILS_CONFIG_SECRET },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`rayin-guardrails returned ${res.status} fetching /v1/config`);
      }

      const parsed = ConfigResponseSchema.parse(await res.json());
      return { configured: true as const, ...parsed, checkedAt: new Date().toISOString() };
    }),
});
