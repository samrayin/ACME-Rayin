# CHG-2026-123 — the stub surface, from MIT call sites only

**Generated, not hand-written.** Regenerate with the command in §3 and diff it; if
this file and the repository disagree, the repository is right.

This is the brief for the clean-room author (ADR-0024 §6). It lists every
Enterprise module path that MIT code imports, the names it imports, and the call
sites that import them. **Everything here was read from MIT files.** No file
under `ee/`, `web/src/ee/` or `worker/src/ee/` was opened to produce it, so
reading this document does not disqualify an author under EE-15.

It says what must exist. It says nothing about what any of it does — that is the
author's job, from these call sites and from the compiler errors that appear once
the directories are absent.

## 1. Scope


| | |
|---|---|
| Production files importing Enterprise paths | **59** (web 53, worker 6) |
| Test files importing Enterprise paths | **23** |
| Distinct Enterprise module paths imported | **50** |

ADR-0024 records "58 import sites" from the 2026-09-25 study. The production
count above is 59, which agrees with it; the study did not count
the 23 test files separately, and those are the "27 or more tests"
the ADR lists as a cost.

## 2. Modules to stub


### `@/src/ee/features/ui-customization/useUiCustomization`

- **Names imported:** `useUiCustomization`
- **Production call sites (9):** `web/src/components/layouts/app-layout/hooks/useFilteredNavigation.ts:10`, `web/src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx:45`, `web/src/components/nav/topbar-brand.tsx:5`, `web/src/features/projects/components/HostNameProject.tsx:4`, `web/src/features/public-api/components/CreateLLMApiKeyDialog.tsx:13`, `web/src/features/public-api/components/CreateLLMApiKeyForm.tsx:38`, `web/src/features/public-api/components/UpdateLLMApiKeyDialog.tsx:9`, `web/src/features/public-api/hooks/useLangfuseEnvCode.ts:1`, `web/src/features/support-chat/IntroSection.tsx:17`

### `@/src/ee/features/admin-api/server/adminApiAuth`

- **Names imported:** `AdminApiAuthService`
- **Production call sites (8):** `web/src/pages/api/admin/api-keys/index.ts:10`, `web/src/pages/api/admin/bullmq/index.ts:18`, `web/src/pages/api/admin/ingestion-replay.ts:16`, `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/[apiKeyId].ts:3`, `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/index.ts:3`, `web/src/pages/api/admin/organizations/[organizationId]/index.ts:3`, `web/src/pages/api/admin/organizations/index.ts:3`, `web/src/server/api/trpc.ts:96`

### `@/src/ee/features/billing/components/SupportOrUpgradePage`

- **Names imported:** `SupportOrUpgradePage`
- **Production call sites (7):** `web/src/features/annotation-queues/components/AnnotationQueuesItem.tsx:1`, `web/src/features/annotation-queues/pages/AnnotationQueueItems.tsx:10`, `web/src/features/annotation-queues/pages/AnnotationQueues.tsx:4`, `web/src/features/evals/pages/default-evaluation-model.tsx:4`, `web/src/features/evals/pages/evaluators.tsx:13`, `web/src/features/evals/v2/pages/RulesPage.tsx:6`, `web/src/features/monitors/components/MonitorPagePermissions.tsx:4`

### `@/src/ee/features/sfdc-sync/server`

- **Names imported:** `getSfdcService`
- **Production call sites (7):** `web/src/features/auth/lib/createProjectMembershipsOnSignup.ts:10`, `web/src/features/organizations/server/organizationRouter.ts:24`, `web/src/features/rbac/lib/upstreamRole.ts:11`, `web/src/features/rbac/server/membersRouter.ts:26`, `web/src/pages/api/public/scim/Users/[id].ts:7`, `web/src/pages/api/public/scim/Users/index.ts:9`, `web/src/server/api/routers/userAccount.ts:12`
- **Test call sites (1):** `web/src/__tests__/server/unit/sfdc-sync.servertest.ts:123`

### `@/src/ee/features/multi-tenant-sso/utils`

- **Names imported:** `getSsoAuthProviderIdForDomain`, `isAnySsoConfigured`
- **Production call sites (4):** `web/src/features/auth-credentials/server/signupApiHandler.ts:6`, `web/src/features/auth/server/getSignInPageServerSideProps.ts:3`, `web/src/pages/api/auth/check-sso.ts:7`, `web/src/server/auth.ts:59`

### `@/src/ee/features/billing/utils/isCloudBilling`

