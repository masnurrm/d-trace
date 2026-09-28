#!/usr/bin/env bash
#
# D-Trace — redeploy the containerized stack after setup-vm-docker.sh has
# already run once.
#
# Pulls the latest commit, rebuilds images, and only THEN touches the running
# containers: if the build or migration fails, the old containers are left
# running untouched, still serving the previous good build.
#
# Usage: sudo ./redeploy-docker.sh              (deploys $GIT_BRANCH, default main)
#        sudo GIT_BRANCH=release ./redeploy-docker.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
GIT_BRANCH="${GIT_BRANCH:-main}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$1"; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo ./redeploy-docker.sh"
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout — run setup-vm-docker.sh first."
[[ -f "$COMPOSE_DIR/env/api.env" && -f "$COMPOSE_DIR/env/web.env" ]] \
  || die "Missing ${COMPOSE_DIR}/env/*.env — run setup-vm-docker.sh first."

log "Fetch ${GIT_BRANCH}"
before_sha="$(git -C "$APP_DIR" rev-parse HEAD)"
git -C "$APP_DIR" fetch origin "$GIT_BRANCH"
after_sha="$(git -C "$APP_DIR" rev-parse "origin/$GIT_BRANCH")"

if [[ "$before_sha" == "$after_sha" ]]; then
  echo "Already at ${after_sha:0:12} — nothing to deploy."
  exit 0
fi
echo "${before_sha:0:12} -> ${after_sha:0:12}"

git -C "$APP_DIR" checkout "$GIT_BRANCH"
git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"

TLS_MODE_MARKER="$COMPOSE_DIR/nginx/conf.d/default.conf"
COMPOSE_PROFILE_ARGS=()
[[ -f "$TLS_MODE_MARKER" ]] && grep -q 'acme-challenge' "$TLS_MODE_MARKER" 2>/dev/null \
  && COMPOSE_PROFILE_ARGS=(--profile letsencrypt)

log "Build images"
(cd "$COMPOSE_DIR" && docker compose "${COMPOSE_PROFILE_ARGS[@]}" build)

log "Apply migrations"
(cd "$COMPOSE_DIR" && docker compose run --rm --no-deps api npx prisma migrate deploy)

log "Recreate containers"
(cd "$COMPOSE_DIR" && docker compose "${COMPOSE_PROFILE_ARGS[@]}" up -d --wait postgres api web nginx)

log "Health check"
ok=false
for _ in $(seq 1 30); do
  if (cd "$COMPOSE_DIR" && docker compose exec -T api node -e \
      "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1); then
    ok=true
    break
  fi
  sleep 1
done

if [[ "$ok" != true ]]; then
  warn "API did not report healthy within 30s after restart — check: (cd ${COMPOSE_DIR} && docker compose logs api)"
  exit 1
fi

# Old, now-unreferenced images pile up one per deploy otherwise.
docker image prune -f >/dev/null 2>&1 || true

echo "Deployed ${after_sha:0:12}. (cd ${COMPOSE_DIR} && docker compose logs -f api web) to watch."
