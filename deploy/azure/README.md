# ACME Langfuse — root deployment config

This is the **root** Terraform configuration for ACME's live Langfuse-on-Azure
environment (`rg-langfuse`, swedencentral). It calls the reusable module
vendored at [`../../infra/langfuse-terraform-azure`](../../infra/langfuse-terraform-azure)
with the values that match what's actually running.

Until 2026-09-10 this file only ever existed in Azure Cloud Shell's `$HOME`,
which lost its local storage twice in one session — taking this file and
Terraform's local state with it both times (the real Azure resources were
untouched; only Terraform's own memory of them was lost). It's committed here
now specifically so that can't happen again.

## One-time setup still required

State is remote (see `versions.tf`'s `backend "azurerm"` block — an Azure
Storage account in its own resource group, `rg-langfuse-tfstate`, with blob
versioning and 30-day soft delete), authenticated via Azure AD rather than a
storage account key. Each operator needs the **Storage Blob Data Contributor**
role on that storage account before `terraform init` will work:

```bash
az role assignment create \
  --assignee "<your-az-ad-object-id>" \
  --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/87f4e6be-6585-4a1a-93f3-1a896cf644b9/resourceGroups/rg-langfuse-tfstate/providers/Microsoft.Storage/storageAccounts/stacmelftfstate"
```

(Get your object ID with `az ad signed-in-user show --query id -o tsv`.)

## Status: state not yet reconciled

This config is **not yet safe to `apply`**. The remote backend is live and
empty — `terraform plan` right now will want to create all ~65 resources from
scratch, which would collide with the real, already-running environment.
Before any `apply`:

1. Run `terraform init` (safe — only connects to the backend, touches nothing)
2. Reconcile the live resources into this state via `import` blocks (in
   progress — see the "Outstanding" section of `ACME-CHANGELOG.md`)
3. Confirm `terraform plan` shows **zero** changes before trusting `apply`

## Deployment-specific values (private)

Some console settings name the environment or its people, so their values are
not kept in this public repository (CHG-2026-118). `variables.tf` declares
them; the dev values live in a private variables file in the operations
repository, `envs/dev/deploy-azure.tfvars`. Pass it to every plan:

```bash
terraform plan -var-file=<path to the operations repository>/envs/dev/deploy-azure.tfvars
```

| Variable | Console setting | Without the file |
|---|---|---|
| `guardrail_mode_max` | `CAIRO_GUARDRAIL_MODE_MAX`, the guardrail deployment ceiling | `record` |
| `sso_enforced_domains` | `AUTH_DOMAINS_WITH_SSO_ENFORCEMENT` | not set: no domain is SSO-only |
| `guardrail_admins` | `CAIRO_GUARDRAIL_ADMINS` | not set: nobody can change guardrail policy or mode |
| `gateway_traces_project_id` | `CAIRO_GATEWAY_TRACES_PROJECT_ID`, the project the gateway's traces go to (CHG-2026-126) | not set: the Applications detail screen shows each request's trace id without a link |

A plan without the file would therefore lower dev's ceiling to record, reopen
password sign-in for users, and leave no guardrail administrator. Account
linking (`AUTH_AZURE_AD_ALLOW_ACCOUNT_LINKING`) stays unset; there is no
variable for it.

To check that these values, and the gateway manifests, match the live
environment (read-only):

```bash
scripts/release/check-declared-settings.sh --web-env <ops>/envs/dev/web.env --tfvars <ops>/envs/dev/deploy-azure.tfvars
```

## Files

- `versions.tf` — provider requirements + the remote state backend
- `providers.tf` — azurerm/kubernetes/helm provider configuration
- `main.tf` — the actual `module "langfuse"` call, pinned to live values
- `variables.tf` — deployment-specific settings whose values come from the private variables file
