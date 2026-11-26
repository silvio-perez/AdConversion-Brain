#!/bin/bash
# First boot only. Installs the runtime; the app is deployed separately
# (release bundle from S3 + image from ECR). No secrets here.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 unattended-upgrades unzip jq
systemctl enable --now docker

# OS security patches install automatically (approved exception to SEC-SUP-4);
# application images stay pinned.
cat > /etc/apt/apt.conf.d/52brain-unattended <<'CONF'
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-security"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF

# AWS CLI v2 (backups to S3, SSM parameters, ECR login).
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip

# Tailscale from its signed apt repository. Joining the tailnet needs an auth
# key, done manually over SSM after boot (README step 4).
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] https://pkgs.tailscale.com/stable/ubuntu noble main" > /etc/apt/sources.list.d/tailscale.list
apt-get update && apt-get install -y tailscale

mkdir -p /opt/brain
