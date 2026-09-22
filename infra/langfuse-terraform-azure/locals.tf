locals {
  tag_name = lower(var.name) == "langfuse" ? "Langfuse" : "Langfuse ${var.name}"

  # Convert domain to globally unique name format, supporting only lowercase letters and numbers (e.g., company.com -> companycom)
  globally_unique_prefix = replace(lower(var.domain), ".", "")

  # ACME: see postgres.tf and var.legacy_postgres_database_resource_name.
  postgres_database_resource_name = coalesce(var.legacy_postgres_database_resource_name, var.postgres_database_name)
}
