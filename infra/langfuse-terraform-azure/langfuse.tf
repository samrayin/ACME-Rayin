locals {
  langfuse_values = <<EOT
langfuse:
  image:
    tag: ${jsonencode(var.app_version)}
  # ACME: third-party usage telemetry off unless explicitly opted in. The
  # chart renders this as TELEMETRY_ENABLED for both web and worker
  # (TF-65 / N-32).
  features:
    telemetryEnabled: ${var.telemetry_enabled}
  salt:
    secretKeyRef:
      name: langfuse
      key: salt
  nextauth:
    url: "https://${var.domain}"
    secret:
      secretKeyRef:
        name: langfuse
        key: nextauth-secret
postgresql:
  deploy: false
  host: ${azurerm_private_endpoint.postgres.private_service_connection[0].private_ip_address}:5432
  auth:
    username: ${azurerm_postgresql_flexible_server.this.administrator_login}
    database: ${var.postgres_database_name}
    existingSecret: langfuse
    secretKeys:
      userPasswordKey: postgres-password
redis:
  deploy: false
  host: ${azurerm_managed_redis.this.hostname}
  port: ${azurerm_managed_redis.this.default_database[0].port}
  tls:
    enabled: true
  auth:
    existingSecret: langfuse
    existingSecretPasswordKey: redis-password
s3:
  deploy: false
  storageProvider: "azure"
  endpoint: https://${azurerm_storage_account.this.name}.blob.core.windows.net
  bucket: ${azurerm_storage_container.this.name}
  region: ${azurerm_storage_account.this.location}
  accessKeyId:
    value: ${azurerm_storage_account.this.name}
  secretAccessKey:
    secretKeyRef:
      name: ${kubernetes_secret.langfuse.metadata[0].name}
      key: storage-access-key
  forcePathStyle: false
  eventUpload:
    prefix: "events/"
  batchExport:
    prefix: "exports/"
  mediaUpload:
    prefix: "media/"
EOT

  # In-cluster ClickHouse: the Langfuse Helm chart v2 renders ClickHouseCluster
  # and KeeperCluster resources reconciled by the ClickHouse operator (see
  # clickhouse.tf).
  clickhouse_internal_values = !local.deploy_clickhouse ? "" : <<EOT
clickhouse:
  deploy: true
  auth:
    existingSecret: langfuse
    existingSecretKey: clickhouse-password
  cluster:
    replicas: ${var.clickhouse_replicas}
    storage:
      size: ${var.clickhouse_storage_size}
      className: ${var.clickhouse_storage_class}
    resources:
      requests:
        cpu: ${jsonencode(var.clickhouse_resources.cpu)}
        memory: ${jsonencode(var.clickhouse_resources.memory)}
      limits:
        cpu: ${jsonencode(var.clickhouse_resources.cpu)}
        memory: ${jsonencode(var.clickhouse_resources.memory)}
  keeper:
    replicas: ${var.clickhouse_keeper_replicas}
    storage:
      size: ${var.clickhouse_keeper_storage_size}
      className: ${var.clickhouse_storage_class}
EOT

  # External ClickHouse: skip the in-cluster deployment and point Langfuse at
  # the provided instance.
  clickhouse_external_values = local.deploy_clickhouse ? "" : <<EOT
clickhouse:
  deploy: false
  host: ${jsonencode(var.external_clickhouse.host)}
  httpPort: ${var.external_clickhouse.http_port}
  nativePort: ${var.external_clickhouse.native_port}
  database: ${jsonencode(var.external_clickhouse.database)}
  cluster:
    enabled: ${var.external_clickhouse.cluster_enabled}
  auth:
    username: ${jsonencode(var.external_clickhouse.username)}
    existingSecret: langfuse
    existingSecretKey: clickhouse-password
  migration:
    ssl: ${var.external_clickhouse.migration_ssl}
EOT

  clickhouse_values = local.deploy_clickhouse ? local.clickhouse_internal_values : local.clickhouse_external_values

  encryption_values = var.use_encryption_key == false ? "" : <<EOT
langfuse:
  encryptionKey:
    secretKeyRef:
      name: ${kubernetes_secret.langfuse.metadata[0].name}
      key: encryption-key
EOT
  # Azure Managed Redis's clustering_policy is hardcoded to "EnterpriseCluster"
  # (see redis.tf) for every deployment of this module: keys ARE hash-slot-
  # sharded, but the OSS `CLUSTER SLOTS` topology-discovery command ioredis's
  # native Cluster client needs is blocked on this policy ("ERR command is
  # not allowed"), so Langfuse's own REDIS_CLUSTER_ENABLED=true path can't be
  # used against it. Fix: stay on the simple single-node client
  # (REDIS_CLUSTER_ENABLED=false) and force every key onto one hash slot via
  # a hash-tag-wrapped REDIS_KEY_PREFIX. Applies to every deployment of this
  # module unconditionally -- not something a caller opts into via
  # var.additional_env, since every deployment hits the same clustering
  # policy. Placed first in the merged list below so a caller's own
  # var.additional_env can still add unrelated env vars via the same
  # mechanism without a second `additionalEnv:` values block silently
  # replacing this one (Helm merges values-file lists by replacement, not
  # by append).
  redis_cluster_env = [
    { name = "REDIS_CLUSTER_ENABLED", value = "false" },
    { name = "REDIS_KEY_PREFIX", value = "{langfuse}" },
  ]

  # Two separate loops (not concat(local.redis_cluster_env, var.additional_env))
  # deliberately: local.redis_cluster_env's plain {name, value} objects and
  # var.additional_env's {name, value=optional, valueFrom=optional} objects
  # are different HCL object types, and concat()-ing them does not reliably
  # widen the plain objects to have a null valueFrom attribute -- it fails
  # at plan time with "This object does not have an attribute named
  # valueFrom" (found live during ACME's Terraform state reconciliation,
  # 2026-09-11). Each loop below only ever touches attributes its own list's
  # element type actually has, so there's nothing to unify.
  additional_env_values = <<EOT
langfuse:
  additionalEnv:
%{for env in local.redis_cluster_env}
  - name: ${env.name}
    value: "${env.value}"
%{endfor}
%{for env in var.additional_env}
  - name: ${env.name}
%{if env.value != null}
    value: "${env.value}"
%{endif}
%{if env.valueFrom != null}
    valueFrom:
%{if env.valueFrom.secretKeyRef != null}
      secretKeyRef:
        name: ${env.valueFrom.secretKeyRef.name}
        key: ${env.valueFrom.secretKeyRef.key}
%{endif}
%{if env.valueFrom.configMapKeyRef != null}
      configMapKeyRef:
        name: ${env.valueFrom.configMapKeyRef.name}
        key: ${env.valueFrom.configMapKeyRef.key}
%{endif}
%{endif}
%{endfor}
EOT
  image_values          = (var.web_image_repository == null && var.web_image_tag == null && var.worker_image_repository == null && var.worker_image_tag == null) ? "" : <<EOT
langfuse:
%{if var.web_image_repository != null || var.web_image_tag != null}
  web:
    image:
%{if var.web_image_repository != null}
      repository: ${var.web_image_repository}
%{endif}
%{if var.web_image_tag != null}
      tag: ${var.web_image_tag}
%{endif}
%{endif}
%{if var.worker_image_repository != null || var.worker_image_tag != null}
  worker:
    image:
%{if var.worker_image_repository != null}
      repository: ${var.worker_image_repository}
%{endif}
%{if var.worker_image_tag != null}
      tag: ${var.worker_image_tag}
%{endif}
%{endif}
EOT
}