- **Names imported:** `isCloudBillingEnabled`, `useIsCloudBillingAvailable`
- **Production call sites (3):** `web/src/features/organizations/server/organizationRouter.ts:21`, `web/src/features/payment-banner/PaymentBanner.tsx:4`, `web/src/pages/organization/[organizationId]/settings/index.tsx:20`
- **Test call sites (1):** `web/src/__tests__/organization-settings-pages.clienttest.tsx:7`

### `../ee/cloudUsageMetering/constants`

- **Names imported:** `CloudUsageMeteringDbCronJobStates`, `cloudUsageMeteringDbCronJobName`
- **Production call sites (2):** `worker/src/queues/cloudUsageMeteringQueue.ts:10`, `worker/src/queues/cloudUsageMeteringQueue.ts:9`

### `@/src/ee/features/admin-api/server/organizations/apiKeys`

- **Names imported:** `handleGetApiKeys`, `handleGetOrganizationApiKeys`
- **Production call sites (2):** `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/index.ts:8`, `web/src/pages/api/public/organizations/apiKeys/index.ts:4`
- **Test call sites (1):** `web/src/__tests__/server/api-key-list-filter.servertest.ts:8`

### `../ee/cloudSpendAlerts/handleCloudSpendAlertJob`

- **Names imported:** `handleCloudSpendAlertJob`
- **Production call sites (1):** `worker/src/queues/cloudSpendAlertQueue.ts:3`

### `../ee/cloudUsageMetering/handleCloudUsageMeteringJob`

- **Names imported:** `handleCloudUsageMeteringJob`
- **Production call sites (1):** `worker/src/queues/cloudUsageMeteringQueue.ts:8`

### `../ee/dataRetention/handleDataRetentionProcessingJob`

- **Names imported:** `handleDataRetentionProcessingJob`
- **Production call sites (1):** `worker/src/queues/dataRetentionQueue.ts:8`
- **Test call sites (1):** `worker/src/__tests__/dataRetentionProcessing.test.ts:21`

### `../ee/dataRetention/handleDataRetentionSchedule`

- **Names imported:** `handleDataRetentionSchedule`
- **Production call sites (1):** `worker/src/queues/dataRetentionQueue.ts:7`

### `../ee/usageThresholds/handleCloudFreeTierUsageThresholdJob`

- **Names imported:** `handleCloudFreeTierUsageThresholdJob`
- **Production call sites (1):** `worker/src/queues/cloudFreeTierUsageThresholdQueue.ts:7`

### `./ee/meteringDataPostgresExport/handleMeteringDataPostgresExportJob`

- **Names imported:** `meteringDataPostgresExportProcessor`
- **Production call sites (1):** `worker/src/app.ts:84`

### `@/src/ee/features/admin-api/server/memberships`

- **Names imported:** `handleUpdateMembership`
- **Production call sites (1):** `web/src/pages/api/public/organizations/memberships/index.ts:8`
- **Test call sites (1):** `web/src/__tests__/server/unit/sfdc-sync.servertest.ts:127`

### `@/src/ee/features/admin-api/server/organizations`

- **Names imported:** _(default or namespace import)_
- **Production call sites (1):** `web/src/pages/api/admin/organizations/index.ts:7`

### `@/src/ee/features/admin-api/server/organizations/apiKeys/apiKeyById`

- **Names imported:** `handleDeleteApiKey`, `handleDeleteOrganizationApiKey`
- **Production call sites (1):** `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/[apiKeyId].ts:7`
- **Test call sites (1):** `web/src/__tests__/server/api-key-list-filter.servertest.ts:9`

### `@/src/ee/features/admin-api/server/organizations/organizationById`

- **Names imported:** `handleDeleteOrganization`
- **Production call sites (1):** `web/src/pages/api/admin/organizations/[organizationId]/index.ts:8`
- **Test call sites (1):** `web/src/__tests__/server/apiKeyCacheInvalidation.servertest.ts:31`

### `@/src/ee/features/admin-api/server/projects`

- **Names imported:** `handleGetProjects`
- **Production call sites (1):** `web/src/pages/api/public/organizations/projects/index.ts:4`

### `@/src/ee/features/admin-api/server/projects/createProject`

- **Names imported:** `handleCreateProject`
- **Production call sites (1):** `web/src/pages/api/public/projects/index.ts:4`

### `@/src/ee/features/admin-api/server/projects/projectById`

- **Names imported:** `handleDeleteProject`
- **Production call sites (1):** `web/src/pages/api/public/projects/[projectId]/index.ts:7`
- **Test call sites (1):** `web/src/__tests__/server/apiKeyCacheInvalidation.servertest.ts:30`

### `@/src/ee/features/admin-api/server/projects/projectById/apiKeys`

