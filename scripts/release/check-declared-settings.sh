#!/usr/bin/env bash
# Are the settings this repository declares actually live? (CHG-2026-118)
#
# Gateway: `kubectl diff` of integrations/litellm/k8s/deployment.yaml and
# pdb.yaml against the cluster (a server-side dry run). No difference means the
# files describe what is running; any difference is printed.
#
# Console: the deployment-specific settings that deploy/azure declares from a
# private variables file must be on the live web Deployment with the same
# values: the guardrail ceiling (CAIRO_GUARDRAIL_MODE_MAX), the SSO-enforced
# domains (AUTH_DOMAINS_WITH_SSO_ENFORCEMENT) and the guardrail administrators
# (CAIRO_GUARDRAIL_ADMINS). Account linking (AUTH_AZURE_AD_ALLOW_ACCOUNT_LINKING)
# must be absent. The EYEON page switches (CHG-2026-145) must match too. Only
# the ceiling's and the switches' values are printed; the others print as
# "match" or "differs", because they name the environment and its people.
# This does not compare the console's other settings: that needs the Phase C
# reconciliation of deploy/azure with the live environment.
#
# Read-only: nothing is applied.
#
# Usage: check-declared-settings.sh --web-env FILE --tfvars FILE
#   --web-env  the console's release env file (uses NAMESPACE DEPLOYMENT CONTAINER)
#   --tfvars   the private variables file for deploy/azure; its lists must
#              each be written on one line, as in the dev file
#
# Exits non-zero if anything differs.
set -euo pipefail

web_env="" tfvars=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --web-env) web_env=$2; shift 2 ;;
    --tfvars) tfvars=$2; shift 2 ;;
    -h | --help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n $web_env && -n $tfvars ]] || { echo "Usage: check-declared-settings.sh --web-env FILE --tfvars FILE" >&2; exit 2; }
[[ -f $tfvars ]] || { echo "No such file: $tfvars" >&2; exit 2; }
cd "$(git rev-parse --show-toplevel)"
failed=0

echo "== Gateway: manifests against the live objects"
if kubectl diff -f integrations/litellm/k8s/deployment.yaml -f integrations/litellm/k8s/pdb.yaml; then
  echo "MATCH     gateway Deployment and disruption budget"
else
  status=$?
  if [[ $status -eq 1 ]]; then
    echo "DIFFERS   gateway: the diff above is what applying the files would change"
  else
    echo "ERROR     kubectl diff failed (exit $status)"
  fi
  failed=1
fi

echo "== Console: settings declared in deploy/azure"
# shellcheck disable=SC1090
source "$web_env"
: "${NAMESPACE:?}" "${DEPLOYMENT:?}" "${CONTAINER:?}"

# A string (name = "x") or a one-line list (name = ["a", "b"]) from the tfvars,
# as the comma-joined value deploy/azure renders. Empty when unset.
tfvar() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$tfvars" | head -n 1 |
    tr -d '[]" \r'
}
live_env() {
  kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" \
    -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$CONTAINER\")].env[?(@.name==\"$1\")].value}"
}
has_env() {
  kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" \
    -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$CONTAINER\")].env[*]}{.name}{\"\n\"}{end}" |
    tr -d '\r' | grep -qx "$1"
}

check() { # check NAME EXPECTED SHOW_VALUE
  local name=$1 expected=$2 show=$3 live
  if [[ -z $expected ]]; then
    if has_env "$name"; then echo "DIFFERS   $name is set live but declared empty"; failed=1
    else echo "MATCH     $name (unset, as declared)"; fi
    return
  fi
  if ! has_env "$name"; then echo "MISSING   $name is declared but not set live"; failed=1; return; fi
  live=$(live_env "$name")
  if [[ $live == "$expected" ]]; then
    if [[ $show == yes ]]; then echo "MATCH     $name=$live"; else echo "MATCH     $name"; fi
  else
    if [[ $show == yes ]]; then echo "DIFFERS   $name: declared $expected, live $live"
    else echo "DIFFERS   $name (values not shown)"; fi
    failed=1
  fi
}

mode=$(tfvar guardrail_mode_max)
check CAIRO_GUARDRAIL_MODE_MAX "${mode:-record}" yes
check AUTH_DOMAINS_WITH_SSO_ENFORCEMENT "$(tfvar sso_enforced_domains)" no
check CAIRO_GUARDRAIL_ADMINS "$(tfvar guardrail_admins)" no
# CHG-2026-145: the EYEON page switches, which deploy/azure always renders as
# "true" or "false" (a variable missing from the tfvars means its default,
# false). Their values are shown: they name no environment or person.
for flag in \
  eyeon_overview_enabled:CAIRO_EYEON_OVERVIEW_ENABLED \
  eyeon_guardrail_decisions_enabled:CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED \
  eyeon_enforcement_enabled:CAIRO_EYEON_ENFORCEMENT_ENABLED \
  eyeon_home_enabled:CAIRO_EYEON_HOME_ENABLED \
  eyeon_rail_enabled:CAIRO_EYEON_RAIL_ENABLED \
  eyeon_gateway_health_enabled:CAIRO_EYEON_GATEWAY_HEALTH_ENABLED \
  eyeon_spend_enabled:CAIRO_EYEON_SPEND_ENABLED \
  acme_ai_enabled:CAIRO_ACME_AI_ENABLED; do
  value=$(tfvar "${flag%%:*}")
  check "${flag#*:}" "${value:-false}" yes
done
if has_env AUTH_AZURE_AD_ALLOW_ACCOUNT_LINKING; then
  echo "DIFFERS   AUTH_AZURE_AD_ALLOW_ACCOUNT_LINKING is set live; it must stay unset (CHG-2026-108)"
  failed=1
else
  echo "MATCH     AUTH_AZURE_AD_ALLOW_ACCOUNT_LINKING (unset)"
fi

exit "$failed"
