#!/usr/bin/env bash
# Is every running image traceable to a released git tag?
#
# For each component env file: read the image digest(s) the deployment's pods
# are actually running, and find the annotated tag (created by release.sh)
# that records that digest. Prints TRACED or UNTRACED per component and exits
# non-zero if anything is untraced -- the signal that something was deployed
# around release.sh.
#
# Read-only: no builds, no deploys, no tag changes.
#
# Usage: verify-deployed.sh --env FILE [--env FILE ...]
#   Uses from each env file: NAMESPACE DEPLOYMENT CONTAINER, and TAG_GLOB
#   (which tags to search, e.g. "acme-v*"; default "*").
#
# Keep in sync with the copy in the other product repository.
set -euo pipefail

envs=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) envs+=("$2"); shift 2 ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
((${#envs[@]})) || { echo "Usage: verify-deployed.sh --env FILE [--env FILE ...]" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet origin --tags

untraced=0
for env_file in "${envs[@]}"; do
  (
    # shellcheck disable=SC1090
    source "$env_file"
    : "${NAMESPACE:?}" "${DEPLOYMENT:?}" "${CONTAINER:?}"
    TAG_GLOB=${TAG_GLOB:-*}

    selector=$(kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" \
      -o go-template='{{range $k, $v := .spec.selector.matchLabels}}{{$k}}={{$v}},{{end}}')
    selector=${selector%,}
    digests=$(kubectl get pods -n "$NAMESPACE" -l "$selector" \
      -o jsonpath="{range .items[*]}{.status.containerStatuses[?(@.name==\"$CONTAINER\")].imageID}{\"\n\"}{end}" |
      sed -n 's/.*@\(sha256:[0-9a-f]*\).*/\1/p' | sort -u)
    [[ -n $digests ]] || { echo "UNTRACED  $NAMESPACE/$DEPLOYMENT  no running pods found"; exit 1; }

    status=0
    while read -r digest; do
      match=""
      for tag in $(git tag -l "$TAG_GLOB"); do
        [[ $(git cat-file -t "refs/tags/$tag") == tag ]] || continue
        if git cat-file -p "refs/tags/$tag" | grep -qx "Digest: $digest"; then
          match="$tag $(git rev-parse --short "$tag^{commit}")"
          break
        fi
      done
      if [[ -n $match ]]; then
        echo "TRACED    $NAMESPACE/$DEPLOYMENT  $digest  -> $match"
      else
        echo "UNTRACED  $NAMESPACE/$DEPLOYMENT  $digest  -> no release tag records this image"
        status=1
      fi
    done <<<"$digests"
    exit $status
  ) || untraced=1
done

if ((untraced)); then
  echo
  echo "Something is running that no release tag accounts for. Deploy it with release.sh (or --redeploy a tag)."
fi
exit $untraced