- **Names imported:** `handleGetApiKeys`, `handleGetProjectApiKeys`
- **Production call sites (1):** `web/src/pages/api/public/projects/[projectId]/apiKeys/index.ts:10`
- **Test call sites (1):** `web/src/__tests__/server/api-key-list-filter.servertest.ts:6`

### `@/src/ee/features/admin-api/server/projects/projectById/apiKeys/apiKeyById`

- **Names imported:** `handleDeleteApiKey`, `handleDeleteProjectApiKey`
- **Production call sites (1):** `web/src/pages/api/public/projects/[projectId]/apiKeys/[apiKeyId].ts:9`
- **Test call sites (1):** `web/src/__tests__/server/api-key-list-filter.servertest.ts:7`

### `@/src/ee/features/admin-api/server/projects/projectById/memberships`

- **Names imported:** _(default or namespace import)_
- **Production call sites (1):** `web/src/pages/api/public/projects/[projectId]/memberships/index.ts:9`

### `@/src/ee/features/audit-log-viewer/OrgAuditLogsSettingsPage`

- **Names imported:** `OrgAuditLogsSettingsPage`
- **Production call sites (1):** `web/src/pages/organization/[organizationId]/settings/index.tsx:22`

### `@/src/ee/features/billing/components/BillingSettings`

- **Names imported:** `BillingSettings`
- **Production call sites (1):** `web/src/pages/organization/[organizationId]/settings/index.tsx:12`

### `@/src/ee/features/billing/server/chb/chbMetricsApiHandler`

- **Names imported:** `chbMetricsApiHandler`
- **Production call sites (1):** `web/src/app/api/billing/metrics/route.ts:1`
- **Test call sites (1):** `web/src/__tests__/server/unit/chb-metrics-api-handler.servertest.ts:37`

### `@/src/ee/features/billing/server/chb/chbProjectEvents`

- **Names imported:** `emitChbProjectEvent`
- **Production call sites (1):** `web/src/features/projects/server/projectsRouter.ts:27`
- **Test call sites (1):** `web/src/__tests__/server/unit/chb-project-events.servertest.ts:60`

### `@/src/ee/features/billing/server/chb/chbWebhookHandler`

- **Names imported:** `chbWebhookHandler`
- **Production call sites (1):** `web/src/app/api/billing/clickhouse-webhook/route.ts:1`
- **Test call sites (1):** `web/src/__tests__/server/unit/chbWebhookHandler.servertest.ts:66`

### `@/src/ee/features/billing/server/cloudBillingRouter`

- **Names imported:** `cloudBillingRouter`
- **Production call sites (1):** `web/src/server/api/root.ts:14`
- **Test call sites (1):** `web/src/__tests__/server/unit/cloudBillingRouter.servertest.ts:32`

### `@/src/ee/features/billing/server/resolveBillingService`

- **Names imported:** `resolveBillingService`
- **Production call sites (1):** `web/src/features/organizations/server/organizationRouter.ts:20`
- **Test call sites (1):** `web/src/__tests__/server/unit/resolveBillingService.servertest.ts:22`

### `@/src/ee/features/billing/server/spendAlertRouter`

- **Names imported:** `spendAlertRouter`
- **Production call sites (1):** `web/src/server/api/root.ts:15`

### `@/src/ee/features/billing/server/stripe/stripeWebhookHandler`

- **Names imported:** `createDefaultSpendAlerts`, `handleSubscriptionChanged`, `stripeWebhookHandler`
- **Production call sites (1):** `web/src/app/api/billing/stripe-webhook/route.ts:1`
- **Test call sites (2):** `web/src/__tests__/server/createDefaultSpendAlerts.servertest.ts:3`, `web/src/__tests__/server/stripe-webhook-handler.servertest.ts:6`

### `@/src/ee/features/billing/utils/stripeCatalogue`

- **Names imported:** `mapStripeProductIdToPlan`, `stripeProducts`
- **Production call sites (1):** `web/src/features/entitlements/server/getPlan.ts:1`
- **Test call sites (2):** `web/src/__tests__/server/createDefaultSpendAlerts.servertest.ts:4`, `web/src/__tests__/server/unit/chbCatalogue.servertest.ts:8`

### `@/src/ee/features/multi-tenant-sso/createNewSsoConfigHandler`

- **Names imported:** `createNewSsoConfigHandler`
- **Production call sites (1):** `web/src/pages/api/auth/add-sso-config.ts:7`

### `@/src/ee/features/multi-tenant-sso/server/ssoConfigRouter`

- **Names imported:** `ssoConfigRouter`
- **Production call sites (1):** `web/src/server/api/root.ts:31`

### `@/src/ee/features/sso-settings/components/SSOSettings`

