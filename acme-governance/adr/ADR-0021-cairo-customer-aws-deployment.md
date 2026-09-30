# ADR-0021: CAIRO in a customer's own AWS account

| | |
|---|---|
| **Change ID** | CHG-2026-087 · Tier 1 (a new deployment target, holding customer data) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released |
| **Status** | **Parked by the owner, 2026-09-30:** "stall the aws deployment for now". The priority is CAIRO performing at its best in the current setup; AWS is planned after that. Proposed, design only: nothing is built, and no AWS account has been touched |
| **Type** | Forward |
| **Date** | 2026-09-30 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner decided on 2026-09-30: the customer's own AWS account, target 3–4 weeks. The open decisions are in §8 |
| **Depends on** | ADR-0020 (the front door), which this deployment applies |

## 1. Purpose

CAIRO runs today in one dev environment on Azure (AKS). A customer wants to run it in **their own AWS account**. This ADR fixes the architecture, the data-residency choices, identity, egress control and the delivery method, so that the Terraform and the runbook can be written against a decided design.

Facts marked VERIFIED below were read in AWS, Langfuse and ClickHouse primary documentation on 2026-09-30. The rest are design choices.

## 2. Constraints

- **Region.** The customer's regulator expects data to stay in-country. The design targets the AWS Middle East (Bahrain) region, `me-south-1`.
  - It is an **opt-in region** (VERIFIED): the customer must enable it in their account first.
  - All services this design needs are offered there (VERIFIED at service level): EKS, RDS for PostgreSQL, ElastiCache, S3, ALB, NAT Gateway, WAF, KMS, Secrets Manager, ECR, Route 53, ACM, CloudWatch, VPC endpoints and PrivateLink, and Network Firewall.
- **ClickHouse Cloud is not offered in `me-south-1`** (VERIFIED; its nearest region is the UAE). ClickHouse therefore runs self-managed, inside the cluster.
- **Amazon Bedrock in `me-south-1` offers no in-region inference** (VERIFIED on the model-compatibility page): models are reachable only through global cross-region inference, so prompts may be processed outside the region. Using Bedrock is a residency decision for the customer (§3.6, D3).
- **Single sign-on uses OIDC.** Self-hosted Langfuse signs in through Auth.js providers: Entra ID and Okta natively, others through a custom OIDC provider (VERIFIED). A SAML-only identity provider needs an OIDC bridge.
- **The customer's account and network.** ACME cannot assume administrator access. The customer's cloud team runs, or supervises, every apply.

## 3. Decision

### 3.1 Base: the official Langfuse AWS Terraform module, pinned, plus CAIRO's layer

- **Base module.** `langfuse/langfuse-terraform-aws`, pinned to a reviewed commit. It provisions (VERIFIED from its README):
  - VPC, EKS, Aurora PostgreSQL Serverless v2, ElastiCache, S3;
  - ClickHouse through the official operator;
  - ALB ingress, IAM and security groups.
- **CAIRO adds its own module** for:
  - the gateway (LiteLLM, with its own Postgres database);
  - the guardrails service;
  - the front-door ingress (ADR-0020);
  - Network Firewall and its egress allow-list;
  - WAF;
  - Secrets Manager with KMS;
  - VPC endpoints;
  - the customer-facing internal endpoint.
- **Version overrides.** Postgres 16, not the module's default 15.12, because Langfuse v4 recommends 16 (VERIFIED). ClickHouse at or above the version Langfuse v4 requires (25.12; 26.4 recommended, VERIFIED).

### 3.2 Compute

- **EC2 managed node groups, not Fargate**, for ClickHouse and Keeper (stateful, EBS-backed), the guardrails service (large language-model and NER images) and the gateway. Two reasons:
  1. stateful ClickHouse needs block storage;
  2. EKS Pod Identity is unavailable on Fargate (VERIFIED). On nodes, workloads can use Pod Identity or IRSA.
- **Web and worker** may stay on Fargate, as in the module, if that helps the customer's operating model. This decision is recorded in §8, D4.
- **To verify before the first apply:** how the module persists ClickHouse on Fargate, and whether the node-group change is a module variable or an override.