resource "kubernetes_namespace" "langfuse" {
  metadata {
    name = "langfuse"
  }
}

resource "random_bytes" "salt" {
  # Should be at least 256 bits (32 bytes): https://langfuse.com/self-hosting/configuration#core-infrastructure-settings ~> SALT
  length = 32
}

resource "random_bytes" "nextauth_secret" {
  # Should be at least 256 bits (32 bytes): https://langfuse.com/self-hosting/configuration#core-infrastructure-settings ~> NEXTAUTH_SECRET
  length = 32
}

resource "random_bytes" "encryption_key" {
  count = var.use_encryption_key ? 1 : 0
  # Must be exactly 256 bits (32 bytes): https://langfuse.com/self-hosting/configuration#core-infrastructure-settings ~> ENCRYPTION_KEY
  length = 32
}

resource "kubernetes_secret" "langfuse" {
  metadata {
    name      = "langfuse"
    namespace = kubernetes_namespace.langfuse.metadata[0].name
  }

  data = {
    "redis-password"      = azurerm_managed_redis.this.default_database[0].primary_access_key
    "postgres-password"   = azurerm_postgresql_flexible_server.this.administrator_password
    "storage-access-key"  = azurerm_storage_account.this.primary_access_key
    "salt"                = random_bytes.salt.base64
    "nextauth-secret"     = random_bytes.nextauth_secret.base64
    "clickhouse-password" = local.deploy_clickhouse ? random_password.clickhouse_password.result : var.external_clickhouse_password
    "encryption-key"      = var.use_encryption_key ? random_bytes.encryption_key[0].hex : ""
  }
}

resource "helm_release" "langfuse" {
  name       = "langfuse"
  repository = "https://langfuse.github.io/langfuse-k8s"
  version    = var.langfuse_helm_chart_version
  chart      = "langfuse"
  namespace  = kubernetes_namespace.langfuse.metadata[0].name

  values = [
    local.langfuse_values,
    local.clickhouse_values,
    local.ingress_values,
    local.encryption_values,
    local.additional_env_values,
    local.image_values
  ]

  depends_on = [
    kubernetes_secret.langfuse,
    helm_release.clickhouse_operator,
  ]

  lifecycle {
    precondition {
      condition     = var.external_clickhouse == null || var.external_clickhouse_password != ""
      error_message = "external_clickhouse_password must be set when external_clickhouse is configured."
    }
  }
}
