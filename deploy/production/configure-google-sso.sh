#!/usr/bin/env bash
# Connect Forgejo to Google Workspace sign-in (SEC-AUTH-1/2). Idempotent.
#   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... WORKSPACE_DOMAIN=adconversion.io ./configure-google-sso.sh
# Create the OAuth client in Google Cloud Console (APIs & Services > Credentials >
# OAuth client ID > Web application) with redirect URI:
#   <FORGEJO_ROOT_URL>user/oauth2/google/callback
set -euo pipefail
: "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}" "${GOOGLE_CLIENT_SECRET:?set GOOGLE_CLIENT_SECRET}" "${WORKSPACE_DOMAIN:?set WORKSPACE_DOMAIN}"
c="${FORGEJO_CONTAINER:-brain-forgejo-1}"
fj() { docker exec -u git -e GOOGLE_CLIENT_SECRET "$c" forgejo admin auth "$@"; }

args=(--name google --provider openidConnect --key "$GOOGLE_CLIENT_ID"
  --auto-discover-url https://accounts.google.com/.well-known/openid-configuration
  --scopes openid --scopes email --scopes profile
  # Only accounts from our Google Workspace domain can sign in ("hd" claim).
  --required-claim-name hd --required-claim-value "$WORKSPACE_DOMAIN"
  # 2FA is enforced by Google Workspace, so Forgejo doesn't ask again.
  --skip-local-2fa)

id=$(fj list | awk '$2 == "google" { print $1 }')
if [ -n "$id" ]; then
  docker exec -u git -e GOOGLE_CLIENT_SECRET "$c" sh -c \
    "forgejo admin auth update-oauth --id $id $(printf '%q ' "${args[@]}") --secret \"\$GOOGLE_CLIENT_SECRET\""
  echo "Updated Google sign-in (source id $id)."
else
  docker exec -u git -e GOOGLE_CLIENT_SECRET "$c" sh -c \
    "forgejo admin auth add-oauth $(printf '%q ' "${args[@]}") --secret \"\$GOOGLE_CLIENT_SECRET\""
  echo "Added Google sign-in."
fi
cat <<'NEXT'
Next:
  1. Sign in once with your Google account; then make yourself a site admin:
       docker exec -u git brain-forgejo-1 forgejo admin user list
  2. Turn off password sign-in for the web: set FORGEJO_INTERNAL_SIGNIN=false in .env
     and run ./compose.sh up -d forgejo. Break-glass admin stays available via SSM + CLI.
NEXT
