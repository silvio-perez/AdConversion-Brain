output "instance_id" {
  description = "Connect with: aws ssm start-session --target <id>"
  value       = aws_instance.server.id
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "releases_bucket" {
  value = aws_s3_bucket.releases.bucket
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "github_publish_role_arn" {
  description = "Role GitHub Actions assumes (OIDC) to publish images and bundles."
  value       = aws_iam_role.github_publish.arn
}
