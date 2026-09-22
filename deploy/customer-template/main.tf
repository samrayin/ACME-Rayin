# Root deployment config template for a customer's own Langfuse-on-Azure
# environment. Structurally identical to ../azure/main.tf (ACME's own
# deployment), except every value here comes from a variable instead of
# being hardcoded -- see variables.tf and terraform.tfvars.example.
#
# This template itself contains no customer-specific values and is safe to
# keep in this repo. A real customer's filled-in terraform.tfvars and
# backend.hcl must never be committed here -- see README.md and this
# folder's .gitignore.

module "langfuse" {
  source = "../../infra/langfuse-terraform-azure"

  domain   = var.domain
  location = var.location
  name     = var.name

  use_encryption_key = var.use_encryption_key

  # Every customer gets their own registry in their own subscription -- see
  # README.md's "Registry strategy" section. Not exposed as a variable:
  # every RayIn customer deployment needs one, it's not an optional choice.
  create_container_registry = true

  virtual_network_address_prefix    = var.virtual_network_address_prefix
  aks_subnet_address_prefix         = var.aks_subnet_address_prefix
  app_gateway_subnet_address_prefix = var.app_gateway_subnet_address_prefix
  db_subnet_address_prefix          = var.db_subnet_address_prefix
  redis_subnet_address_prefix       = var.redis_subnet_address_prefix
  storage_subnet_address_prefix     = var.storage_subnet_address_prefix

  kubernetes_version  = var.kubernetes_version
  aks_service_cidr    = var.aks_service_cidr
  aks_dns_service_ip  = var.aks_dns_service_ip
  node_pool_vm_size   = var.node_pool_vm_size
  node_pool_min_count = var.node_pool_min_count
  node_pool_max_count = var.node_pool_max_count

  postgres_instance_count = var.postgres_instance_count
  postgres_ha_mode        = var.postgres_ha_mode
  postgres_sku_name       = var.postgres_sku_name
  postgres_storage_mb     = var.postgres_storage_mb
  postgres_database_name  = var.postgres_database_name

  redis_sku_name          = var.redis_sku_name
  redis_high_availability = var.redis_high_availability

  app_gateway_capacity = var.app_gateway_capacity

  # HTTPS certificate: the customer's own publicly trusted certificate from
  # their Key Vault by default -- see README.md "TLS certificate".
  tls_certificate_mode = var.tls_certificate_mode
  tls_key_vault_id     = var.tls_key_vault_id
  tls_certificate_name = var.tls_certificate_name

  # Third-party usage telemetry to Langfuse's servers: off unless opted in.
  telemetry_enabled   = var.telemetry_enabled
  use_ddos_protection = var.use_ddos_protection

  langfuse_helm_chart_version = var.langfuse_helm_chart_version

  web_image_repository    = var.web_image_repository
  web_image_tag           = var.web_image_tag
  worker_image_repository = var.worker_image_repository
  worker_image_tag        = var.worker_image_tag

  # The Redis Cluster fix is applied by the module itself to every
  # deployment automatically -- not needed here. Only customer-specific
  # extras (if any) go through this variable.
  additional_env = var.additional_env
}
