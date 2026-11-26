#!/usr/bin/env bash
# docker compose with the production files and secrets. Usage: ./compose.sh up -d
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
envs=(--env-file "$dir/.env")
[ -f "$dir/gateway.env" ] && envs+=(--env-file "$dir/gateway.env")
exec docker compose -f "$dir/docker-compose.yml" "${envs[@]}" "$@"
