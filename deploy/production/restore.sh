#!/usr/bin/env bash
# Restore a backup archive into a FRESH stack. Destroys the current data, so it
# requires --yes-destroy-current-data. Usage:
#   ./restore.sh backups/brain-20261126T030000Z.tar.gz --yes-destroy-current-data
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
compose() { "$dir/compose.sh" "$@"; }
archive="${1:?archive path required}"
[ "${2:-}" = "--yes-destroy-current-data" ] || { echo "Refusing: pass --yes-destroy-current-data"; exit 2; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
tar xzf "$archive" -C "$work"
(cd "$work" && grep -v '^created' manifest.txt | sha256sum -c --quiet) || { echo "Checksum mismatch: archive corrupt"; exit 1; }

compose down -v
# Postgres first, restore Forgejo's database into it.
compose up -d --no-build --wait db
compose exec -T db pg_restore -U brain -d forgejo --clean --if-exists --no-owner < "$work/forgejo.pgdump"
# Git repositories and Forgejo files.
docker volume create brain_forgejo-data >/dev/null
docker run --rm -v brain_forgejo-data:/data -v "$work":/in:ro alpine:3 \
  sh -c 'tar xzf /in/forgejo-data.tgz -C /data && chown -R 1000:1000 /data'
# Gateway and ingestion state.
docker volume create brain_gateway-data >/dev/null
docker run --rm -v brain_gateway-data:/data -v "$work":/in:ro alpine:3 \
  sh -c 'for f in gateway.db ingest.db; do [ -f /in/$f ] && cp /in/$f /data/$f; done; chown -R 1000:1000 /data'
compose up -d --no-build --wait
echo "Restored from $archive"
