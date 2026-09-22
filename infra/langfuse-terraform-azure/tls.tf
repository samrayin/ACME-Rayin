# Make sure to use a historic globally unique name, since they key vault is created with soft deletion
resource "random_string" "key_vault_postfix" {
  length  = 4
  lower   = true
  numeric = false
  special = false
  upper   = false
}

resource "azurerm_key_vault" "this" {
  name                       = module.naming.key_vault.name_unique
  location                   = azurerm_resource_group.this.location
  resource_group_name        = azurerm_resource_group.this.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  purge_protection_enabled   = true
  soft_delete_retention_days = 7
  rbac_authorization_enabled = true
}

# Grant the Terraform deployer "Key Vault Certificates Officer" role for certificate management
resource "azurerm_role_assignment" "keyvault_certificates_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Certificates Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Role assignments are eventually consistent: the Key Vault data plane keeps
# rejecting requests for a while after an assignment is created, so creating the
# certificate right away fails with a 403. depends_on only orders the calls, it
# does not wait for the assignment to take effect.
resource "time_sleep" "key_vault_rbac_propagation" {
  create_duration = "60s"

  depends_on = [
    azurerm_role_assignment.keyvault_certificates_officer,
    azurerm_role_assignment.keyvault_secrets_user,
    azurerm_role_assignment.appgw_customer_certificate,
  ]
}

# Add Private Endpoint for Key Vault
resource "azurerm_private_endpoint" "key_vault" {
  name                = "${module.naming.private_endpoint.name}-keyvault"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = azurerm_subnet.aks.id

  private_service_connection {
    name                           = "${var.name}-keyvault"
    private_connection_resource_id = azurerm_key_vault.this.id
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }
}

resource "azurerm_private_dns_zone" "key_vault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.this.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "key_vault" {
  name                 = "${var.name}-keyvault"
  private_dns_zone_id  = azurerm_private_dns_zone.key_vault.id
  virtual_network_id   = azurerm_virtual_network.this.id
  registration_enabled = false
}

# Add A record for the key vault's private endpoint
resource "azurerm_private_dns_a_record" "key_vault" {
  name                = azurerm_key_vault.this.name
  private_dns_zone_id = azurerm_private_dns_zone.key_vault.id
  ttl                 = 300
  records             = [azurerm_private_endpoint.key_vault.private_service_connection[0].private_ip_address]
}

# ACME: the self-signed certificate is now an explicit opt-in for test
# environments only (tls_certificate_mode = "self_signed"). The default
# ("key_vault") uses a publicly trusted certificate the customer imports into
# their own Key Vault -- see ingress.tf and deploy/customer-template/README.md
# (TF-09 / N-27).
resource "azurerm_key_vault_certificate" "this" {
  count = var.tls_certificate_mode == "self_signed" ? 1 : 0

  name         = module.naming.key_vault_certificate.name
  key_vault_id = azurerm_key_vault.this.id

  certificate_policy {
    issuer_parameters {
      name = "Self"
    }

    key_properties {
      exportable = true
      key_size   = 2048
      key_type   = "RSA"
      reuse_key  = true
    }

    lifetime_action {
      action {
        action_type = "AutoRenew"
      }

      trigger {
        days_before_expiry = 30
      }
    }

    secret_properties {
      content_type = "application/x-pkcs12"
    }

    x509_certificate_properties {
      extended_key_usage = ["1.3.6.1.5.5.7.3.1"]

      key_usage = [
        "digitalSignature",
        "keyEncipherment"
      ]

      subject            = "CN=${var.domain}"
      validity_in_months = 12

      subject_alternative_names {
        dns_names = [var.domain]
      }
    }
  }

  depends_on = [
    time_sleep.key_vault_rbac_propagation,
    azurerm_dns_zone.this
  ]
}

# ACME: existing states (ACME dev) hold this certificate at the un-indexed
# address from before it became conditional. Move it rather than plan a
# destroy/create of the live certificate.
moved {
  from = azurerm_key_vault_certificate.this
  to   = azurerm_key_vault_certificate.this[0]
}

# ACME: tls_certificate_mode = "key_vault" -- the customer's own publicly
# trusted certificate, already imported into a Key Vault they control.
# Reading it here fails the plan early (with a clear "not found") if the
# one-time import step in deploy/customer-template/README.md was skipped,
# instead of failing later inside the Application Gateway create call.
data "azurerm_key_vault_certificate" "customer" {
  count = var.tls_certificate_mode == "key_vault" ? 1 : 0

  name         = var.tls_certificate_name
  key_vault_id = var.tls_key_vault_id

  lifecycle {
    precondition {
      condition     = var.tls_key_vault_id != null && var.tls_certificate_name != null
      error_message = "tls_certificate_mode = \"key_vault\" (the default) needs tls_key_vault_id and tls_certificate_name: the customer's publicly trusted certificate, imported into their own Key Vault. Use tls_certificate_mode = \"self_signed\" only for test environments."
    }
  }
}

locals {
  # Versionless, so the Application Gateway picks up a renewed certificate
  # version from Key Vault on its own (it polls every 4 hours).
  tls_key_vault_secret_id = (
    var.tls_certificate_mode == "key_vault"
    ? data.azurerm_key_vault_certificate.customer[0].versionless_secret_id
    : azurerm_key_vault_certificate.this[0].versionless_secret_id
  )
}