### 3.3 Data services

| Service | Choice | Notes |
|---|---|---|
| Postgres (CAIRO) | Aurora PostgreSQL Serverless v2, 2 instances, Multi-AZ | Module default sizing (0.5–2 ACU) for the POC. Aurora availability in `me-south-1` to confirm at apply |
| Postgres (gateway) | A separate database on the same cluster, separate credentials | Keeps gateway keys and spend apart from CAIRO data |
| Redis | ElastiCache, `cache.t4g.small`, 1 node for the POC | Engine (Redis OSS or Valkey) as the region offers; to confirm at apply |
| Object storage | S3, versioned, SSE-KMS with a customer-managed key, public access blocked | Event uploads and exports |
| ClickHouse | In-cluster: 3 replicas and 3 Keeper nodes (module default), on EBS gp3, encrypted | Backups to S3 |

- **All encryption keys are the customer's KMS keys.** ACME never holds them.

### 3.4 Network and the front door

- **Subnets.** Private subnets for everything, across two or three availability zones. There is no public ingress.
- **The front door (ADR-0020)** is an **internal** ALB. CAIRO's console and its `/llm/v1` path share one hostname under the customer's domain, with an ACM certificate and WAF.
- **Reaching it.** The customer's applications reach the front door over their existing connectivity: PrivateLink (an endpoint service in front of the ALB, for cross-VPC or cross-account consumers) or Transit Gateway. The customer's network team chooses (D5).
- **Egress** goes out through AWS Network Firewall and then a NAT gateway:
  - a domain allow-list: model providers approved for the customer (reachable only from the gateway's subnet) and the few external services the platform needs;
  - default drop for everything else.
- **AWS services** are reached through VPC endpoints, so that traffic stays off the internet: S3, ECR, Secrets Manager, KMS, CloudWatch Logs, STS.
- **No bypass (ADR-0020 §3.2):**
  - inside the cluster: default-deny NetworkPolicies;
  - at the edge: only the gateway subnet may reach provider domains;
  - in the customer's application networks: the customer blocks direct provider egress. Acceptance test T8 proves it.

### 3.5 Identity and secrets

- **Staff sign-in.** OIDC against the customer's identity provider, with invite-only sign-up, as in dev (CHG-2026-057). CAIRO roles and project limits apply as in dev.
- **Workload access to AWS.** IAM roles per service account (Pod Identity on nodes, IRSA on Fargate), scoped to one bucket, one set of secrets, one KMS key.
- **Secrets** live in Secrets Manager, not in Kubernetes Secret data. They are delivered to pods by the Secrets Store CSI driver, or the External Secrets Operator (D6).
  - This closes, for this deployment, the Key Vault gap that dev still has (ledger P0-3).
- **Break-glass.** ACME support access is a role the customer grants and revokes. It is time-boxed and logged in CloudTrail.

### 3.6 Model providers and residency

- **Which providers the gateway may call is the customer's decision.** It is recorded in the POC's residency statement. The options, each with its residency effect stated to the customer:
  1. the customer's own contracted provider endpoints;
  2. Bedrock with global cross-region inference, if the customer accepts processing outside the region;
  3. a provider with in-region hosting, if one exists for the chosen models.
- **The routing tiers and fallback groups (ADR-0020 §3.4) contain only approved providers.** A fallback must never cross a residency boundary the customer did not approve.
- **The guardrail judge model is a provider call too.** Its placement follows the same rule.

### 3.7 Images and supply chain

- **Images.** CAIRO's images (web, worker, guardrails) and the pinned gateway image are copied **by digest** into the customer's ECR, not pulled from ACME's registry at run time. Each ships with an SBOM, and the digests are verified at deploy (the SSDF process, set 2026-09-27).
- **Releases.** `release.sh` gains an AWS target: push by digest to ECR, set images by digest, record the deployment. Traceability works as in dev.

### 3.8 Operations

- **Logs and metrics** go to CloudWatch in the customer's account. Nothing is exported to ACME unless the customer approves.
- **Backups:** Aurora automated snapshots; S3 versioning; ClickHouse backups to S3. Restore is tested once before acceptance.
- **Data retention:** traces and raw events expire after 30 days, as in dev. The Postgres deletion path is still open (P0-11) and is disclosed to the customer.

## 4. Delivery method: no ACME AWS sandbox exists

ACME has no AWS account for rehearsal (owner, 2026-09-30), so the first full apply would otherwise be in the customer's account. Mitigations, in order of preference:

1. **ACME opens a short-lived AWS account** for one rehearsal apply and teardown. It costs a few days of POC-sized resources. Recommended (D1).
2. **Rehearse in the customer's non-production account**, with their team, before the POC account.
3. **At minimum:** `terraform validate` and `plan` against the customer's account with read-only credentials. The Kubernetes layer is proven on AKS first (ADR-0020's test suite). The first apply is a supervised session with the rollback (`terraform destroy`) agreed beforehand.

