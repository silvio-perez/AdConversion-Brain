# AWS infrastructure (OpenTofu)

Everything the Brain needs in the AdConversion AWS account, as reviewable code.
Validated on every push (`tofu fmt` + `tofu validate` in CI). **Applying it
creates billable resources and needs founder approval** (deployment plan, step B3).

## What it creates

| Area | Resources | Why |
|---|---|---|
| Network | VPC, one subnet, **no inbound rules** | Nothing on the internet can connect in. Staff use Tailscale; admins use SSM. |
| Private paths | Bedrock runtime endpoint, S3 endpoint | Transcripts and backups stay on AWS's network. |
| Server | One Ubuntu 24.04 instance, encrypted disk, IMDSv2 (hop limit 1) | Containers can't read the server's AWS credentials. |
| Permissions | Server role: invoke approved Claude models, *add* backups, read releases, pull its image, read `/brain/*` secrets | Least privilege. The server can't read or delete backups. |
| Backups | S3 bucket: versioned, KMS-encrypted, object lock (30 days), 400-day retention; plus nightly disk snapshots (14 days) | SEC-DATA-3, SEC-AUD-3. |
| Releases | ECR repository (immutable tags, scan on push) and a release-bundle bucket | Images are built in CI and pinned by digest. |
| CI publishing | GitHub OIDC role limited to one repository and branch | No long-lived AWS keys in GitHub. |
| Oversight | CloudTrail (all regions, log validation), monthly budget alerts | Who did what in AWS; no surprise bills. |

Estimated cost before Bedrock usage: about $45–60/month (instance, one interface
endpoint, storage). Confirm with the AWS pricing calculator.

## First apply

Prerequisites (done once, in the console): account hardening, Claude enabled in
Bedrock, and the model or inference-profile ARN copied (deployment plan B1–B2).

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars   # fill in; git-ignored
tofu init
tofu plan -out plan.bin                        # review every resource
tofu apply plan.bin
```

Then:

1. **Secrets** into SSM Parameter Store as `SecureString` under `/brain/` (Postgres
   password, Forgejo keys, admin password, Google OAuth client). Values never
   pass through OpenTofu, so they never appear in state.
2. **Connect:** `aws ssm start-session --target <instance_id>`.
3. **Tailscale:** `sudo tailscale up --auth-key <one-time key> --hostname brain`, then
   `tailscale serve` for Forgejo (3000) and the gateway (8787).
4. **Deploy:** fetch the release bundle from S3, pull the image by digest from
   ECR, and run `deploy/production/compose.sh up -d` (scripted in Phase B).
5. **Google sign-in:** `deploy/production/configure-google-sso.sh`.

## Known limits

- **State is local** to start (one operator). Before a second person applies
  changes, move state to an encrypted S3 backend with locking.
- **The Bedrock IAM condition for inference profiles** follows AWS's documented
  pattern but is verified only on the first real call (Phase C).
- **Single availability zone.** A zone outage means downtime, restored from
  backups. Acceptable for the pilot; revisit if the Brain becomes critical-path.
