# AdConversion Brain on AWS. OpenTofu (open-source, MPL-2.0); also valid Terraform.
terraform {
  required_version = ">= 1.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
  # State starts local (one operator). Move to an encrypted S3 backend before a
  # second person runs this; see README.
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "adconversion-brain"
      ManagedBy = "opentofu"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name       = "adconversion-brain"
  account_id = data.aws_caller_identity.current.account_id
  az         = data.aws_availability_zones.available.names[0]
}
