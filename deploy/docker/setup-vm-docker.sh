#!/usr/bin/env bash
#
# D-Trace — fresh Ubuntu 24.04 VM bootstrap, Docker Compose edition.
#
# Alternative to ../setup-vm.sh (which installs Node/Postgres/Nginx directly
# on the host via systemd). This one only needs Docker itself on the host —
# postgres, api, web and nginx all run as containers. Both are kept; if the
# container stack ever breaks, the native path is still there as a fallback.
#
# Run this FROM an already-cloned checkout of the repo:
#
#   sudo git clone https://github.com/<you>/d-trace.git /opt/dtrace
#   cd /opt/dtrace
#   sudo ./deploy/docker/setup-vm-docker.sh
#
# TLS_MODE (auto-detected, or set explicitly) — same semantics as setup-vm.sh:
#   - DOMAIN set             -> "letsencrypt"
#   - DOMAIN unset (default) -> "selfsigned", cert SAN = this VM's IP
#   - TLS_MODE=none          -> plain HTTP on port 80, no cert at all
#
# Safe to re-run.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
DB_NAME="${DB_NAME:-dtrace}"
DB_USER="${DB_USER:-dtrace}"
DOMAIN="${DOMAIN:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
TLS_MODE="${TLS_MODE:-}"
SERVER_IP="${SERVER_IP:-}"
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@dtrace.local}"
STATE_DIR="/var/lib/dtrace-docker-setup"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$1"; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo ./deploy/docker/setup-vm-docker.sh"
[[ -d "$APP_DIR/.git" ]] \
  || die "$APP_DIR is not a git checkout — clone the repo first, then run this script from inside it."
[[ -f "$APP_DIR/package.json" ]] \
  || die "$APP_DIR doesn't look like the d-trace repo (no package.json)."

if [[ -n "$DOMAIN" ]]; then
  TLS_MODE="${TLS_MODE:-letsencrypt}"
else
  TLS_MODE="${TLS_MODE:-selfsigned}"
fi
[[ "$TLS_MODE" =~ ^(letsencrypt|selfsigned|none)$ ]] \
  || die "TLS_MODE must be letsencrypt, selfsigned or none (got: $TLS_MODE)"
if [[ "$TLS_MODE" == letsencrypt ]]; then
  [[ -n "$DOMAIN" ]] || die "TLS_MODE=letsencrypt needs DOMAIN set."
  [[ -n "$LETSENCRYPT_EMAIL" ]] || die "TLS_MODE=letsencrypt needs LETSENCRYPT_EMAIL set."
fi
if [[ "$TLS_MODE" == selfsigned && -z "$SERVER_IP" ]]; then
  SERVER_IP="$(hostname -I | awk '{print $1}')"
  [[ -n "$SERVER_IP" ]] || die "Could not auto-detect this VM's IP — set SERVER_IP explicitly."
fi
case "$TLS_MODE" in
  letsencrypt) PUBLIC_ORIGIN="https://${DOMAIN}" ;;
  selfsigned)  PUBLIC_ORIGIN="https://${SERVER_IP}" ;;
  none)        PUBLIC_ORIGIN="http://${SERVER_IP:-$(hostname -I | awk '{print $1}')}" ;;
esac

mkdir -p "$STATE_DIR" "$COMPOSE_DIR/env" "$COMPOSE_DIR/certs" "$COMPOSE_DIR/nginx/conf.d"
chmod 700 "$COMPOSE_DIR/env" "$COMPOSE_DIR/certs"

step_done() { [[ -f "$STATE_DIR/$1" ]]; }
mark_done() { touch "$STATE_DIR/$1"; }
gen_secret() { openssl rand -base64 48 | tr -d '\n' | tr '+/' '-_'; }

# ---------------------------------------------------------------------------
log "Docker Engine + Compose plugin"
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  echo "docker $(docker --version) already installed, skipping"
fi

# ---------------------------------------------------------------------------
log "Environment files"
# ---------------------------------------------------------------------------
POSTGRES_ENV="$COMPOSE_DIR/env/postgres.env"
if [[ ! -f "$POSTGRES_ENV" ]]; then
  DB_PASSWORD="$(gen_secret)"
  cat > "$POSTGRES_ENV" <<ENV
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=${DB_NAME}
ENV
  chmod 600 "$POSTGRES_ENV"
else
  echo "$POSTGRES_ENV already exists, leaving it alone"
fi
DB_PASSWORD="$(grep -oP '^POSTGRES_PASSWORD=\K.*' "$POSTGRES_ENV")"

API_ENV="$COMPOSE_DIR/env/api.env"
if [[ ! -f "$API_ENV" ]]; then
  cat > "$API_ENV" <<ENV
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
APP_NAME="D-Trace API"
API_PREFIX=api
API_VERSION=1

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}?schema=public"

CORS_ORIGINS=${PUBLIC_ORIGIN}

JWT_ACCESS_SECRET=$(gen_secret)
JWT_REFRESH_SECRET=$(gen_secret)
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
JWT_ISSUER=dtrace
JWT_AUDIENCE=dtrace-web

COOKIE_SECRET=$(gen_secret)
SETTINGS_SECRET=$(gen_secret)
COOKIE_SAME_SITE=lax

MAX_FAILED_LOGINS=5
LOCKOUT_MINUTES=15

THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=300

