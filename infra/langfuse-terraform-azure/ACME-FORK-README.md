# ACME fork of `langfuse/langfuse-terraform-azure`

This directory is a patched copy of the upstream Terraform module
[`langfuse/langfuse-terraform-azure`](https://github.com/langfuse/langfuse-terraform-azure),
pinned at commit `e939144c0a70dcc3de32f321ace86d34ee0d80c9` — the **exact** commit
the live `main.tf` for `langfuse-dev.aiatacme.com` references (see
`Azure Blueprint/Azure.md` §2 in the companion infrastructure project).

**Correction, 2026-09-10:** an earlier version of this fork was built from tag
`0.4.5` instead. That was wrong — `0.4.5` is 10 commits *behind* the actual
pinned commit, and is missing variables the live config depends on
(`clickhouse_replicas`, `clickhouse_keeper_replicas`, `clickhouse_storage_size`,
`clickhouse_keeper_storage_size`, `redis_high_availability`, and others — this
module gained in-cluster ClickHouse support and switched from
`azurerm_redis_cache` to `azurerm_managed_redis` somewhere in those 10 commits).
The mistake surfaced immediately and loudly on `terraform init` (`Unsupported
argument` for every one of those). This fork was rebuilt from the verified
correct commit before anything was applied to the live cluster — verified via
`git describe --tags` against the actual pinned SHA, not assumed from the
nearest-looking tag.

## Why this fork exists

The underlying Langfuse Helm chart (deployed at version `2.0.2`) already supports
per-component container image overrides (`langfuse.web.image.repository`/`tag`,
`langfuse.worker.image.repository`/`tag` — nested under the top-level `langfuse:`
key, confirmed via `helm show values langfuse-charts/langfuse --version 2.0.2`
against the live deployment, not assumed) — verified directly against the chart's
`values.yaml` during the branding/deployment audit. The Terraform module itself
only exposes `app_version` (which maps to `langfuse.image.tag` — the top-level
default, not `web`/`worker` specifically) and has no `repository` override at
all. Without this fork, there is no way to point the Terraform-managed
deployment at a custom ACME image without hand-editing generated Helm values
outside Terraform's management — the same drift risk already documented for the
logo ConfigMap incident in `ACME-CHANGELOG.md`.

## What changed vs. the pinned upstream commit

- `variables.tf` — added four new optional variables, all defaulting to `null`
  (meaning: fall back to the chart's own default image, i.e. upstream Langfuse):
  - `web_image_repository`, `web_image_tag`
  - `worker_image_repository`, `worker_image_tag`
- `langfuse.tf` — added a new `local.image_values` Helm values block, populated
  only when at least one of the four variables above is set, and appended to
  `helm_release.langfuse`'s `values` list. Follows the exact same conditional
  heredoc pattern already used by this file's `encryption_values` and
  `additional_env_values` locals — no new pattern introduced.

No other files were touched. This is a minimal, additive patch: every existing
module consumer's behavior is unchanged unless they explicitly set one of the
new variables.

## Usage

```hcl
module "langfuse" {
  source = "git::https://github.com/samrayin/ACME-Rayin.git//infra/langfuse-terraform-azure?ref=main"

  # ... existing required variables (domain, etc.) ...

  web_image_repository    = "acmelangfuseacr.azurecr.io/langfuse-web"
  web_image_tag            = "acme-dev"
  worker_image_repository = "acmelangfuseacr.azurecr.io/langfuse-worker"
  worker_image_tag         = "acme-dev"
}
```

## Later ACME changes (2026-09-18)

Not part of the original four-variable patch above; each line is also in
`ACME-CHANGELOG.md`, and any future upstream re-base has to carry them too.

- **Database name (TF-07 / N-26)** — `postgres_database_name` (default
  `langfuse`) now names the `azurerm_postgresql_flexible_server_database`
  resource *and* the Helm `postgresql.auth.database` value. Upstream named the
  resource `psqldb-<name>` via the naming module while hard-coding `langfuse`
  in the Helm values, so a fresh deployment pointed the app at a database it
  never created. `legacy_postgres_database_resource_name` exists only so ACME
  dev's already-imported state (which manages `psqldb-langfuse`) does not plan
  a replacement.
- **TLS (TF-09 / N-27)** — `tls_certificate_mode`, default `key_vault`: the
  Application Gateway reads a publicly trusted certificate from the customer's
  own Key Vault (`tls_key_vault_id` + `tls_certificate_name`) through its
  user-assigned identity, which is granted "Key Vault Secrets User" on that
  vault. `self_signed` (the old behavior) is an explicit opt-in for test
  environments. A `moved` block in `tls.tf` carries existing states'
  certificate to its new `[0]` address.
- **Telemetry (TF-65 / N-32)** — `telemetry_enabled` (default `false`) sets the
  chart's `langfuse.features.telemetryEnabled`, i.e. `TELEMETRY_ENABLED` on
  web and worker.

## Deployment status

See `ACME-CHANGELOG.md` at the repo root for the up-to-date status.

## Known gap, same as the app fork

This is a patched snapshot, not a live-tracked fork with upstream history
preserved (same tradeoff documented in `CONTRIBUTING-ACME.md` for the app side).
Upgrading past this pinned commit means manually re-applying this same
four-variable patch to the new version.
