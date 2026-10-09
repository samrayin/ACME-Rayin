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

# The EYEON page switches (CHG-2026-145). Each is a server-only console flag;
# false keeps the page off, which is also what a new deployment gets. Dev's
# values are in the private variables file with the settings above, so a plan
# without that file would switch dev's EYEON pages off.

variable "eyeon_overview_enabled" {
  description = "The EYEON overview page (CAIRO_EYEON_OVERVIEW_ENABLED, CHG-2026-132)."
  type        = bool
  default     = false
}

variable "eyeon_guardrail_decisions_enabled" {
  description = "The EYEON Guardrail decisions page (CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED, CHG-2026-133). Also where the Security Analyst and the Auditor land (CHG-2026-136)."
  type        = bool
  default     = false
}

variable "eyeon_enforcement_enabled" {
  description = "The EYEON Enforcement and policy page (CAIRO_EYEON_ENFORCEMENT_ENABLED, CHG-2026-138)."
  type        = bool
  default     = false
}

variable "eyeon_home_enabled" {
  description = "EYEON Home: the overview as the project's home, arranged per person (CAIRO_EYEON_HOME_ENABLED, CHG-2026-136). Needs eyeon_overview_enabled."
  type        = bool
  default     = false
}

variable "eyeon_rail_enabled" {
  description = "The EYEON navigation rail (CAIRO_EYEON_RAIL_ENABLED, CHG-2026-135)."
  type        = bool
  default     = false
}

variable "eyeon_gateway_health_enabled" {
  description = "The EYEON Gateway health page (CAIRO_EYEON_GATEWAY_HEALTH_ENABLED, CHG-2026-139)."
  type        = bool
  default     = false
}

variable "eyeon_spend_enabled" {
  description = "The EYEON Cost and usage page, Spend (CAIRO_EYEON_SPEND_ENABLED, CHG-2026-143)."
  type        = bool
  default     = false
}

variable "acme_ai_enabled" {
  description = "ACME AI, the in-console assistant (CAIRO_ACME_AI_ENABLED, CHG-2026-141). It also needs its model settings (RAYIN_CHAT_LLM_*), which are not declared here."
  type        = bool
  default     = false
}
