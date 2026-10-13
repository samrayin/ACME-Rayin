# Releasing and deploying

**`release.sh` is the deploy command.** It builds the image, tags the commit and deploys it, in that order:

```
merged commit on main
   │
   ├─ 1. preconditions   commit is on origin/main · tag and image tag not already used
   ├─ 2. export          clean LF `git archive` of the commit (no working-tree drift)
   ├─ 3. build           ACR build from inside the export → image digest; step total checked against the Dockerfile
   ├─ 4. TAG             annotated git tag: commit + image + digest + ACR run, pushed
   └─ 5. deploy          kubectl set image …@<digest> · annotate · rollout · health
```

The tag is created in step 4, **after** the build succeeds and **before** `kubectl set image`. There is no supported way to deploy a new version without it. The deploy pins the exact digest the tag records, so the running image can't differ from the tagged one even if an image tag is later overwritten in the registry.

- **Rollback or redeploy:** `release.sh --env FILE --redeploy <tag>` deploys an already-released tag by its recorded digest. It creates no new tag, so a rollback never needs a manual `kubectl set image`.
- **Always build from the export.** `az acr build` resolves a relative `--file` against the current directory, not the build context, so the script runs it from inside `$BUILD_DIR`. Before tagging, it compares ACR's `Step 1/N` with the exported Dockerfile's instruction count and refuses on a mismatch. That check catches a structurally different Dockerfile, not an edit that keeps the count; building from the export is the fix.
- **Drift check:** `verify-deployed.sh --env FILE …` compares what is actually running against the tags and reports `UNTRACED` for anything deployed some other way. Run it after every deploy, and as a periodic check.

Environment-specific values (registry, namespace, deployment names, health URL) live in env files outside this repository. Nothing environment-specific is committed here.

## The build pool window

The web and worker images build on a dedicated ACR build pool (`AGENT_POOL` in their env files); the default ACR agent runs out of memory on the web image. A dedicated pool bills for every second it exists, whether or not a build runs, so it exists only for a release window. `with-build-pool.sh` creates it, runs your command and always deletes it afterwards:

```
scripts/release/with-build-pool.sh --env web.env -- \
  bash -c 'scripts/release/release.sh --env web.env --version N && scripts/release/release.sh --env worker.env --version M'
```

- **Batch the window.** Release web and worker together in one window. Guardrails builds use the default agent and need no pool.
- **Never leave the pool between windows.** `with-build-pool.sh --env FILE --check` says whether one exists (exit 1 if it does) and `--close` deletes it.
- **The cost is printed** when the window closes: how long it was open and an estimate at the public per-vCPU-second rate (S3 is 8 vCPU).
- **By hand,** if you must: `az acr agentpool create --registry R --name P --tier S3 --count 1` (Azure's default tier is S1, which is too small for the web image), then `az acr agentpool delete --registry R --name P --yes` and confirm with `az acr agentpool list --registry R`.
- **Tests:** `scripts/release/test-with-build-pool.sh` runs the wrapper against a fake `az`. It needs no cloud access.

## What this does and does not give you

- **Traceable:** for every running image, you know the exact commit it was built from, and the changelog says what that commit contains.
- **Not reproducible end-to-end:** a tag tells you *what* was running. It does not prove the environment can be stood up fresh on a new subscription. That needs infrastructure, secrets, configuration and seed data beyond the image, and the Terraform customer template has not yet been run end to end. See ACME-CHANGELOG "Outstanding".
