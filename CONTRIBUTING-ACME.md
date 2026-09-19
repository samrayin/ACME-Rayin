# Contributing to this fork (ACME conventions)

This file governs ACME-specific changes to this Langfuse fork. For contributing to
Langfuse itself, see the upstream `CONTRIBUTING.md`. For the broader process —
branching, environments, CI/CD, infrastructure, and secrets, across all of
RAYIN's repos — see [`ACME-DEVELOPMENT-FRAMEWORK.md`](ACME-DEVELOPMENT-FRAMEWORK.md).

## The one rule that matters

**Every ACME change is its own commit, and gets its own entry in
`ACME-CHANGELOG.md` in that same commit.** Never bundle an ACME customization into
an unrelated commit, and never let a change land without a changelog entry — that's
exactly how this fork started (one giant squashed commit with no record of what
changed or why), and it's what this convention exists to prevent going forward.

Every enhancement and database change also follows `acme-governance/CHANGE-PROCEDURE.md` (design note, versioned migration, rehearsed rollback, approval-accurate changelog entry).

## Commit message shape

```
ACME: <short description>

<why this change exists — the reasoning, not just the what>
<any licensing/security consideration, if relevant>

See ACME-CHANGELOG.md for full detail.
```

Use `ACME branding:` / `ACME Enhancements:` / `ACME AI:` prefixes to match the
existing history when the change fits one of those areas; otherwise `ACME:` alone
is fine.

## Changelog entry shape

Each `ACME-CHANGELOG.md` entry should answer, in this order:
1. **What** changed (files touched).
2. **Why** this approach was chosen — especially if it's working around an
   Enterprise-licensed feature; cite the specific entitlement and where it's
   checked in source, don't assert from memory.
3. **Deployment status** — has this actually shipped to a running environment, or
   is it source-only?
4. Anything **known-incomplete** that needs attention before production.

## Before marking anything "done"

- If the change touches licensing-gated territory, verify against the actual
  source (`ee/` entitlement checks), not against docs or assumption — this fork's
  own history has already caught real docs/code mismatches more than once.
- If the change is meant to reach a live environment, it isn't done until it's
  actually in a built image and deployed — "committed" and "deployed" are
  different states, and `ACME-CHANGELOG.md` should say which one applies.

## Integrations (LiteLLM, NeMo Guardrails, promptfoo, …) live in `integrations/`

Anything that isn't Langfuse itself or a customization of it — a gateway, a
guardrails layer, an eval tool — gets its own folder under `integrations/<name>/`
at the repo root, never mixed into `web/`, `worker/`, or `packages/`:

```
integrations/
  litellm/
    README.md      # what it is, how it connects, current status
    config/         # the integration's own native config
    terraform/      # opt-in infra additions specific to this integration
```

Rules that keep this from turning into the same mess ACME-Rayin's own history
started as:
1. **Self-contained.** Its own README, its own config, its own deploy
   artifacts. Deleting the folder should not break Langfuse or any other
   integration.
2. **Never edits core Langfuse code.** If RayIn's UI needs to surface or link
   to it, that's one small addition under the existing
   `web/src/features/acme-enhancements/` pattern, pointing *out* to the
   integration — not the integration's own logic living inside that feature.
3. **Its infra is opt-in.** A toggle/module a customer's deployment can
   include or skip, not permanently added to the shared
   `infra/langfuse-terraform-azure` module. A customer who doesn't want
   LiteLLM shouldn't be forced to deploy it.
4. **Its own commit prefix** (`Integration(<name>): <description>`) and its
   own history in that integration's README — `ACME-CHANGELOG.md` stays
   scoped to Langfuse/RayIn customization specifically, not integrations.

## Git history

~~This repository's history starts from a snapshot of Langfuse v4.17.0...~~ —
**resolved.** `main` is now built on a real clone of upstream Langfuse's
history (tag `v4.33.0`), with every ACME commit cherry-picked on top
individually. A future upstream version bump can use a normal `git merge`/
rebase against the next upstream tag instead of manually replaying patches.