- **Names imported:** `SSOSettings`
- **Production call sites (1):** `web/src/pages/organization/[organizationId]/settings/index.tsx:15`

### `@/src/ee/features/ui-customization/instanceLinks`

- **Names imported:** `findCurrentInstance`
- **Production call sites (1):** `web/src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx:46`
- **Test call sites (1):** `web/src/__tests__/server/unit/instanceLinks.servertest.ts:6`

### `@/src/ee/features/ui-customization/productModuleSchema`

- **Names imported:** `ProductModule`
- **Production call sites (1):** `web/src/components/layouts/routes.tsx:43`

### `@/src/ee/features/ui-customization/uiCustomizationRouter`

- **Names imported:** `uiCustomizationRouter`
- **Production call sites (1):** `web/src/server/api/root.ts:37`

### `@/src/ee/features/verified-domains/server/verifiedDomainRouter`

- **Names imported:** `verifiedDomainRouter`
- **Production call sites (1):** `web/src/server/api/root.ts:30`

### `@langfuse/shared/src/server/ee/ingestionMasking`

- **Names imported:** _(default or namespace import)_
- **Production call sites (1):** `worker/src/queues/otelIngestionQueue.ts:32`
- **Test call sites (1):** `worker/src/__tests__/ingestionMasking.test.ts:16`

### `../ee/usageThresholds/bulkUpdates`

- **Names imported:** `bulkUpdateOrganizations`
- **Production call sites (0):** _none — test-only_
- **Test call sites (1):** `worker/src/__tests__/usageThresholdCacheInvalidation.test.ts:11`

### `../ee/usageThresholds/thresholdProcessing`

- **Names imported:** `processThresholds`
- **Production call sites (0):** _none — test-only_
- **Test call sites (2):** `worker/src/__tests__/thresholdProcessing.test.ts:24`, `worker/src/__tests__/usageThresholdCacheInvalidation.test.ts:10`

### `../ee/usageThresholds/usageAggregation`

- **Names imported:** _(default or namespace import)_
- **Production call sites (0):** _none — test-only_
- **Test call sites (1):** `worker/src/__tests__/usageAggregation.test.ts:32`

### `@/src/ee/features/billing/server/chb/chbAccessToken`

- **Names imported:** _(default or namespace import)_
- **Production call sites (0):** _none — test-only_
- **Test call sites (1):** `web/src/__tests__/server/unit/chbAccessToken.servertest.ts:16`

### `@/src/ee/features/billing/server/chb/chbApiClient`

- **Names imported:** _(default or namespace import)_
- **Production call sites (0):** _none — test-only_
- **Test call sites (3):** `web/src/__tests__/server/chbCheckoutClaim.servertest.ts:25`, `web/src/__tests__/server/unit/chbApiClient.servertest.ts:29`, `web/src/__tests__/server/unit/chbBillingService.servertest.ts:28`

### `@/src/ee/features/billing/server/chb/chbBillingService`

- **Names imported:** `ChbBillingService`
- **Production call sites (0):** _none — test-only_
- **Test call sites (3):** `web/src/__tests__/server/chbCheckoutClaim.servertest.ts:26`, `web/src/__tests__/server/unit/chbBillingService.servertest.ts:29`, `web/src/__tests__/server/unit/resolveBillingService.servertest.ts:23`

### `@/src/ee/features/billing/utils/chbCatalogue`

- **Names imported:** `mapChbPlanCodeToStripeProductId`
- **Production call sites (0):** _none — test-only_
- **Test call sites (3):** `web/src/__tests__/server/chbCheckoutClaim.servertest.ts:27`, `web/src/__tests__/server/unit/chbBillingService.servertest.ts:30`, `web/src/__tests__/server/unit/chbCatalogue.servertest.ts:7`

### `@/src/ee/features/verified-domains/server/dnsLookup`

- **Names imported:** `resolveTxtFresh`
- **Production call sites (0):** _none — test-only_
- **Test call sites (1):** `web/src/__tests__/server/verifiedDomainRouter.servertest.ts:3`

## 3. How this was produced

```
git grep -nE 'from ["'"'"'][^"'"'"']*(\.\./)*ee/|from ["'"'"']@/src/ee/' origin/main --   web/src worker/src packages ':!web/src/ee' ':!worker/src/ee'
```

Imported names are parsed from the import statement's binding list, so a name
re-exported under an alias appears under the alias the MIT side uses. A module
listed with no names is imported for its side effects or as a namespace.

## 4. What this does not tell you

- What any stub must **do**. Most switch a feature off; the ADR names two that
  need real clean-room implementations.
- Whether a name is a type or a value. The compiler says so once the directories
  are gone, and that is the intended input.
- Anything about the Enterprise implementations. By construction.

