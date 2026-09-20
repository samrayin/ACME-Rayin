# Customer deployment template

This is a **template**, not a live deployment. It contains no real values —
copy the two `.example` files, fill them in for one specific customer, and
run Terraform from a copy of this folder (or this folder itself, with your
local copies of the filled-in files gitignored). It calls the same reusable
module as ACME's own deployment
([`../../infra/langfuse-terraform-azure`](../../infra/langfuse-terraform-azure))
with that customer's own values, producing a fully independent environment —
own network ranges, own resource names, own secrets, own Terraform state.
Nothing here can read, write, or collide with ACME's own environment or
another customer's.

## Branding — this deploys RayIn, ACME's product, not vanilla Langfuse

The ACME logo, the "RAYIN" wordmark, and the navy color scheme are not a
Terraform setting — they're compiled into the `langfuse-web` Docker image at
build time (`web/src/components/design-system/LangfuseLogo/LangfuseLogo.tsx`,
`web/src/components/nav/topbar-brand.tsx`, `web/src/styles/globals.css`).
Terraform has no branding variable and cannot inject branding at deploy
time. The **only** thing that determines whether a customer sees RayIn or
plain upstream Langfuse is which image this template's Helm release pulls —
set by `web_image_repository` / `web_image_tag` and
`worker_image_repository` / `worker_image_tag` in `variables.tf`.

Getting the branded image in front of a customer takes one extra step on
day one — see "Registry strategy for customer deployments" immediately
below for the exact sequence. **Do not shortcut that by leaving the image
variables unset past the first apply, and never point them at
`acmelangfuseacr.azurecr.io` directly** — that's ACME's own internal
registry and a customer's cluster has no access to it. Either mistake means
the customer ends up running plain upstream Langfuse with zero ACME/RayIn
branding.

## Registry strategy for customer deployments

`acmelangfuseacr` is ACME's own internal dev/build registry — customer AKS
clusters never get direct access to it. Instead, every customer deployment
gets its **own** Container Registry, created inside their own subscription
by this template (`create_container_registry = true` in `main.tf`, backed
by `infra/langfuse-terraform-azure/registry.tf`), and the RayIn images are
mirrored into it. This keeps every customer's registry access fully
contained to their own subscription — no cross-tenant grants into ACME's
registry, ever.

Because the customer's registry doesn't exist until after the first
`apply`, and the RayIn images aren't in it until you mirror them there,
onboarding a customer is a **three-step sequence**, not a single apply:

1. **First apply**, with `web_image_repository`/`web_image_tag`/
   `worker_image_repository`/`worker_image_tag` left unset (`null`, the
   default). This builds the customer's full environment, including their
   new (empty) registry. The Langfuse pods will come up briefly on plain
   upstream Langfuse (the chart's own default image) — expected, and fixed
   in the next steps, not a failure.

   ```bash
   terraform apply
   terraform output container_registry_login_server
   ```

2. **Mirror the branded images in**, run from a session that has pull
   access to ACME's own registry (e.g. your own Cloud Shell / az cli
   login — the same access already used to build these images in
   `acmelangfuseacr`):

   ```bash
   az acr import \
     --name <customer_acr_name_from_output_above> \
     --source acmelangfuseacr.azurecr.io/langfuse-web:acme-dev \
     --image langfuse-web:acme-dev
   az acr import \
     --name <customer_acr_name_from_output_above> \
     --source acmelangfuseacr.azurecr.io/langfuse-worker:acme-dev \
     --image langfuse-worker:acme-dev
   ```

3. **Point the template at the customer's own registry and re-apply.** In
   `terraform.tfvars`:

   ```hcl
   web_image_repository    = "<container_registry_login_server output>/langfuse-web"
   web_image_tag            = "acme-dev"
   worker_image_repository = "<container_registry_login_server output>/langfuse-worker"
   worker_image_tag         = "acme-dev"
   ```

   ```bash
   terraform apply
   ```

   The Helm release updates to pull from the customer's own registry, and
   the pods roll over to full RayIn branding.

Re-run step 2 (the two `az acr import` commands) whenever RayIn ships a new
version for this customer, then bump `web_image_tag`/`worker_image_tag` in
`terraform.tfvars` and re-apply — same pattern as any other image upgrade.

## TLS certificate — one-time customer step, before the first apply

The Application Gateway serves HTTPS with **the customer's own publicly
trusted certificate** (from their usual CA, covering `domain`), read from a
Key Vault the customer controls. The template no longer issues a
self-signed certificate by default: browsers, the Langfuse SDKs and most
corporate proxies reject one, and a BFSI/government security review will
flag it.

