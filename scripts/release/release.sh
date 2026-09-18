#!/usr/bin/env bash
# Build, tag and deploy one component in a single command.
#
# This IS the deploy path. The git tag is created inside it, after the image
# build succeeds and before anything is deployed, and the deploy pins the
# exact image digest the tag records. There is no supported way to deploy a
# new version without a tag. A deploy done any other way (for example a
# manual `kubectl set image`) is detected by verify-deployed.sh as UNTRACED.
#
# What this gives you: traceability -- for every running image you know the
# commit it came from. It does NOT prove the environment can be rebuilt from
# scratch; that needs the Terraform end-to-end test.
#
# Environment-specific values (registry, namespace, deployment, health URL)
# come from an env file kept outside this repository.
#
# Keep in sync with the copy in the other product repository
# (ACME-Rayin/scripts/release, rayin-guardrails/scripts/release).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  release.sh --env FILE --version VERSION [--commit SHA] [--dry-run]
      Build VERSION from SHA (default: origin/main), tag it, deploy it.
  release.sh --env FILE --redeploy GIT_TAG [--dry-run]
      Deploy an already-released tag again (rollback or roll-forward).
      No build, no new tag: the digest comes from the tag itself.

Env file variables:
  REGISTRY LOGIN_SERVER IMAGE_REPO DOCKERFILE NAMESPACE DEPLOYMENT CONTAINER
  BUILD_DIR               required
  TAG_PREFIX              git tag = TAG_PREFIX + VERSION (default: none)
  AGENT_POOL BUILD_ARGS   optional ACR build settings (BUILD_ARGS space-separated)
  HEALTH_URL              optional URL that must return 2xx after the rollout
  ROLLOUT_TIMEOUT         default 600s
EOF
}

ENV_FILE="" VERSION="" COMMIT="" REDEPLOY_TAG="" DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE=$2; shift 2 ;;
    --version) VERSION=$2; shift 2 ;;
    --commit) COMMIT=$2; shift 2 ;;
    --redeploy) REDEPLOY_TAG=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ -z $ENV_FILE || ( -z $VERSION && -z $REDEPLOY_TAG ) || ( -n $VERSION && -n $REDEPLOY_TAG ) ]]; then
  usage >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
: "${REGISTRY:?}" "${LOGIN_SERVER:?}" "${IMAGE_REPO:?}" "${DOCKERFILE:?}"
: "${NAMESPACE:?}" "${DEPLOYMENT:?}" "${CONTAINER:?}" "${BUILD_DIR:?}"
TAG_PREFIX=${TAG_PREFIX:-}
AGENT_POOL=${AGENT_POOL:-}
BUILD_ARGS=${BUILD_ARGS:-}
HEALTH_URL=${HEALTH_URL:-}
ROLLOUT_TIMEOUT=${ROLLOUT_TIMEOUT:-600s}

run() {
  if ((DRY_RUN)); then
    printf '[dry-run]'
    printf ' %q' "$@"
    echo
  else
    "$@"
  fi
}
step() { printf '\n== %s\n' "$*"; }

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet origin --tags

deploy_digest() {
  # $1 git tag, $2 commit, $3 image tag, $4 digest
  local ref="$LOGIN_SERVER/$IMAGE_REPO:$3@$4"
  step "Deploy $1 (pinned to its digest)"
  run kubectl set image "deployment/$DEPLOYMENT" "$CONTAINER=$ref" -n "$NAMESPACE"
  run kubectl annotate --overwrite "deployment/$DEPLOYMENT" -n "$NAMESPACE" \
    "acme.release/tag=$1" "acme.release/commit=$2" "acme.release/digest=$4"
  run kubectl rollout status "deployment/$DEPLOYMENT" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT"

  step "Verify"
  if [[ -n $HEALTH_URL ]]; then
    run curl -fsS -o /dev/null -w 'health HTTP %{http_code}\n' "$HEALTH_URL"
  fi
  echo "Deployed $1 ($2) as $ref"
  echo "Record this in the environment's deployment record."
}

