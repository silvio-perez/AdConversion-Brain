variable "region" {
  description = "AWS region. Decides where data and transcripts are processed."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 size. 2 vCPU / 4 GB is enough for the pilot."
  type        = string
  default     = "t3.medium"
}

variable "root_volume_gb" {
  type    = number
  default = 50
}

variable "alert_email" {
  description = "Where budget alerts go."
  type        = string
}

variable "budget_monthly_usd" {
  type    = number
  default = 150
}

variable "bedrock_model_arns" {
  description = "Exact Bedrock model / inference-profile ARNs the server may invoke. Nothing else is allowed."
  type        = list(string)
  validation {
    condition     = length(var.bedrock_model_arns) > 0 && alltrue([for a in var.bedrock_model_arns : can(regex("anthropic\\.", a))])
    error_message = "List at least one model ARN, and only Anthropic models (vendor policy)."
  }
}

variable "backup_noncurrent_days" {
  description = "How long superseded backup versions are kept."
  type        = number
  default     = 35
}

variable "retention_days" {
  description = "How long backups (which contain the audit log) are kept. SEC-AUD-3 requires at least a year."
  type        = number
  default     = 400
}

variable "github_repo" {
  description = "Repository allowed to publish images and release bundles (owner/name)."
  type        = string
  default     = "silvio-perez/AdConversion-Brain"
}

variable "github_deploy_ref" {
  description = "Only this Git ref may publish. Use refs/heads/main once work merges there."
  type        = string
  default     = "refs/heads/main"
}
