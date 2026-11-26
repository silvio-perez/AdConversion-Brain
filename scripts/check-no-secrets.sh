#!/usr/bin/env bash
# Fails if a secrets file is tracked or staged in Git (SEC-DATA-4).
# Covers env files, private keys and local databases/backups.
set -euo pipefail
files=$( (git ls-files; git diff --cached --name-only) | sort -u)
bad=$(echo "$files" | grep -E '(^|/)(\.env|[^/]+\.env)$|\.pem$|\.key$|(^|/)id_(rsa|ed25519)$|\.db$|\.db-(wal|shm)$|(^|/)backups/' | grep -v '\.example$' || true)
if [ -n "$bad" ]; then
  echo "Secrets check FAILED: these files must not be in Git:"; echo "$bad" | sed 's/^/  /'
  exit 1
fi
echo "Secrets check passed ($(echo "$files" | wc -l | tr -d ' ') files)."
