#!/usr/bin/env bash
# Admin CLI inside the running gateway container, e.g.
#   ./brain-admin.sh token create --owner alice --harness claude-code --sources ...
#   ./brain-admin.sh token recheck
# Forgejo admin credentials are passed in for this one command only; the
# long-running gateway never holds them.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$dir/.env"; set +a
exec "$dir/compose.sh" exec -T \
  -e FORGEJO_ADMIN_USER="$FORGEJO_ADMIN_USER" -e FORGEJO_ADMIN_PASSWORD="$FORGEJO_ADMIN_PASSWORD" \
  gateway node --disable-warning=ExperimentalWarning apps/gateway/src/cli.ts "$@"
