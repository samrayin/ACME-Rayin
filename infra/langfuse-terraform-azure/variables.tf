variable "name" {
  description = "Name prefix for resources"
  type        = string
  default     = "langfuse"
}

variable "domain" {
  description = "Domain name used for resource naming"
  type        = string
}

variable "location" {
  description = "Azure region to deploy resources"
  type        = string
  default     = "westeurope"
}

variable "virtual_network_address_prefix" {
  type        = string
  description = "VNET address prefix."
  default     = "10.224.0.0/12"
}

variable "aks_subnet_address_prefix" {
  description = "Subnet address prefix."
  type        = string
  default     = "10.224.0.0/16"
}

variable "app_gateway_subnet_address_prefix" {
  type        = string
  description = "Subnet address prefix."
  default     = "10.225.0.0/16"
}

variable "db_subnet_address_prefix" {
  description = "Subnet address prefix."
  type        = string
  default     = "10.226.0.0/24"
}

variable "redis_subnet_address_prefix" {
  description = "Subnet address prefix."
  type        = string
  default     = "10.226.1.0/24"
}

variable "storage_subnet_address_prefix" {
  description = "Subnet address prefix."
  type        = string
  default     = "10.226.2.0/24"
}

variable "kubernetes_version" {
  description = "Kubernetes version for AKS cluster"
  type        = string
  default     = "1.32"
}

variable "aks_service_cidr" {
  type        = string
  description = "The Network Range used by the Kubernetes service."
  default     = "192.168.0.0/20"
}

variable "aks_dns_service_ip" {
  type        = string
  description = "IP address within the Kubernetes service address range that will be used by cluster service discovery (kube-dns)."
  default     = "192.168.0.10"
}

variable "use_encryption_key" {
  description = "Whether or not to use an Encryption key for LLM API credential and integration credential store"
  type        = bool
  default     = true
}

variable "node_pool_vm_size" {
  description = "VM size for AKS node pool"
  type        = string
  default     = "Standard_D8s_v6"
}

variable "node_pool_min_count" {
  description = "Minimum number of nodes in the AKS node pool"
  type        = number
  default     = 2
}

variable "node_pool_max_count" {
  description = "Maximum number of nodes in the AKS node pool"
  type        = number
  default     = 10
}

variable "postgres_instance_count" {
  description = "Number of PostgreSQL instances to create"
  type        = number
  default     = 2 # Default to 2 instances for high availability
}

variable "postgres_ha_mode" {
  description = "HA Mode to use for Postgres. Ensure this is supported in your region https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/overview#azure-regions"
  type        = string
  default     = "SameZone"
}

variable "postgres_sku_name" {
  description = "SKU name for Azure Database for PostgreSQL"
  type        = string
  default     = "GP_Standard_D2s_v3"
}

variable "postgres_storage_mb" {
  description = "Maximum storage size in MB for PostgreSQL"
  type        = number
  default     = 32768
}

variable "redis_sku_name" {
  description = "SKU name for Azure Managed Redis. See https://learn.microsoft.com/en-us/azure/redis/overview#choosing-the-right-tier for options. Common values: Balanced_B0 (dev/test), Balanced_B1, Balanced_B3, Balanced_B5 (production)."
  type        = string
  default     = "Balanced_B3"

  validation {
    condition     = can(regex("^(Balanced_B[0-9]+|ComputeOptimized_X[0-9]+|FlashOptimized_A[0-9]+|MemoryOptimized_M[0-9]+)$", var.redis_sku_name))
    error_message = "redis_sku_name must be a valid Azure Managed Redis SKU (e.g., Balanced_B0, Balanced_B1, ComputeOptimized_X3, MemoryOptimized_M10)."
  }
}

variable "redis_high_availability" {
  description = "Enable high availability for Azure Managed Redis. Recommended for production workloads."
  type        = bool
  default     = true
}

variable "app_gateway_capacity" {
  description = "Capacity for the Application Gateway"
  type        = number
  default     = 1
}

variable "use_ddos_protection" {
  description = "Wheter or not to use a DDoS protection plan"
  type        = bool
  default     = true
}

variable "clickhouse_replicas" {
  description = "Number of ClickHouse replicas (single shard). The default of 3 provides a highly available setup. Only used when ClickHouse is deployed in-cluster."
  type        = number
  default     = 3

  validation {
    condition     = var.clickhouse_replicas >= 1
    error_message = "clickhouse_replicas must be at least 1."
  }
}

variable "clickhouse_keeper_replicas" {
  description = "Number of ClickHouse Keeper replicas. Must be 1, 3 or 5 to maintain quorum. Only used when ClickHouse is deployed in-cluster."
  type        = number
  default     = 3

  validation {
    condition     = contains([1, 3, 5], var.clickhouse_keeper_replicas)
    error_message = "clickhouse_keeper_replicas must be 1, 3 or 5."
  }
}

variable "clickhouse_storage_size" {
  description = "Size of the persistent volume of each ClickHouse replica"
  type        = string
  default     = "100Gi"
}

variable "clickhouse_keeper_storage_size" {
  description = "Size of the persistent volume of each ClickHouse Keeper replica"
  type        = string
  default     = "10Gi"
}

variable "clickhouse_storage_class" {
  description = "StorageClass used for the ClickHouse and ClickHouse Keeper volumes"
  type        = string
  default     = "managed-csi-premium"
}

variable "clickhouse_resources" {
  description = "Resource requests and limits for each ClickHouse replica"
  type = object({
    cpu    = optional(string, "2")
    memory = optional(string, "8Gi")
  })
  default = {}
}

