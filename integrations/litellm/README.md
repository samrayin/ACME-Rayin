# LiteLLM — governed LLM gateway

**Status: deployed and healthy, 2026-09-11.** Live in `rayin-platform` on
`aks-langfuse` — pod running, schema migrated, `claude-sonnet` model loaded,
Langfuse logging callbacks initialized, `/health/readiness` green. Neither
consumer (chat widget, `rayin-guardrails`) is wired through yet — see
[Sequencing](#sequencing).

Three real bugs surfaced during the first deploy, all fixed:
1. **Postgres private endpoint had no DNS zone group** — nothing in the
   cluster could resolve `psql-langfuse-bgqj.postgres.database.azure.com`.
   Fixed via the Portal (Private DNS integration → Add configuration),
   linking the existing `privatelink.postgres.database.azure.com` zone.
2. **PG15's tighter default `public` schema privileges** — `GRANT ALL
   PRIVILEGES ON DATABASE` no longer implies `CREATE` on the `public`
   schema as of Postgres 15, so Prisma's migrations failed with
   `permission denied for schema public` until `GRANT ALL ON SCHEMA
   public TO litellm` was run explicitly, connected to the `litellm`
   database itself (not the `postgres` maintenance db).
3. **Memory limit too low, and a self-inflicted ConfigMap bug** — see
   [k8s/deployment.yaml](k8s/deployment.yaml)'s comments: the original 1Gi
   limit was copied from `rayin-guardrails`' spaCy footprint by mistake
   (raised to 2Gi), and an early version of that same file defined an inline
   placeholder ConfigMap that silently overwrote the real `litellm-config`
   on every apply (removed — the real config is only ever the one applied
   via the `--from-file` command).

**Not yet captured as code** — done as one-off `az`/Portal/`psql` actions,
so a lost cluster or server wouldn't come back without someone repeating
these steps by hand: the `litellm` Postgres database, the `litellm` Postgres
role/grants, and the DNS zone group fix on `pe-langfuse-postgres`. Per this
repo's [integrations convention](../../CONTRIBUTING-ACME.md#integrations-litellm-nemo-guardrails-promptfoo--live-in-integrations),
these belong in an opt-in `integrations/litellm/terraform/` if/when this
should become genuinely reproducible rather than tribal knowledge — not yet
written.

## What it is

[LiteLLM](https://github.com/BerriAI/litellm) is a reverse proxy that sits in
front of every model call: one OpenAI-compatible endpoint, virtual API keys
per team/use case, per-key spend budgets, and automatic fallback across
providers. It's config-driven (official image + a YAML file) — not
application code this repo maintains.

MIT-licensed, no paywalled core: virtual keys, budgets, and the usage
dashboard are all in the open-source image, not an enterprise tier (checked
explicitly given the MinIO precedent in this fork's history). Two other
genuinely open alternatives exist — Bifrost (Apache 2.0) and Portkey's
gateway (Apache 2.0 since March 2026) — but nothing evaluated beats LiteLLM
for this specific use case, so there's no reason to delay Phase 1 chasing a
second opinion.

## Why RAYIN needs it

- **"Assign credits to a user, monitor usage from there"** — create a virtual
  key per user/team, set `max_budget` on it. LiteLLM tracks spend in real
  time and **hard-stops** requests once the cap is hit — not just a warning.
- **One governed path, not three integrations later** — `rayin-guardrails`
  (see the guardrails plan, separately) was already built expecting a
  `GUARDRAILS_LLM_BASE_URL` env var to eventually point at this gateway
  instead of a provider directly. The chat widget has the same shape of
  problem. Standing up LiteLLM once gets both a governed, cost-tracked path
  instead of bolting budget logic onto each caller separately.
- **Feeds RAYIN's own Observability, not a second dashboard** — LiteLLM has a
  native Langfuse logging integration, so its usage data can flow straight
  into RAYIN's existing Observability section.

## Architecture

- Plain Kubernetes `Deployment` + `Service`, **ClusterIP only** — same
  no-public-ingress posture as `rayin-guardrails`. Nothing about this needs
  to be internet-facing; every consumer is another pod in the same cluster.
- Official `ghcr.io/berriai/litellm` image — no build step, no ACR push
  needed, unless it's later mirrored into `acmelangfuseacr` for the
  air-gapped customer story (same pattern as the customer deployment
  template's air-gapped checklist).
- **State**: LiteLLM needs Postgres for its own spend tracking and virtual
  keys. Reuse the existing `psql-langfuse-bgqj` Flexible Server with a new
  schema/database, rather than provisioning a second server — there's no
  reason to duplicate what's already running and paid for.
- **Compute**: deploys into the same AKS cluster/node Langfuse already runs
  on (`Standard_D8s_v6`, ~2% CPU / ~23% mem actually used as of the last
  headroom check) — no new node pool. Give it explicit `requests`/`limits`
  rather than leaving it unbounded, the same reasoning applied to
  `rayin-guardrails`'s sizing.
- **Infra stays opt-in** — per this repo's [integrations convention](../../CONTRIBUTING-ACME.md#integrations-litellm-nemo-guardrails-promptfoo--live-in-integrations),
  this folder is never merged into the shared `infra/langfuse-terraform-azure`
  module. A customer who doesn't want LiteLLM shouldn't be forced to deploy
  it. Manifests here are applied directly with `kubectl`, the same way
  `rayin-guardrails` was deployed.

## Sequencing

1. Namespace decision (below) — blocks everything else.
2. Config file + secrets — no cluster changes yet, just getting the YAML and
   the k8s `Secret` right.
3. Deploy LiteLLM itself, verify it's up and the Admin UI is reachable
   in-cluster.
4. Point **one real caller** at it — the chat widget, once
   `ANTHROPIC_API_KEY` is actually set (open item, unrelated 5-minute Phase 0
   fix, tracked separately — not a LiteLLM blocker but worth closing at the
   same time). Prove cost tracking shows up for that one caller before
   adding a second.
5. Add `rayin-guardrails` as the second consumer, pointing its
   `GUARDRAILS_LLM_BASE_URL` at the new gateway instead of a provider
   directly.

## Open decisions — resolved 2026-09-11

1. **Namespace: `rayin-platform`.** Confirmed — both `rayin-guardrails` and
   LiteLLM go into this new namespace, not `langfuse`.
2. **Provider keys live day one: Anthropic only**, using the existing
   personal Claude/Anthropic API key. OpenAI and Azure OpenAI stay
   configured-but-dormant (commented out in
   [`config/litellm-config.yaml`](config/litellm-config.yaml), omitted from
   the secret) — flip on later by uncommenting and adding the key, no
   redeploy of anything else required.

   **Update, 2026-09-12: this account has no billing credit** — every call
   through `claude-sonnet` 400s (`credit balance is too low`). For this dev
   environment, `nvidia-nemotron` (OpenRouter, free tier) is the actual
   working model, and every consumer -- chat, `rayin-guardrails`' rail
   engine, promptfoo -- should target it via `RAYIN_CHAT_LLM_MODEL` /
   `GUARDRAILS_LLM_MODEL` until Anthropic billing is resolved or a real
   production provider decision is made. A Groq entry was tried as a second
   working provider and removed the same day (the account's available model
   slug no longer exists on Groq's current lineup) — not worth chasing
   further since `nvidia-nemotron` alone unblocks testing.
3. **Budget: $50 per virtual key — confirmed 2026-09-12.** Per-key, not a
   shared total; each new key gets its own $50 cap. Applied live to both
   starter keys (`chat-widget`, `rayin-guardrails`) via `/key/update`, not
   just this file. History, since the two drifted from what was documented
   before this was actually answered: created at $10/key, live-adjusted to
   $25/key at some point without a doc update, now $50/key everywhere. If a
   key's actual budget and this file ever disagree again, trust
   `/key/info`, not this file — update this file to match, not the reverse.

## Deployment guide

Once the three decisions above are answered:

### 1. Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

### 2. Config

[`config/litellm-config.yaml`](config/litellm-config.yaml) already reflects
the resolved decisions above — `nvidia-nemotron` is the live default for
every dev-environment consumer (Anthropic is configured but unhealthy, no
billing credit; Groq was tried and dropped), OpenAI/Azure OpenAI stay
dormant, $50 budget on the starter keys.

### 3. Secrets

Real provider API keys go into a Kubernetes `Secret`, referenced by the
config — never hardcoded into the YAML or committed to this repo. See
[`k8s/secret.example.yaml`](k8s/secret.example.yaml) for the expected keys;
create the real one directly against the cluster:

```bash
kubectl create secret generic litellm-provider-keys \
  --namespace rayin-platform \
  --from-literal=ANTHROPIC_API_KEY=<real-key> \
  --from-literal=DATABASE_URL=<litellm-postgres-connection-string> \
  --from-literal=LITELLM_MASTER_KEY=<generate-a-random-value>
```

LiteLLM's own Postgres connection string (pointing at the new schema on
`psql-langfuse-bgqj`) goes into the same secret as `DATABASE_URL`.

### 4. Deploy

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl -n rayin-platform rollout status deployment/litellm
```

### 5. Verify

```bash
kubectl -n rayin-platform port-forward svc/litellm 4000:4000
curl http://localhost:4000/health
```

Confirm the Admin UI shows the configured virtual keys and that a test call
through the proxy shows up in both LiteLLM's own spend tracking and (once
wired) RAYIN's Observability section.

