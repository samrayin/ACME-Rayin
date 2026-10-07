# Deployment-specific settings for the dev console (CHG-2026-118).
#
# Their dev values live in a private variables file outside this public
# repository (acme-rayin-ops, envs/dev/deploy-azure.tfvars), because the
# sign-in domain and the administrators' emails identify the environment and
# its people. Pass it with -var-file. None of them is a secret, and they are
# not marked sensitive: the module validates additional_env, and plan output
# stays on the operator's machine.

variable "guardrail_mode_max" {
  description = "The guardrail deployment ceiling (CAIRO_GUARDRAIL_MODE_MAX, CHG-2026-089 part b). \"enforce\" allows the console's enforce switch; \"record\" keeps every verdict recorded and never applied."
  type        = string
  default     = "record"

  validation {
    condition     = contains(["record", "enforce"], var.guardrail_mode_max)
    error_message = "guardrail_mode_max must be \"record\" or \"enforce\"."
  }
}

variable "sso_enforced_domains" {
  description = "Sign-in domains whose users must use Azure AD (AUTH_DOMAINS_WITH_SSO_ENFORCEMENT). Empty means no domain is SSO-only."
  type        = list(string)
  default     = []
}

variable "guardrail_admins" {
  description = "Sign-in emails of the named guardrail administrators (CAIRO_GUARDRAIL_ADMINS): only they can change guardrail policy or mode. Empty means nobody can."
  type        = list(string)
  default     = []
}

variable "gateway_traces_project_id" {
  description = "The id of the project the gateway's own traces go to (CAIRO_GATEWAY_TRACES_PROJECT_ID, CHG-2026-126). When set, the Applications detail screen links each request to its gateway trace; empty means it shows the trace id only."
  type        = string
  default     = ""
}
