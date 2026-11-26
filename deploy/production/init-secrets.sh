#!/usr/bin/env bash
# Creates deploy/production/.env with fresh secrets. Never overwrites.
# On AWS these values are then stored in SSM Parameter Store (SEC-DATA-4).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { echo ".env exists; leaving it alone."; exit 0; }
rand() { head -c "$1" /dev/urandom | base64 | tr -d '/+=\n' | head -c "$(( $1 * 4 / 3 ))"; }
umask 077
cat > .env <<ENV
POSTGRES_PASSWORD=$(rand 24)
FORGEJO_SECRET_KEY=$(rand 48)
FORGEJO_INTERNAL_TOKEN=$(rand 48)
FORGEJO_ROOT_URL=${FORGEJO_ROOT_URL:-http://localhost:3000/}
FORGEJO_ADMIN_USER=brain-admin
FORGEJO_ADMIN_PASSWORD=$(rand 24)
ENV
# Only for the security-gate dry run with synthetic data (wiped before real data).
if [ "${WITH_SYNTHETIC:-0}" = "1" ]; then echo "SYNTHETIC_USER_PASSWORD=$(rand 18)" >> .env; fi
echo "Created deploy/production/.env (mode 600)."
