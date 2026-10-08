import { createTRPCRouter } from "@/src/server/api/trpc";
import { traceRouter } from "./routers/traces";
import { generationsRouter } from "./routers/generations";
import { eventsRouter } from "@/src/features/events/server/eventsRouter";
import { scoresRouter } from "./routers/scores";
import { scoreAnalyticsRouter } from "@/src/features/score-analytics/server/scoreAnalyticsRouter";
import { dashboardRouter } from "@/src/features/dashboard/server/dashboard-router";
import { projectsRouter } from "@/src/features/projects/server";
import { projectApiKeysRouter } from "@/src/features/public-api/server/projectApiKeyRouter";
import { membersRouter } from "@/src/features/rbac/server/membersRouter";
import { userRouter } from "@/src/server/api/routers/users";
import { userAccountRouter } from "@/src/server/api/routers/userAccount";
import { datasetRouter } from "@/src/features/datasets/server/dataset-router";
import { cloudBillingRouter } from "@/src/ee/features/billing/server/cloudBillingRouter";
import { spendAlertRouter } from "@/src/ee/features/billing/server/spendAlertRouter";
import { observationsRouter } from "@/src/server/api/routers/observations";
import { sessionRouter } from "@/src/server/api/routers/sessions";
import { promptRouter } from "@/src/features/prompts/server/routers/promptRouter";
import { modelRouter } from "@/src/server/api/routers/models";
import { evalRouter } from "@/src/features/evals/server/router";
import { evaluatorRouter } from "@/src/features/evals/v2/server/evaluators/evaluatorRouter";
import { posthogIntegrationRouter } from "@/src/features/posthog-integration/posthog-integration-router";
import { mixpanelIntegrationRouter } from "@/src/features/mixpanel-integration/mixpanel-integration-router";
import { blobStorageIntegrationRouter } from "@/src/features/blobstorage-integration/blobstorage-integration-router";
import { llmApiKeyRouter } from "@/src/features/llm-api-key/server/router";
import { llmSchemaRouter } from "@/src/features/llm-schemas/server/router";
import { llmToolRouter } from "@/src/features/llm-tools/server/router";
import { organizationsRouter } from "@/src/features/organizations/server/organizationRouter";
import { organizationApiKeysRouter } from "@/src/features/public-api/server/organizationApiKeyRouter";
import { verifiedDomainRouter } from "@/src/ee/features/verified-domains/server/verifiedDomainRouter";
import { ssoConfigRouter } from "@/src/ee/features/multi-tenant-sso/server/ssoConfigRouter";
import { scoreConfigsRouter } from "@/src/server/api/routers/scoreConfigs";
import { publicRouter } from "@/src/server/api/routers/public";
import { credentialsRouter } from "@/src/features/auth-credentials/server/credentialsRouter";
import { batchExportRouter } from "@/src/features/batch-exports/server/batchExport";
import { utilsRouter } from "@/src/server/api/routers/utilities";
import { uiCustomizationRouter } from "@/src/ee/features/ui-customization/uiCustomizationRouter";
import { commentsRouter } from "@/src/server/api/routers/comments";
import { commentReactionsRouter } from "@/src/server/api/routers/commentReactions";
import { queueRouter } from "@/src/features/annotation-queues/server/annotationQueuesRouter";
import { queueItemRouter } from "@/src/features/annotation-queues/server/annotationQueueItemsRouter";
import { experimentsRouter } from "@/src/features/experiments/server/router";
import { mediaRouter } from "@/src/server/api/routers/media";
import { backgroundMigrationsRouter } from "@/src/features/background-migrations/server/background-migrations-router";
import { auditLogsRouter } from "./routers/auditLogs";
import { acmeAuditLogsRouter } from "@/src/features/acme-enhancements/server/acmeAuditLogsRouter";
import { acmeChatRouter } from "@/src/features/acme-enhancements/server/acmeChatRouter";
import { acmeGuardrailsRouter } from "@/src/features/acme-enhancements/server/acmeGuardrailsRouter";
import { acmeApplicationsRouter } from "@/src/features/acme-enhancements/server/acmeApplicationsRouter";
import { acmeCustomerLogoRouter } from "@/src/features/acme-enhancements/server/acmeCustomerLogoRouter";
import { acmeLitellmRouter } from "@/src/features/acme-enhancements/server/litellm/acmeLitellmRouter";
import { acmePromptReviewRouter } from "@/src/features/acme-enhancements/server/acmePromptReviewRouter";
import { acmePromptApprovalRouter } from "@/src/features/acme-enhancements/server/acmePromptApprovalRouter";
import { acmeThemeRouter } from "@/src/features/acme-enhancements/server/acmeThemeRouter";
import { acmeProjectAccessRouter } from "@/src/features/acme-enhancements/server/acmeProjectAccessRouter";
import { eyeonOverviewRouter } from "@/src/features/acme-enhancements/server/eyeonOverviewRouter";
import { eyeonGuardrailDecisionsRouter } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisionsRouter";
import { eyeonEnforcementRouter } from "@/src/features/acme-enhancements/server/eyeonEnforcementRouter";
import { eyeonGatewayHealthRouter } from "@/src/features/acme-enhancements/server/eyeonGatewayHealthRouter";
import { eyeonSpendRouter } from "@/src/features/acme-enhancements/server/eyeonSpendRouter";
import { eyeonShellRouter } from "@/src/features/acme-enhancements/server/eyeonShellRouter";
import { tableRouter } from "@/src/features/table/server/tableRouter";
import { batchActionRouter } from "@/src/features/batch-actions/server/batchActionRouter";
import { cloudStatusRouter } from "@/src/features/cloud-status-notification/server/cloud-status-router";
import { dashboardWidgetRouter } from "./routers/dashboardWidgets";
import { TableViewPresetsRouter } from "@/src/server/api/routers/tableViewPresets";
import { automationsRouter } from "@/src/features/automations/server/router";
import { monitorsRouter } from "@/src/server/api/routers/monitors";
import { defaultEvalModelRouter } from "@/src/features/evals/server/defaultEvalModelRouter";
import { slackRouter } from "@/src/features/slack/server/router";
import { supportRouter } from "@/src/features/support-chat/trpc/supportRouter";
import { queueAssignmentRouter } from "@/src/features/annotation-queues/server/annotationQueueAssignmentsRouter";
import { surveysRouter } from "@/src/server/api/routers/surveys";
import { naturalLanguageFilterRouter } from "@/src/features/natural-language-filters/server/router";
import { searchBarRouter } from "@/src/features/search-bar/server/router";
import { notificationPreferencesRouter } from "@/src/server/api/routers/notificationPreferences";
import { onboardingRouter } from "@/src/features/onboarding/server/onboardingRouter";
import { webCalloutsRouter } from "@/src/features/web-callouts/server/router";
import { inAppAgentRouter } from "@/src/features/in-app-agent/server/router";
import { v4TransitionRouter } from "@/src/features/v4/server/v4TransitionRouter";
import { aiGatewayRouter } from "@/src/features/ai-gateway/server";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  annotationQueues: queueRouter,
  annotationQueueItems: queueItemRouter,
  annotationQueueAssignments: queueAssignmentRouter,
  batchExport: batchExportRouter,
  traces: traceRouter,
  sessions: sessionRouter,
  generations: generationsRouter,
  events: eventsRouter,
  scores: scoresRouter,
  scoreAnalytics: scoreAnalyticsRouter,
  scoreConfigs: scoreConfigsRouter,
  dashboard: dashboardRouter,
  organizations: organizationsRouter,
  organizationApiKeys: organizationApiKeysRouter,
  verifiedDomain: verifiedDomainRouter,
  ssoConfig: ssoConfigRouter,
  projects: projectsRouter,
  users: userRouter,
  userAccount: userAccountRouter,
  projectApiKeys: projectApiKeysRouter,
  members: membersRouter,
  datasets: datasetRouter,
  cloudBilling: cloudBillingRouter,
  spendAlerts: spendAlertRouter,
  observations: observationsRouter,
  prompts: promptRouter,
  models: modelRouter,
  evals: evalRouter,
  evalsV2: evaluatorRouter,
  defaultLlmModel: defaultEvalModelRouter,
  experiments: experimentsRouter,
  posthogIntegration: posthogIntegrationRouter,
  mixpanelIntegration: mixpanelIntegrationRouter,
  blobStorageIntegration: blobStorageIntegrationRouter,
  llmApiKey: llmApiKeyRouter,
  llmSchemas: llmSchemaRouter,
  llmTools: llmToolRouter,
  public: publicRouter,
  credentials: credentialsRouter,
  utilities: utilsRouter,
  uiCustomization: uiCustomizationRouter,
  comments: commentsRouter,
  commentReactions: commentReactionsRouter,
  media: mediaRouter,
  backgroundMigrations: backgroundMigrationsRouter,
  auditLogs: auditLogsRouter,
  acmeAuditLogs: acmeAuditLogsRouter,
  acmeChat: acmeChatRouter,
  acmeGuardrails: acmeGuardrailsRouter,
  acmeApplications: acmeApplicationsRouter,
  acmeLitellm: acmeLitellmRouter,
  acmePromptReview: acmePromptReviewRouter,
  acmePromptApproval: acmePromptApprovalRouter,
  acmeTheme: acmeThemeRouter,
  acmeCustomerLogo: acmeCustomerLogoRouter,
  acmeProjectAccess: acmeProjectAccessRouter,
  // ACME (CHG-2026-132, ADR-0027): the EYEON overview.
  eyeonOverview: eyeonOverviewRouter,
  // ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page.
  eyeonGuardrailDecisions: eyeonGuardrailDecisionsRouter,
  // ACME (CHG-2026-138, ADR-0027): the EYEON Enforcement and policy page.
  eyeonEnforcement: eyeonEnforcementRouter,
  // ACME (CHG-2026-139, ADR-0027): the EYEON Gateway health page.
  eyeonGatewayHealth: eyeonGatewayHealthRouter,
  // ACME (CHG-2026-143, ADR-0027): the EYEON Cost and usage (Spend) page.
  eyeonSpend: eyeonSpendRouter,
  // ACME (CHG-2026-135, ADR-0026 §12.2): the EYEON shell's switches.
  eyeonShell: eyeonShellRouter,
  table: tableRouter,
  batchAction: batchActionRouter,
  cloudStatus: cloudStatusRouter,
  dashboardWidgets: dashboardWidgetRouter,
  TableViewPresets: TableViewPresetsRouter,
  automations: automationsRouter,
  monitors: monitorsRouter,
  slack: slackRouter,
  supportRouter: supportRouter,
  surveys: surveysRouter,
  onboarding: onboardingRouter,
  naturalLanguageFilters: naturalLanguageFilterRouter,
  searchBar: searchBarRouter,
  notificationPreferences: notificationPreferencesRouter,
  webCallouts: webCalloutsRouter,
  inAppAgent: inAppAgentRouter,
  v4Transition: v4TransitionRouter,
  aiGateway: aiGatewayRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