### 6. First real consumer

Switch the chat widget's base URL from calling Anthropic directly to
LiteLLM's in-cluster service address, using its dedicated virtual key. Confirm
cost tracking shows a real entry before adding `rayin-guardrails` as the
second consumer per [Sequencing](#sequencing) step 5.

## Guardrail hook (CHG-2026-014, ADR-0005) — present, NOT enabled

`config/cairo_guardrail_hook.py` ships the **ADR-0005 Step 0 exclusion** and its unit
tests. It is inert: nothing references it from a `guardrails:` block, and its verdict
path deliberately raises `NotImplementedError` so it cannot appear to work.

Run the tests from the repository root — stdlib only, no cluster, no `litellm`:

```bash
python -m unittest discover -s integrations/litellm/tests -v
```

Enabling the hook in **any** mode, including `record`, is gated on ADR-0005-A: the judge
key must carry its opt-out, allowlist and rate cap, and layers 2 and 3 must pass. The
loop F10 describes bites in `record` exactly as it does in `enforce`.

## Status log

**2026-09-11 — deployed, live, healthy.** Steps 1–4 above all done against
the real cluster; step 5 (first real consumer) not yet started — see the
top-of-file status note for the bugs hit and fixed along the way. Per
[CONTRIBUTING-ACME.md](../../CONTRIBUTING-ACME.md#before-marking-anything-done):
this is genuinely "deployed," not just "committed" — verified via
`/health/readiness`, pod logs, and a manual `prisma migrate deploy` run
inside the pod, not assumed from the manifests alone.