What Terraform does with it: reads the certificate from
`tls_key_vault_id` / `tls_certificate_name` (the plan fails early with
"not found" if this step was skipped), grants the gateway's user-assigned
identity **Key Vault Secrets User** on that vault (the RBAC role that gives
it secret *get*, which is how Application Gateway reads the PFX), and points
the gateway's listener at the certificate's **versionless** secret ID — so
when the customer renews it in Key Vault, the gateway picks up the new
version on its own (Application Gateway polls every 4 hours); no re-apply.

**Customer (or whoever holds the certificate) does this once:**

1. Have a Key Vault in the customer's subscription using the **Azure RBAC**
   permission model (not access policies). A dedicated one outside this
   deployment's resource group is best, so the certificate outlives any
   rebuild of the environment:

   ```bash
   az group create --name rg-customer-certs --location <region>
   az keyvault create --name <kv-name> --resource-group rg-customer-certs      --location <region> --enable-rbac-authorization true
   ```

2. Import the certificate — a PFX/PKCS#12 file with the full chain and the
   private key, subject or SAN covering `domain`. The person importing
   needs "Key Vault Certificates Officer" on the vault. The PFX password is
   typed at the prompt, never put in a file or in shell history:

   ```bash
   read -rs PFX_PASSWORD
   az keyvault certificate import --vault-name <kv-name>      --name <certificate-name> --file ./<customer-domain>.pfx      --password "$PFX_PASSWORD"
   unset PFX_PASSWORD
   ```

3. Give the identity that runs `terraform apply` permission on that vault:
   "Key Vault Certificate User" (to read the certificate at plan time) and
   the right to create a role assignment on it ("User Access Administrator"
   or "Role Based Access Control Administrator", scoped to the vault).

4. If the vault's firewall is enabled, allow trusted Microsoft services
   (`--bypass AzureServices`) — Application Gateway reads it as one — plus
   the network `terraform plan` runs from.

5. Put the vault's resource ID and the certificate name in
   `terraform.tfvars`:

   ```hcl
   tls_key_vault_id     = "/subscriptions/<sub>/resourceGroups/rg-customer-certs/providers/Microsoft.KeyVault/vaults/<kv-name>"
   tls_certificate_name = "<certificate-name>"
   ```

Point the customer's DNS (`domain`) at the gateway's public IP after the
first apply, as before.

**Test environments only:** `tls_certificate_mode = "self_signed"` restores
the old behavior (a self-signed certificate issued in the deployment's own
Key Vault, no customer step). Never use it for a customer-facing
environment.

**Not yet proven end to end:** this path is `terraform validate`-clean but
has not been applied against a real subscription yet — the first real
customer (or test) deployment is its first live run.

## Why each customer needs their own state storage

Terraform's "state" is its own record of what it built — and it contains
every secret the deployment generates (database password, encryption keys)
in plain text. Recommended setup: **a small dedicated storage account in the
customer's own Azure subscription**, so a security incident on ACME's side
can never expose a customer's secrets, and vice versa. This mirrors exactly
how ACME's own state is set up (`rg-langfuse-tfstate` / `stacmelftfstate`,
see `../azure/versions.tf` and `../azure/README.md`).

## One-time setup, per customer

1. **Create the customer's state storage** (run once, against the
   customer's own subscription):

   ```bash
   az account set --subscription "<customer-subscription-id>"
   az group create --name rg-langfuse-tfstate --location <region>
   az storage account create \
     --name "st<customername>tfstate" \
     --resource-group rg-langfuse-tfstate \
     --location <region> \
     --sku Standard_LRS \
     --min-tls-version TLS1_2
   az storage account blob-service-properties update \
     --account-name "st<customername>tfstate" \
     --enable-versioning true \
     --enable-delete-retention true --delete-retention-days 30
   az storage container create \
     --account-name "st<customername>tfstate" \
     --name tfstate \
     --auth-mode login
   ```

2. **Grant yourself access to it** (same pattern as ACME's own backend):

   ```bash
   az role assignment create \
     --assignee "$(az ad signed-in-user show --query id -o tsv)" \
     --role "Storage Blob Data Contributor" \
     --scope "/subscriptions/<customer-subscription-id>/resourceGroups/rg-langfuse-tfstate/providers/Microsoft.Storage/storageAccounts/st<customername>tfstate"
   ```

3. **Import the customer's TLS certificate into Key Vault** — see "TLS
   certificate" above. The first `plan` fails without it (unless this is a
   test environment using `tls_certificate_mode = "self_signed"`).