variable "clickhouse_operator_chart_version" {
  description = "Version of the ClickHouse operator Helm chart (oci://ghcr.io/clickhouse/clickhouse-operator-helm). The default matches the version the Langfuse Helm chart is tested against."
  type        = string
  default     = "0.0.5"
}

variable "cert_manager_chart_version" {
  description = "Version of the cert-manager Helm chart. cert-manager issues the certificates for the ClickHouse operator admission webhooks."
  type        = string
  default     = "v1.20.2"
}

variable "external_clickhouse" {
  description = "Use an external ClickHouse deployment (e.g. ClickHouse Cloud) instead of deploying ClickHouse into the AKS cluster. Set external_clickhouse_password as well. Prefix the host with https:// to connect via HTTPS. The defaults match ClickHouse Cloud; set cluster_enabled = false for ClickHouse Cloud on Azure or single-node deployments."
  type = object({
    host            = string
    http_port       = optional(number, 8443)
    native_port     = optional(number, 9440)
    username        = optional(string, "default")
    database        = optional(string, "default")
    cluster_enabled = optional(bool, true)
    migration_ssl   = optional(bool, true)
  })
  default = null
}

variable "external_clickhouse_password" {
  description = "Password for the external ClickHouse user. Required when external_clickhouse is set."
  type        = string
  default     = ""
  sensitive   = true
}

variable "langfuse_helm_chart_version" {
  description = "Version of the Langfuse Helm chart to deploy"
  type        = string
  default     = "2.0.0"
}

variable "app_version" {
  description = "Langfuse application version (Docker image tag) to deploy, e.g. \"4.14.0\". Defaults to the latest Langfuse release at the time this module version was published. See https://github.com/langfuse/langfuse/releases."
  type        = string
  default     = "4.14.0"
}

variable "web_image_repository" {
  description = "Custom container image repository for the Langfuse web component. Leave null to use the chart's default (upstream Langfuse) image."
  type        = string
  default     = null
}

variable "web_image_tag" {
  description = "Custom container image tag for the Langfuse web component. Leave null to use the chart's default tag (or var.app_version, which only maps to langfuse.image.tag, not web.image.tag specifically)."
  type        = string
  default     = null
}

variable "worker_image_repository" {
  description = "Custom container image repository for the Langfuse worker component. Leave null to use the chart's default (upstream Langfuse) image."
  type        = string
  default     = null
}

variable "worker_image_tag" {
  description = "Custom container image tag for the Langfuse worker component. Leave null to use the chart's default tag."
  type        = string
  default     = null
}

variable "additional_env" {
  description = "Additional environment variables to pass to the Langfuse deployment"
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

  validation {
    condition = alltrue([
      for env in var.additional_env : (env.value != null) != (env.valueFrom != null)
    ])
    error_message = "Each environment variable must have either 'value' or 'valueFrom' specified, but not both."
  }
}

# --- ACME additions (TF-07 / N-26, TF-09 / N-27, TF-65 / N-32) ---

variable "postgres_database_name" {
  description = "Name of the Postgres database Langfuse uses. The same value names the azurerm_postgresql_flexible_server_database resource and is passed to the Helm chart (postgresql.auth.database -> DATABASE_NAME for web and worker), so the app always connects to the database this module created."
  type        = string
  default     = "langfuse"

  validation {
    # Unquoted in the Helm values YAML (langfuse.tf), so keep it a plain
    # Postgres identifier that YAML cannot read as a bool/null/number.
    condition     = can(regex("^[a-z_][a-z0-9_-]{0,62}$", var.postgres_database_name)) && !contains(["y", "n", "yes", "no", "on", "off", "true", "false", "null"], var.postgres_database_name)
    error_message = "postgres_database_name must start with a lowercase letter or underscore, contain only lowercase letters, digits, '_' or '-', be at most 63 characters, and not be a YAML keyword (yes/no/on/off/true/false/null)."
  }
}

variable "legacy_postgres_database_resource_name" {
  description = "Do NOT set for new deployments. Only for a state that already manages a database under a different name than postgres_database_name (ACME dev: the naming-module-generated \"psqldb-langfuse\", while the app has always used \"langfuse\"). When set, the Terraform-managed database resource keeps this name so the existing state does not plan a replacement; the app still connects to postgres_database_name, which must then already exist on the server."
  type        = string
  default     = null
}

variable "tls_certificate_mode" {
  description = "How the Application Gateway gets its HTTPS certificate. \"key_vault\" (default): a publicly trusted certificate the customer has imported into their own Key Vault (tls_key_vault_id + tls_certificate_name); the gateway's user-assigned identity is granted \"Key Vault Secrets User\" on that vault. \"self_signed\": the module issues a self-signed certificate in its own Key Vault -- browsers and SDKs will not trust it, so use it for test environments only."
  type        = string
  default     = "key_vault"

  validation {
    condition     = contains(["key_vault", "self_signed"], var.tls_certificate_mode)
    error_message = "tls_certificate_mode must be \"key_vault\" or \"self_signed\"."
  }
}

variable "tls_key_vault_id" {
  description = "Resource ID of the Key Vault holding the customer's certificate (tls_certificate_mode = \"key_vault\"). The vault must use the Azure RBAC permission model. Example: /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<name>."
  type        = string
  default     = null
}

variable "tls_certificate_name" {
  description = "Name of the certificate object inside tls_key_vault_id (tls_certificate_mode = \"key_vault\"). Its subject or SANs must cover var.domain."
  type        = string
  default     = null
}

variable "telemetry_enabled" {
  description = "Whether Langfuse reports anonymous usage statistics to Langfuse's own servers (TELEMETRY_ENABLED on web and worker). Off by default: a customer deployment sends nothing to a third party unless this is explicitly set to true."
  type        = bool
  default     = false
}
