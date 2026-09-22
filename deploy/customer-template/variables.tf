# Every variable below is passed straight through to the reusable module
# (../../infra/langfuse-terraform-azure). Defaults mirror the module's own
# defaults, so a real customer's terraform.tfvars only needs to set the
# values that are actually different for them -- typically just the ones
# marked "no default, must be set" below, plus network ranges if this
# customer's network team has existing standards to match.

variable "azure_subscription_id" {
  description = "This customer's own Azure subscription ID. No default -- must be set per customer."
  type        = string
}

variable "domain" {
  description = "This customer's own domain for the deployment, e.g. langfuse.customer.com. No default -- must be set per customer."
  type        = string
}

variable "name" {
  description = "Name prefix for this customer's resources (also feeds Azure's globally-unique resource naming, so it doesn't need to be globally unique itself)."
  type        = string
  default     = "langfuse"
}

variable "location" {
  description = "Azure region to deploy this customer's resources in."
  type        = string
  default     = "westeurope"
}

variable "use_encryption_key" {
  type    = bool
  default = true
}

# Network ranges. Defaults match ACME's own deployment; override if this
# customer's network team has existing address-space standards to match, or
# if this customer's Azure environment already uses these ranges elsewhere.
variable "virtual_network_address_prefix" {
  type    = string
  default = "10.224.0.0/12"
}

variable "aks_subnet_address_prefix" {
  type    = string
  default = "10.224.0.0/16"
}

variable "app_gateway_subnet_address_prefix" {
  type    = string
  default = "10.225.0.0/16"
}

variable "db_subnet_address_prefix" {
  type    = string
  default = "10.226.0.0/24"
}

variable "redis_subnet_address_prefix" {
  type    = string
  default = "10.226.1.0/24"
}

variable "storage_subnet_address_prefix" {
  type    = string
  default = "10.226.2.0/24"
}

variable "aks_service_cidr" {
  type    = string
  default = "192.168.0.0/20"
}

variable "aks_dns_service_ip" {
  type    = string
  default = "192.168.0.10"
}

# Sizing. Defaults are the module's own (production-appropriate) defaults;
# a smaller/trial customer deployment might override these down.
variable "kubernetes_version" {
  type    = string
  default = "1.32"
}

variable "node_pool_vm_size" {
  type    = string
  default = "Standard_D8s_v6"
}

variable "node_pool_min_count" {
  type    = number
  default = 2
}

variable "node_pool_max_count" {
  type    = number
  default = 10
}

variable "postgres_instance_count" {
  type    = number
  default = 2
}

variable "postgres_ha_mode" {
  type    = string
  default = "SameZone"
}

variable "postgres_sku_name" {
  type    = string
  default = "GP_Standard_D2s_v3"
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}

# One name for the database Terraform creates AND the one the app connects to
# (the module passes it to the Helm chart too). Rarely worth changing.
variable "postgres_database_name" {
  type    = string
  default = "langfuse"
}

variable "redis_sku_name" {
  type    = string
  default = "Balanced_B3"
}

variable "redis_high_availability" {
  type    = bool
  default = true
}

variable "app_gateway_capacity" {
  type    = number
  default = 1
}

# HTTPS certificate. Default: a publicly trusted certificate the customer has
# imported into a Key Vault they control (one-time step, see README.md "TLS
# certificate") -- tls_key_vault_id and tls_certificate_name must then be set.
# "self_signed" is for throwaway test environments only: browsers and SDKs
# will not trust it.
variable "tls_certificate_mode" {
  type    = string
  default = "key_vault"

  validation {
    condition     = contains(["key_vault", "self_signed"], var.tls_certificate_mode)
    error_message = "tls_certificate_mode must be \"key_vault\" or \"self_signed\"."
  }
}

variable "tls_key_vault_id" {
  description = "Resource ID of the customer's Key Vault holding their certificate (RBAC permission model)."
  type        = string
  default     = null
}

variable "tls_certificate_name" {
  description = "Name of the certificate object in tls_key_vault_id; must cover var.domain."
  type        = string
  default     = null
}

# Anonymous usage statistics to Langfuse's own servers. Off by default --
# a customer deployment sends nothing to a third party unless this is set.
variable "telemetry_enabled" {
  type    = bool
  default = false
}

variable "use_ddos_protection" {
  type    = bool
  default = true
}

variable "langfuse_helm_chart_version" {
  type    = string
  default = "2.0.0"
}

# Images. Leave these unset (null) for the FIRST apply -- the customer's own
# container registry (created by create_container_registry in main.tf)
# doesn't have the RayIn images in it yet, so pointing here on a first apply
# would fail with ImagePullBackOff. Once the registry exists, mirror the
# RayIn images into it and set these to that registry's own login server --
# never to acmelangfuseacr.azurecr.io directly, which a customer's cluster
# has no access to. See README.md's "Registry strategy" section for the
# exact commands and full sequence.
variable "web_image_repository" {
  type    = string
  default = null
}

variable "web_image_tag" {
  type    = string
  default = null
}

variable "worker_image_repository" {
  type    = string
  default = null
}

variable "worker_image_tag" {
  type    = string
  default = null
}

# Anything beyond the Redis Cluster fix (which the module now applies to
# every deployment automatically -- see infra/langfuse-terraform-azure/langfuse.tf)
# that this specific customer's deployment needs, e.g. ANTHROPIC_API_KEY for
# the ACME AI chat widget.
variable "additional_env" {
  type = list(object({
    name  = string
    value = optional(string)
    valueFrom = optional(object({
      secretKeyRef = optional(object({
        name = string
        key  = string
      }))
      configMapKeyRef = optional(object({
        name = string
        key  = string
      }))
    }))
  }))
  default = []
}
