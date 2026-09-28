#!/usr/bin/env bash
#
# D-Trace — redeploy the app after `setup-vm.sh` has already run once.
#
# Pulls the latest commit, rebuilds, and only THEN touches the running
# services: if the build or migration fails, dtrace-api/dtrace-web are left
# exactly as they were, still serving the previous good build.
#
# Usage: sudo ./redeploy.sh              (deploys $GIT_BRANCH, default main)
#        sudo GIT_BRANCH=release ./redeploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
APP_USER="${APP_USER:-dtrace}"
GIT_BRANCH="${GIT_BRANCH:-main}"
ENV_DIR="/etc/dtrace"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$1"; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo ./redeploy.sh"
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout — run setup-vm.sh first."
[[ -f "$ENV_DIR/api.env" && -f "$ENV_DIR/web.env" ]] \
  || die "Missing ${ENV_DIR}/api.env or web.env — run setup-vm.sh first."

# Same check setup-vm.sh applies after a fresh build: a build that exits 0 but
# leaves stale or missing output is worse than one that fails loudly.
verify_build() {
  [[ -f "$APP_DIR/apps/api/dist/main.js" ]] \
    || die "Build did not produce apps/api/dist/main.js — aborting, services untouched."
  [[ -f "$APP_DIR/apps/web/.next/BUILD_ID" ]] \
    || die "Build did not produce apps/web/.next/BUILD_ID — aborting, services untouched."
  local build_age
  build_age=$(( $(date +%s) - $(stat -c %Y "$APP_DIR/apps/web/.next/BUILD_ID") ))
  if (( build_age > 600 )); then
    die "apps/web/.next/BUILD_ID is $((build_age / 60)) minutes old — this build did not actually run, aborting."
  fi
}

log "Fetch ${GIT_BRANCH}"
before_sha="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"
sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$GIT_BRANCH"
after_sha="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse "origin/$GIT_BRANCH")"

if [[ "$before_sha" == "$after_sha" ]]; then
  echo "Already at ${after_sha:0:12} — nothing to deploy."
  exit 0
fi
echo "${before_sha:0:12} -> ${after_sha:0:12}"

sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$GIT_BRANCH"
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"

log "Install dependencies and build"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci"
# Turbopack's persistent build cache (apps/web/.next/cache) survives across
# redeploys for speed, but a route's static/dynamic classification changing
# between deploys has been observed to leave it in an inconsistent state —
# a stale/missing client reference manifest for a route that build otherwise
# reports as successful. A full build is slower but always correct.
sudo -u "$APP_USER" rm -rf "$APP_DIR/apps/web/.next"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm run build"
verify_build

log "Apply migrations"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR/apps/api' && npx prisma migrate deploy"

log "Restart services"
systemctl restart dtrace-api
systemctl restart dtrace-web

log "Health check"
ok=false
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$(grep -oP '^PORT=\K.*' "$ENV_DIR/api.env")/api/v1/health/ready" >/dev/null 2>&1; then
    ok=true
    break
  fi
  sleep 1
done

if [[ "$ok" != true ]]; then
  warn "API did not report healthy within 30s after restart — check: journalctl -u dtrace-api -n 50"
  exit 1
fi

echo "Deployed ${after_sha:0:12}. journalctl -u dtrace-api -f / -u dtrace-web -f to watch."
