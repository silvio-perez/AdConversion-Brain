#!/usr/bin/env bash
# Checks that this machine can develop AdConversion Brain. Read-only: it never
# installs anything. Run with: pnpm env:check
set -u
fail=0
ok()   { printf "  \033[32mOK\033[0m    %s\n" "$1"; }
bad()  { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; fail=1; }
warn() { printf "  \033[33mWARN\033[0m  %s\n" "$1"; }

echo "AdConversion Brain: environment check"

if command -v git >/dev/null; then ok "git $(git --version | awk '{print $3}')"; else bad "git not installed"; fi

if command -v node >/dev/null; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -ge 22 ]; then ok "node $(node --version)"; else bad "node $(node --version): need >= 22 (see .nvmrc)"; fi
else bad "node not installed (need >= 22)"; fi

if command -v pnpm >/dev/null; then ok "pnpm $(pnpm --version)"; else bad "pnpm missing: run 'corepack enable'"; fi

if command -v docker >/dev/null; then
  if docker info >/dev/null 2>&1; then ok "docker engine running"
  else warn "docker installed but engine not running (needed from Milestone 1)"; fi
else warn "docker not installed (needed from Milestone 1)"; fi

if [ "$fail" -ne 0 ]; then echo "Fix the FAIL items above."; exit 1; fi
echo "Ready."
