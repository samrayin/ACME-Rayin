# Releasing and deploying

**`release.sh` is the deploy command.** It builds the image, tags the commit and deploys it, in that order:

```
merged commit on main
   │
   ├─ 1. preconditions   commit is on origin/main · tag and image tag not already used
   ├─ 2. export          clean LF `git archive` of the commit (no working-tree drift)
   ├─ 3. build           ACR build → image digest
   ├─ 4. TAG             annotated git tag: commit + image + digest + ACR run, pushed
   └─ 5. deploy          kubectl set image …@<digest> · annotate · rollout · health
```

The tag is created in step 4, **after** the build succeeds and **before** `kubectl set image`. There is no supported way to deploy a new version without it. The deploy pins the exact digest the tag records, so the running image can't differ from the tagged one even if an image tag is later overwritten in the registry.

- **Rollback or redeploy:** `release.sh --env FILE --redeploy <tag>` deploys an already-released tag by its recorded digest. It creates no new tag, so a rollback never needs a manual `kubectl set image`.
- **Drift check:** `verify-deployed.sh --env FILE …` compares what is actually running against the tags and reports `UNTRACED` for anything deployed some other way. Run it after every deploy, and as a periodic check.

Environment-specific values (registry, namespace, deployment names, health URL) live in env files outside this repository. Nothing environment-specific is committed here.

## What this does and does not give you

- **Traceable:** for every running image, you know the exact commit it was built from, and the changelog says what that commit contains.
- **Not reproducible end-to-end:** a tag tells you *what* was running. It does not prove the environment can be stood up fresh on a new subscription. That needs infrastructure, secrets, configuration and seed data beyond the image, and the Terraform customer template has not yet been run end to end. See ACME-CHANGELOG "Outstanding".