# --- Redeploy an existing release ------------------------------------------
if [[ -n $REDEPLOY_TAG ]]; then
  git rev-parse -q --verify "refs/tags/$REDEPLOY_TAG" >/dev/null ||
    { echo "Refusing: tag $REDEPLOY_TAG does not exist." >&2; exit 1; }
  body=$(git cat-file -p "refs/tags/$REDEPLOY_TAG")
  digest=$(printf '%s\n' "$body" | sed -n 's/^Digest: *//p' | head -1)
  image=$(printf '%s\n' "$body" | sed -n 's/^Image: *//p' | head -1)
  [[ $digest == sha256:* && -n $image ]] ||
    { echo "Refusing: tag $REDEPLOY_TAG has no Image/Digest record, so it was not produced by this script." >&2; exit 1; }
  deploy_digest "$REDEPLOY_TAG" "$(git rev-parse "$REDEPLOY_TAG^{commit}")" "${image##*:}" "$digest"
  exit 0
fi

# --- New release -------------------------------------------------------------
GIT_TAG="${TAG_PREFIX}${VERSION}"
COMMIT=$(git rev-parse --verify "${COMMIT:-origin/main}^{commit}")

step "1/5 Preconditions"
git merge-base --is-ancestor "$COMMIT" origin/main ||
  { echo "Refusing: $COMMIT is not on origin/main. Only merged code is released." >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$GIT_TAG" >/dev/null; then
  echo "Refusing: tag $GIT_TAG already exists. A version is never reused; use --redeploy to deploy it again." >&2
  exit 1
fi
existing=$(az acr manifest list-metadata --registry "$REGISTRY" --name "$IMAGE_REPO" \
  --query "[?tags && contains(tags, '$VERSION')].digest | [0]" -o tsv 2>/dev/null || true)
if [[ $existing == sha256:* ]]; then
  echo "Refusing: $IMAGE_REPO:$VERSION already exists in $REGISTRY and would be overwritten." >&2
  exit 1
fi
echo "commit $COMMIT -> $IMAGE_REPO:$VERSION, git tag $GIT_TAG"

step "2/5 Export a clean LF tree of the commit"
run rm -rf "$BUILD_DIR"
run mkdir -p "$BUILD_DIR"
if ((DRY_RUN)); then
  echo "[dry-run] git archive $COMMIT | tar -x -C $BUILD_DIR"
else
  # LF line endings: CRLF corrupts patches/*.patch and entrypoint scripts.
  git -c core.autocrlf=false -c core.eol=lf archive "$COMMIT" | tar -x -C "$BUILD_DIR"
fi

step "3/5 Build in ACR"
build=(acr build --registry "$REGISTRY" --no-logs --no-wait
  --image "$IMAGE_REPO:$VERSION" --file "$DOCKERFILE")
[[ -n $AGENT_POOL ]] && build+=(--agent-pool "$AGENT_POOL")
for arg in $BUILD_ARGS; do build+=(--build-arg "$arg"); done
if ((DRY_RUN)); then
  run az "${build[@]}" "$BUILD_DIR"
  RUN_ID="(dry-run)"
  DIGEST="sha256:(dry-run)"
else
  RUN_ID=$(az "${build[@]}" "$BUILD_DIR" 2>&1 | sed -n 's/.*Queued a build with ID: \([A-Za-z0-9]*\).*/\1/p' | head -1)
  [[ -n $RUN_ID ]] || { echo "Could not queue the ACR build." >&2; exit 1; }
  echo "ACR run $RUN_ID queued. Polling (az's own log streaming is unreliable on Windows)."
  while :; do
    status=$(az acr task show-run --registry "$REGISTRY" --run-id "$RUN_ID" --query status -o tsv)
    case $status in
      Succeeded) break ;;
      Failed | Canceled | Error | Timeout)
        echo "Build $RUN_ID ended $status. Nothing was tagged or deployed." >&2
        exit 1 ;;
    esac
    sleep 30
  done
  DIGEST=$(az acr task show-run --registry "$REGISTRY" --run-id "$RUN_ID" --query "outputImages[0].digest" -o tsv)
  [[ $DIGEST == sha256:* ]] || { echo "Build succeeded but reported no image digest." >&2; exit 1; }
fi

step "4/5 Tag the commit (before anything is deployed)"
message="Release $GIT_TAG

Image:  $LOGIN_SERVER/$IMAGE_REPO:$VERSION
Digest: $DIGEST
ACR run: $RUN_ID
Source commit: $COMMIT (exact: built from git archive of this commit)

Traceability record: which commit produced which deployed image. It does
not prove the environment can be rebuilt from scratch."
run git tag -a "$GIT_TAG" "$COMMIT" -m "$message"
run git push origin "refs/tags/$GIT_TAG"

step "5/5 Deploy"
deploy_digest "$GIT_TAG" "$COMMIT" "$VERSION" "$DIGEST"
