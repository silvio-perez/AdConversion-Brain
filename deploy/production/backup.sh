#!/usr/bin/env bash
# Nightly backup (SEC-DATA-3). Produces one archive containing:
#   forgejo.pgdump      Postgres (Forgejo metadata: users, teams, PRs, reviews)
#   forgejo-data.tgz    Git repositories and Forgejo files
#   gateway.db          gateway tokens, audit log, index (consistent SQLite copy)
#   ingest.db           ingestion state
#   manifest.txt        what's inside + checksums
# Forgejo is paused for a few seconds so Git and Postgres are captured at the
# same moment. Uploads to S3 when BACKUP_S3_URI is set (server-side KMS encryption).
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
compose() { "$dir/compose.sh" "$@"; }
out_dir="${BACKUP_DIR:-$dir/backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'compose unpause forgejo >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
mkdir -p "$out_dir"

# Consistent SQLite copies via VACUUM INTO (safe while the gateway is running).
compose exec -T gateway node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const fs = require("node:fs");
  for (const [src, dst] of [["/data/gateway.db", "/tmp/gateway.db"], ["/data/ingest.db", "/tmp/ingest.db"]]) {
    fs.rmSync(dst, { force: true });
    if (fs.existsSync(src)) new DatabaseSync(src).prepare("VACUUM INTO ?").run(dst);
  }'
for f in gateway.db ingest.db; do
  compose exec -T gateway sh -c "[ -f /tmp/$f ] && cat /tmp/$f" > "$work/$f" 2>/dev/null || rm -f "$work/$f"
done

compose pause forgejo >/dev/null
compose exec -T db pg_dump -U brain -d forgejo --format=custom > "$work/forgejo.pgdump"
docker run --rm -v brain_forgejo-data:/data:ro -v "$work":/out alpine:3 \
  tar czf /out/forgejo-data.tgz -C /data . 2>/dev/null
compose unpause forgejo >/dev/null

(cd "$work" && sha256sum * > manifest.txt && echo "created $stamp" >> manifest.txt)
archive="$out_dir/brain-$stamp.tar.gz"
tar czf "$archive" -C "$work" .
echo "Backup written: $archive ($(du -h "$archive" | cut -f1))"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$archive" "$BACKUP_S3_URI/" --sse aws:kms --only-show-errors
  echo "Uploaded to $BACKUP_S3_URI/"
fi
# Keep the last 7 local copies; S3 lifecycle rules handle long-term retention.
ls -1t "$out_dir"/brain-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