TRUST_PROXY=true
BODY_LIMIT=1mb
UPLOAD_DIR=/app/storage/uploads
UPLOAD_MAX_BYTES=15728640
LOG_LEVEL=info
SWAGGER_ENABLED=false

SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=$(gen_secret)
ENV
  chmod 600 "$API_ENV"
else
  echo "$API_ENV already exists, leaving it alone"
fi

WEB_ENV="$COMPOSE_DIR/env/web.env"
if [[ ! -f "$WEB_ENV" ]]; then
  cat > "$WEB_ENV" <<ENV
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
API_URL=http://api:4000
API_PREFIX=api
API_VERSION=1
ENV
  chmod 600 "$WEB_ENV"
else
  echo "$WEB_ENV already exists, leaving it alone"
fi

# ---------------------------------------------------------------------------
log "Nginx config"
# ---------------------------------------------------------------------------
NGINX_COMMON_WEB='
    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }'

case "$TLS_MODE" in
  letsencrypt)
    # Bootstrap in two passes: certbot needs port 80 answering the ACME
    # challenge BEFORE a cert exists, so the first pass never references one.
    if [[ ! -d "$COMPOSE_DIR/certs/live/$DOMAIN" ]]; then
      cat > "$COMPOSE_DIR/nginx/conf.d/default.conf" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
NGINX
      (cd "$COMPOSE_DIR" && docker compose up -d nginx)
      sleep 2
      (cd "$COMPOSE_DIR" && docker compose run --rm --entrypoint '' certbot \
        certbot certonly --webroot -w /var/www/certbot \
        -d "$DOMAIN" -m "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive)
    fi
    cat > "$COMPOSE_DIR/nginx/conf.d/default.conf" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name ${DOMAIN};
    ssl_certificate     /etc/nginx/certs/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/live/${DOMAIN}/privkey.pem;
${NGINX_COMMON_WEB}
}
NGINX
    ;;

  selfsigned)
    if [[ ! -f "$COMPOSE_DIR/certs/dtrace.crt" ]]; then
      openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -keyout "$COMPOSE_DIR/certs/dtrace.key" -out "$COMPOSE_DIR/certs/dtrace.crt" \
        -subj "/CN=${SERVER_IP}" \
        -addext "subjectAltName=IP:${SERVER_IP}"
      chmod 600 "$COMPOSE_DIR/certs/dtrace.key"
    fi
    cat > "$COMPOSE_DIR/nginx/conf.d/default.conf" <<NGINX
server {
    listen 80;
    server_name _;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    server_name _;
    ssl_certificate     /etc/nginx/certs/dtrace.crt;
    ssl_certificate_key /etc/nginx/certs/dtrace.key;
${NGINX_COMMON_WEB}
}
NGINX
    ;;

  none)
    cat > "$COMPOSE_DIR/nginx/conf.d/default.conf" <<NGINX
server {
    listen 80;
    server_name _;
${NGINX_COMMON_WEB}
}
NGINX
    ;;
esac

# ---------------------------------------------------------------------------
log "Build and start"
# ---------------------------------------------------------------------------
COMPOSE_PROFILE_ARGS=()
[[ "$TLS_MODE" == letsencrypt ]] && COMPOSE_PROFILE_ARGS=(--profile letsencrypt)

(cd "$COMPOSE_DIR" && docker compose "${COMPOSE_PROFILE_ARGS[@]}" build)
(cd "$COMPOSE_DIR" && docker compose up -d --wait postgres)

# ---------------------------------------------------------------------------
log "Apply migrations"
# ---------------------------------------------------------------------------
(cd "$COMPOSE_DIR" && docker compose run --rm --no-deps api npx prisma migrate deploy)

# ---------------------------------------------------------------------------
log "Seed (first run only)"
# ---------------------------------------------------------------------------
if ! step_done db-seed; then
  (cd "$COMPOSE_DIR" && docker compose run --rm --no-deps api npm run db:seed)
  (cd "$COMPOSE_DIR" && docker compose run --rm --no-deps api npm run db:seed:templates)
  mark_done db-seed
  warn "Super Admin password saved in ${API_ENV} (SEED_ADMIN_PASSWORD) — copy it out and rotate it."
else
  echo "already seeded, skipping"
fi

(cd "$COMPOSE_DIR" && docker compose "${COMPOSE_PROFILE_ARGS[@]}" up -d --wait api web nginx)

# ---------------------------------------------------------------------------
log "Firewall"
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
echo "Containers: (cd ${COMPOSE_DIR} && docker compose ps)"
case "$TLS_MODE" in
  letsencrypt) echo "Web: https://${DOMAIN}" ;;
  selfsigned)  echo "Web: https://${SERVER_IP} — browser will warn: self-signed cert, click through once" ;;
  none)        echo "Web: http://${SERVER_IP:-<vm-ip>}" ;;
esac
echo "Logs: (cd ${COMPOSE_DIR} && docker compose logs -f api web nginx)"
echo "Env:  ${COMPOSE_DIR}/env/  (api.env, web.env, postgres.env) — back these up, they are NOT in the repo"
if ! step_done db-seed-notice; then
  warn "First run: Super Admin is ${SEED_ADMIN_EMAIL} — password is SEED_ADMIN_PASSWORD in ${API_ENV}. Log in once and rotate it."
  mark_done db-seed-notice
fi