The Terraform and the runbook are written so the customer's team can run them: variables for their VPC, domain and IdP, and no ACME-held state or credentials.

## 5. Impacted components

| Component | Impact |
|---|---|
| New: `deploy/aws/` | Terraform: the pinned base module, CAIRO's module and example variables. Nothing environment-specific is committed to the public repo |
| `scripts/release/` | An AWS target: ECR push by digest, deploy by digest, verify |
| Web / worker / guardrails | No code change expected. Configuration through environment and secrets |
| Gateway | Configuration per ADR-0020 |
| Documentation | Runbook, residency statement and customer responsibilities. Customer-specific versions are held privately, not in this repo |

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| First apply in the customer's account fails midway | Medium | High | A rehearsal account (D1); a plan reviewed with the customer; agreed destroy and rollback |
| Residency: a model provider processes data outside the region | High if Bedrock is used | High | The customer's decision is recorded (§3.6); fallbacks are limited to approved providers |
| A service or version is missing in `me-south-1` (Aurora, Valkey, Postgres 16) | Low–Medium | Medium | Checked in the customer's account at plan time; alternatives: RDS PostgreSQL, Redis OSS |
| ClickHouse on Fargate storage is unsuitable | Medium | Medium | EC2 node groups for ClickHouse (§3.2) |
| The customer's apps bypass CAIRO | Medium | High | Customer egress block and test T8 (ADR-0020) |
| P0-11: no deletion path in Postgres | Certain | Medium (POC) | Disclosed; metadata-only tracing; the deletion work is owned internally (ADR-0006 §12) |
| The timeline (3–4 weeks) | Medium | Medium | Kubernetes layer proven on AKS first; the module does most of the base; the customer's approvals are scheduled early |

## 7. Compatibility

The dev environment on Azure is unaffected. The AWS target is additive. The same images and gateway configuration run on both, apart from the cloud-specific storage and identity settings.

## 8. Open decisions for the owner (some with the customer)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Rehearsal: open a short-lived ACME AWS account | Yes (§4) |
| D2 | Region | `me-south-1`, subject to the customer confirming the residency requirement |
| D3 | Model providers for the POC | The customer's choice, recorded with its residency effect (§3.6) |
| D4 | Web and worker on Fargate or nodes | Nodes for everything, for the POC's simplicity: one compute model |
| D5 | How the customer's apps reach the front door | PrivateLink if the apps sit in other VPCs or accounts; otherwise Transit Gateway. The customer's network team decides |
| D6 | Secrets delivery | Secrets Store CSI driver (AWS provider): fewer moving parts than the External Secrets Operator |
| D7 | Who runs `terraform apply` | The customer's cloud team, with ACME on the call; ACME holds no standing credentials |

## 9. Not verified

- Aurora PostgreSQL Serverless v2, the Postgres 16 minor versions and the ElastiCache engine in `me-south-1`. All three are checked at plan time in the customer's account.
- How the base module stores ClickHouse data on Fargate.
- The customer's identity provider type (OIDC or SAML) and their connectivity pattern.