4. **Copy and fill in the two example files** (both gitignored — never
   commit your filled-in copies):

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   cp backend.hcl.example <customername>.backend.hcl
   # edit both with this customer's real values
   ```

5. **Initialize, plan, review, apply:**

   ```bash
   terraform init -backend-config=<customername>.backend.hcl
   terraform plan
   # read the plan carefully -- it should show only resources being
   # created (this is a brand new environment), nothing being destroyed
   terraform apply
   ```

## Files

- `versions.tf` — provider requirements + a deliberately **empty** backend
  block (Terraform can't put variables in a backend block — real values
  come from `-backend-config` at init time, per customer)
- `providers.tf` — azurerm/kubernetes/helm provider configuration
- `main.tf` — the `module "langfuse"` call, every value from a variable
- `variables.tf` — every input, each with the module's own sensible
  default so a customer's `terraform.tfvars` only needs to override what's
  actually different for them
- `terraform.tfvars.example` → copy to `terraform.tfvars` (gitignored)
- `backend.hcl.example` → copy to `<customer>.backend.hcl` (gitignored)
- [`../../infra/langfuse-terraform-azure/registry.tf`](../../infra/langfuse-terraform-azure/registry.tf) —
  the shared module's per-customer registry logic (`create_container_registry`,
  enabled by this template's `main.tf`) — see "Registry strategy" above

## Air-gapped / no-internet customer deployments

Everything in this deployment runs **inside the customer's own AKS cluster**
once it's up — Postgres, Redis, ClickHouse, and the Langfuse app itself all
have zero ongoing internet dependency after install. But getting there the
first time pulls several things from the public internet automatically,
none of which come from ACME's own private registry by default. For a truly
offline/air-gapped customer, all of the following need to be pre-mirrored
into a private registry the customer's network *can* reach, before the
first `terraform init`/`apply`:

1. **Terraform providers** (`terraform init`, before anything else runs) —
   `azurerm`, `kubernetes`, `helm`, `random`, `tls`, `time`, all from
   `registry.terraform.io/hashicorp/*` (exact versions/constraints in
   `versions.tf`).
2. **The `Azure/naming/azurerm` Terraform module** (also at `terraform init`) —
   from the public Terraform Registry, pinned to `0.4.2`
   (`../../infra/langfuse-terraform-azure/naming.tf`). Generates the
   randomized, collision-proof resource names every deployment uses.
3. **Three Helm charts** (`terraform apply`):
   - the Langfuse chart itself, from `https://langfuse.github.io/langfuse-k8s`
     (version set by `langfuse_helm_chart_version`)
   - `cert-manager`, from `https://charts.jetstack.io` (version set by
     `cert_manager_chart_version`) — issues internal certificates for the
     ClickHouse operator's webhooks
   - the ClickHouse Operator, from `oci://ghcr.io/clickhouse` (version set
     by `clickhouse_operator_chart_version`) — the tool that actually runs
     ClickHouse inside the cluster
4. **Every container image those three charts reference** — the ClickHouse
   database image itself, cert-manager's own running pods, the
   clickhouse-operator's own pod, plus the Langfuse web/worker images
   themselves (the RayIn images already live in the customer's own registry
   by the time step 3 of "Registry strategy" above is done — only the three
   items above and ClickHouse's own image still need a separate mirror for
   a genuinely air-gapped customer).

None of this is set up yet — Terraform and Helm both pull straight from the
public internet as of this template. Before handing this template to a
genuinely offline customer: mirror all of the above into a registry their
network can reach (Azure Container Registry supports `az acr import` for
container images and OCI Helm charts directly from a source registry; the
Terraform provider/module mirror needs a
[Terraform provider network mirror](https://developer.hashicorp.com/terraform/cli/config/config-file#provider-installation)
or a private Terraform Registry), then point `versions.tf`'s
`required_providers` and each `helm_release`'s `repository` at the mirrored
locations instead of the public ones.

## What's already handled for you

- **Resource naming never collides** between customers or with ACME's own
  deployment, even with the same `name` value — the module runs every
  resource name through `Azure/naming/azurerm`, which appends a random
  suffix.
- **Secrets are never copied between deployments.** The module generates a
  brand new random database password, NextAuth secret, and encryption key
  for every fresh deployment — there's nothing to remember to rotate or
  keep unique per customer.
- **Third-party telemetry is off.** The module sets
  `TELEMETRY_ENABLED=false` on web and worker (`telemetry_enabled`, default
  `false`), and the RayIn web image no longer falls back to Langfuse's own
  PostHog project when no PostHog key is configured.
- **One database name everywhere.** `postgres_database_name` (default
  `langfuse`) names both the database Terraform creates and the one the app
  connects to.
- **The Redis Cluster compatibility fix** ACME hit in production
  (`REDIS_CLUSTER_ENABLED=false` + a hash-tag key prefix) is built into the
  module itself and applies automatically — not something this template or
  a customer's `terraform.tfvars` needs to set.
