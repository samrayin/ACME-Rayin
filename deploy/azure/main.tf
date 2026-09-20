# Root deployment config for ACME's Langfuse-on-Azure environment
# (rg-langfuse, swedencentral). Calls the ACME fork of the Langfuse Terraform
# module (../../infra/langfuse-terraform-azure) with the values that match
# the live environment.
#
# This file's only prior home was Azure Cloud Shell's $HOME, which lost its
# local storage twice in one session (2026-09-10) -- taking this file and
# Terraform's local state with it both times, while the real Azure resources
# were untouched. Committing it here, alongside the remote state backend in
# versions.tf, means neither can be lost to that again.
#
# State was NOT re-imported as of this commit -- `terraform plan` against
# this config will show it wanting to create everything from scratch until
# the ~65 live resources are reconciled into the new remote state via
# `import` blocks. Do not `apply` until that reconciliation is done and
# reviewed. See ACME-CHANGELOG.md for status.

module "langfuse" {
  source = "../../infra/langfuse-terraform-azure"

  domain   = "langfuse-dev.aiatacme.com"
  location = "swedencentral"
  name     = "langfuse"

  use_encryption_key = true

  virtual_network_address_prefix    = "10.224.0.0/12"
  aks_subnet_address_prefix         = "10.224.0.0/16"
  app_gateway_subnet_address_prefix = "10.225.0.0/16"
  db_subnet_address_prefix          = "10.226.0.0/24"
  redis_subnet_address_prefix       = "10.226.1.0/24"
  storage_subnet_address_prefix     = "10.226.2.0/24"

  kubernetes_version  = "1.32"
  aks_service_cidr    = "192.168.0.0/20"
  aks_dns_service_ip  = "192.168.0.10"
  node_pool_vm_size   = "Standard_D8s_v6"
  node_pool_min_count = 2
  node_pool_max_count = 10

  postgres_instance_count = 2
  postgres_ha_mode        = "SameZone"
  postgres_sku_name       = "GP_Standard_D2s_v3"
  postgres_storage_mb     = 32768

  # Pinned so the module's 2026-09-18 database-name fix (TF-07 / N-26) plans
  # NO change here. The app has always used the "langfuse" database (the Helm
  # value was hard-coded), while the Terraform-managed resource imported into
  # this state is the separate, naming-module-generated "psqldb-langfuse"
  # (see import-state.sh). Without the legacy override the module would plan
  # to replace that resource with one named "langfuse". Only for this
  # already-imported state -- new deployments never set it.
  postgres_database_name                 = "langfuse"
  legacy_postgres_database_resource_name = "psqldb-langfuse"

  redis_sku_name          = "Balanced_B3"
  redis_high_availability = true

  app_gateway_capacity = 1

  # The live dev gateway serves the module-issued self-signed certificate.
  # The module default became "key_vault" on 2026-09-18 (TF-09 / N-27); pin the
  # old behavior so this state keeps its certificate (a `moved` block in the
  # module carries it to its new address). Switching dev to a trusted
  # certificate is a separate, deliberate change.
  tls_certificate_mode = "self_signed"
  use_ddos_protection  = true

  langfuse_helm_chart_version = "2.0.0"

  # ACME's own images -- also the module's own defaults (see
  # infra/langfuse-terraform-azure/variables.tf), pinned explicitly here so
  # this file stays correct even if those defaults ever change upstream.
  web_image_repository    = "acmelangfuseacr.azurecr.io/langfuse-web"
  web_image_tag           = "acme-dev"
  worker_image_repository = "acmelangfuseacr.azurecr.io/langfuse-worker"
  worker_image_tag        = "acme-dev"

  # Redis Cluster compatibility fix (found 2026-09-10, during the v4.33.0
  # upgrade) is now built into the module itself (langfuse.tf) -- it applies
  # to every deployment unconditionally, since every deployment hits the
  # same Azure Managed Redis "EnterpriseCluster" clustering policy this fix
  # exists for. No longer needs to be set here.
}
