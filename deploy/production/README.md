# Production deployment files

| File | Purpose |
|---|---|
| `Dockerfile` | App image (gateway, admin CLI, ingestion), built from source |
| `docker-compose.yml` | Production stack: internal-only data network, inbound/outbound edges |
| `Caddyfile` / `squid.conf` / `allowlist.txt` | Inbound proxy / outbound allowlist proxy |
| `init-secrets.sh` | Generates `.env` (git-ignored). On AWS, values come from SSM `/brain/*`. |
| `compose.sh` | `docker compose` with the production files and secrets |
| `brain-admin.sh` | Admin CLI inside the gateway container (admin credentials per command) |
| `configure-google-sso.sh` | Google Workspace sign-in for Forgejo |
| `backup.sh` / `restore.sh` | Nightly backup to S3; checksum-verified restore into a fresh stack |
| `egress-drill.sh` | Security-gate drill: data services can't reach the internet |

## Ingestion and AWS credentials

Containers sit on a network with no route out, and the server's metadata
service allows one network hop, so **no container can obtain the server's AWS
credentials**. The hourly ingestion job is the one container that needs them
(to call Bedrock). The host fetches short-lived credentials and passes them to
that single run:

```bash
creds=$(aws configure export-credentials --format env-no-export)
env $creds ./compose.sh run --rm \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN ingest
```

The credentials expire within hours, and they only allow what the server role
allows: invoking the approved Claude models, adding backups, and reading releases.
