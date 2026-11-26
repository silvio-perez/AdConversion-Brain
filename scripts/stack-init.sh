#!/usr/bin/env bash
# Creates deploy/local/.env with freshly generated local secrets. Idempotent:
# never overwrites an existing .env.
set -euo pipefail
env_file="$(dirname "$0")/../deploy/local/.env"
if [ -f "$env_file" ]; then echo "deploy/local/.env already exists; leaving it alone."; exit 0; fi
rand() { node -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('base64url'))"; }
umask 077
cat > "$env_file" <<ENV
POSTGRES_PASSWORD=$(rand 24)
FORGEJO_SECRET_KEY=$(rand 48)
FORGEJO_INTERNAL_TOKEN=$(rand 48)
FORGEJO_ADMIN_USER=brain-admin
FORGEJO_ADMIN_PASSWORD=$(rand 24)
SYNTHETIC_USER_PASSWORD=$(rand 18)
ENV
echo "Created deploy/local/.env (permissions 600)."
