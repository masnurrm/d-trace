#!/usr/bin/env bash
#
# D-Trace — fresh Ubuntu 24.04 VM bootstrap.
#
# Run this FROM an already-cloned checkout of the repo (not standalone):
#
#   sudo git clone https://github.com/<you>/d-trace.git /opt/dtrace
#   cd /opt/dtrace
#   sudo ./deploy/setup-vm.sh
#
# Takes that checkout to a running app: system packages, Node.js, PostgreSQL,
# built, migrated, seeded, and running under systemd, behind Nginx on 443.
# For every deploy after this first one, use ./deploy/redeploy.sh instead —
# it pulls, rebuilds and restarts in place.
#
# TLS_MODE picks how HTTPS is terminated (auto-detected, or set explicitly):
#   - DOMAIN set            -> "letsencrypt": real CA cert for that domain.
#       sudo DOMAIN=trace.example.com LETSENCRYPT_EMAIL=you@example.com ./deploy/setup-vm.sh
#   - DOMAIN unset (default) -> "selfsigned": browsers will warn "not secure"
#     and need a one-time click-through, but traffic is still encrypted.
#     This is what you get accessing the app as https://<vm-ip> — Let's
#     Encrypt flatly refuses to certify a bare IP address, only real domains
#     it can verify over DNS, so a trusted cert isn't possible without one.
#   - TLS_MODE=none          -> plain HTTP on $WEB_PORT, no Nginx at all.
#
# Safe to re-run: every step checks whether it already happened.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# ---------------------------------------------------------------------------
# Configuration — override any of these via environment variables.
# ---------------------------------------------------------------------------
APP_DIR="${APP_DIR:-$REPO_ROOT}"               # defaults to the checkout this script lives in
APP_USER="${APP_USER:-dtrace}"                 # dedicated system user, no login shell
NODE_MAJOR="${NODE_MAJOR:-22}"                 # matches .nvmrc / package.json engines
PG_MAJOR="${PG_MAJOR:-17}"                     # matches docker-compose.yml
DB_NAME="${DB_NAME:-dtrace}"
DB_USER="${DB_USER:-dtrace}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
DOMAIN="${DOMAIN:-}"                           # set for a real Let's Encrypt cert
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"      # required if DOMAIN is set
TLS_MODE="${TLS_MODE:-}"                       # letsencrypt | selfsigned | none — see header
SERVER_IP="${SERVER_IP:-}"                     # self-signed cert SAN; auto-detected if unset
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@dtrace.local}"
ENV_DIR="/etc/dtrace"                          # secrets live outside the repo checkout
STATE_DIR="/var/lib/dtrace-setup"              # idempotency markers

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$1"; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo ./deploy/setup-vm.sh"
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
  [[ -n "$LETSENCRYPT_EMAIL" ]] || die "TLS_MODE=letsencrypt needs LETSENCRYPT_EMAIL set (certbot requires it for renewal notices)."
fi
if [[ "$TLS_MODE" == selfsigned && -z "$SERVER_IP" ]]; then
  SERVER_IP="$(hostname -I | awk '{print $1}')"
  [[ -n "$SERVER_IP" ]] || die "Could not auto-detect this VM's IP — set SERVER_IP explicitly."
fi

case "$TLS_MODE" in
  letsencrypt) PUBLIC_ORIGIN="https://${DOMAIN}" ;;
  selfsigned)  PUBLIC_ORIGIN="https://${SERVER_IP}" ;;
  none)        PUBLIC_ORIGIN="http://localhost:${WEB_PORT}" ;;
esac

mkdir -p "$STATE_DIR" "$ENV_DIR"
chmod 700 "$ENV_DIR"

step_done() { [[ -f "$STATE_DIR/$1" ]]; }
mark_done() { touch "$STATE_DIR/$1"; }

gen_secret() { openssl rand -base64 48 | tr -d '\n' | tr '+/' '-_'; }

# Build output is the one thing that silently rots: an old dist/.next left over
# from a failed build looks identical to a fresh one until systemd starts the
# stale code. Every build is followed by this check before anything restarts.
verify_build() {
  [[ -f "$APP_DIR/apps/api/dist/main.js" ]] \
    || die "Build did not produce apps/api/dist/main.js — check the build log above."
  [[ -f "$APP_DIR/apps/web/.next/BUILD_ID" ]] \
    || die "Build did not produce apps/web/.next/BUILD_ID — check the build log above."
  # The BUILD_ID must be fresh: catches a build that exited 0 but skipped the
  # workspace (e.g. a cached turbo/next run reusing yesterday's output).
  local build_age
  build_age=$(( $(date +%s) - $(stat -c %Y "$APP_DIR/apps/web/.next/BUILD_ID") ))
  if (( build_age > 600 )); then
    die "apps/web/.next/BUILD_ID is $((build_age / 60)) minutes old — this build did not actually run."
  fi
}

# ---------------------------------------------------------------------------
log "System packages"
# ---------------------------------------------------------------------------
if ! step_done apt-base; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git build-essential ufw \
    software-properties-common
  mark_done apt-base
else
  echo "already done, skipping"
fi

# ---------------------------------------------------------------------------
log "Node.js ${NODE_MAJOR}.x"
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "node $(node -v) already installed, skipping"
fi
node -v
npm -v

# ---------------------------------------------------------------------------
log "PostgreSQL ${PG_MAJOR}"
# ---------------------------------------------------------------------------
if ! command -v psql >/dev/null 2>&1 || ! pg_lsclusters 2>/dev/null | grep -q "^${PG_MAJOR} "; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y "postgresql-${PG_MAJOR}"
else
  echo "postgresql-${PG_MAJOR} already installed, skipping"
fi
systemctl enable --now postgresql

# ---------------------------------------------------------------------------
log "Database role and schema"
# ---------------------------------------------------------------------------
if ! step_done db-role; then
  DB_PASSWORD="$(gen_secret)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL
  echo "$DB_PASSWORD" > "$ENV_DIR/db_password"
  chmod 600 "$ENV_DIR/db_password"
  mark_done db-role
else
  echo "already done, skipping (password kept in ${ENV_DIR}/db_password)"
fi
DB_PASSWORD="$(cat "$ENV_DIR/db_password")"

# Local-only: never expose 5432 beyond the box.
sed -i "s/^#listen_addresses.*/listen_addresses = 'localhost'/" \
  "/etc/postgresql/${PG_MAJOR}/main/postgresql.conf" 2>/dev/null || true
systemctl restart postgresql

# ---------------------------------------------------------------------------
log "App user (${APP_USER})"
# ---------------------------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
else
  echo "already exists, skipping"
fi

# ---------------------------------------------------------------------------
log "Hand the checkout at ${APP_DIR} to ${APP_USER}"
# ---------------------------------------------------------------------------
# systemd runs the app as $APP_USER, and redeploy.sh later does `git fetch` /
# `npm ci` as that same user — it needs to own the checkout, not just read it.
git config --global --add safe.directory "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
log "Environment files"
# ---------------------------------------------------------------------------
# ENV_DIR was created (mkdir) as root, mode 700 — a file inside owned by
# $APP_USER is still unreadable to $APP_USER until the *directory* itself is
# also owned by $APP_USER, since traversal is checked at each path segment.
# Unconditional so a re-run also fixes a checkout provisioned before this.
chown "$APP_USER:$APP_USER" "$ENV_DIR"

API_ENV="$ENV_DIR/api.env"
if [[ ! -f "$API_ENV" ]]; then
  cat > "$API_ENV" <<ENV
NODE_ENV=production
PORT=${API_PORT}
HOST=127.0.0.1
APP_NAME="D-Trace API"
API_PREFIX=api
API_VERSION=1

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"

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
UPLOAD_DIR=${APP_DIR}/storage/uploads
UPLOAD_MAX_BYTES=15728640
LOG_LEVEL=info
SWAGGER_ENABLED=false

SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=$(gen_secret)
ENV
  chmod 600 "$API_ENV"
  chown "$APP_USER:$APP_USER" "$API_ENV"
else
  echo "$API_ENV already exists, leaving it alone"
fi

WEB_ENV="$ENV_DIR/web.env"
if [[ ! -f "$WEB_ENV" ]]; then
  cat > "$WEB_ENV" <<ENV
NODE_ENV=production
PORT=${WEB_PORT}
API_URL=http://127.0.0.1:${API_PORT}
API_PREFIX=api
API_VERSION=1
ENV
  chmod 600 "$WEB_ENV"
  chown "$APP_USER:$APP_USER" "$WEB_ENV"
else
  echo "$WEB_ENV already exists, leaving it alone"
fi

ln -sf "$API_ENV" "$APP_DIR/apps/api/.env"
ln -sf "$WEB_ENV" "$APP_DIR/apps/web/.env"

# ---------------------------------------------------------------------------
log "Install dependencies and build"
# ---------------------------------------------------------------------------
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci"
# See redeploy.sh: a stale Turbopack build cache has been observed to break
# a route's client reference manifest after its dynamic/static classification
# changes, so every build starts clean rather than trusting the cache.
sudo -u "$APP_USER" rm -rf "$APP_DIR/apps/web/.next"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm run build"
verify_build

# ---------------------------------------------------------------------------
log "Apply migrations"
# ---------------------------------------------------------------------------
sudo -u "$APP_USER" bash -c "cd '$APP_DIR/apps/api' && npx prisma migrate deploy"

# ---------------------------------------------------------------------------
log "Seed (first run only)"
# ---------------------------------------------------------------------------
if ! step_done db-seed; then
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/apps/api' && npm run db:seed"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR/apps/api' && npm run db:seed:templates"
  mark_done db-seed
  warn "Super Admin password saved in ${API_ENV} (SEED_ADMIN_PASSWORD) — copy it out and rotate it."
else
  echo "already seeded, skipping"
fi

mkdir -p "$APP_DIR/storage/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/storage"

# ---------------------------------------------------------------------------
log "systemd services"
# ---------------------------------------------------------------------------
cat > /etc/systemd/system/dtrace-api.service <<UNIT
[Unit]
Description=D-Trace API (NestJS)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/apps/api
EnvironmentFile=${API_ENV}
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}/storage
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/dtrace-web.service <<UNIT
[Unit]
Description=D-Trace Web (Next.js)
After=network.target dtrace-api.service
Requires=dtrace-api.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/apps/web
EnvironmentFile=${WEB_ENV}
ExecStart=/usr/bin/npx next start -p ${WEB_PORT}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
# Next's own image-optimization cache (next/image) writes here at runtime —
# without it listed, ProtectSystem=strict makes the whole tree read-only and
# every optimized image fails its write with ENOENT, retrying on every request.
ReadWritePaths=${APP_DIR}/apps/web/.next/cache
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now dtrace-api dtrace-web

# ---------------------------------------------------------------------------
log "Firewall"
# ---------------------------------------------------------------------------
ufw allow OpenSSH >/dev/null
if [[ "$TLS_MODE" == none ]]; then
  ufw allow "${WEB_PORT}/tcp" >/dev/null
else
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
ufw --force enable >/dev/null

# ---------------------------------------------------------------------------
NGINX_COMMON='
    location / {
        proxy_pass http://127.0.0.1:__WEB_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }'
NGINX_COMMON="${NGINX_COMMON//__WEB_PORT__/$WEB_PORT}"

if [[ "$TLS_MODE" == letsencrypt ]]; then
  log "Nginx reverse proxy + Let's Encrypt ($DOMAIN)"
  apt-get install -y nginx certbot python3-certbot-nginx

  cat > "/etc/nginx/sites-available/dtrace" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
${NGINX_COMMON}
}
NGINX
  ln -sf /etc/nginx/sites-available/dtrace /etc/nginx/sites-enabled/dtrace
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  certbot --nginx -d "$DOMAIN" -m "$LETSENCRYPT_EMAIL" --agree-tos --redirect --non-interactive

elif [[ "$TLS_MODE" == selfsigned ]]; then
  log "Nginx reverse proxy + self-signed cert (https://${SERVER_IP})"
  apt-get install -y nginx

  CERT_DIR=/etc/nginx/ssl
  mkdir -p "$CERT_DIR"
  chmod 700 "$CERT_DIR"
  if [[ ! -f "$CERT_DIR/dtrace.crt" ]]; then
    # SAN carries the IP explicitly — without it, modern browsers reject the
    # cert outright (an "not secure, click through" warning turns into a hard
    # block) because they no longer trust a bare CN match.
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$CERT_DIR/dtrace.key" -out "$CERT_DIR/dtrace.crt" \
      -subj "/CN=${SERVER_IP}" \
      -addext "subjectAltName=IP:${SERVER_IP}"
    chmod 600 "$CERT_DIR/dtrace.key"
  fi

  cat > "/etc/nginx/sites-available/dtrace" <<NGINX
server {
    listen 80;
    server_name _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     ${CERT_DIR}/dtrace.crt;
    ssl_certificate_key ${CERT_DIR}/dtrace.key;
${NGINX_COMMON}
}
NGINX
  ln -sf /etc/nginx/sites-available/dtrace /etc/nginx/sites-enabled/dtrace
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
echo "API:  systemctl status dtrace-api   (127.0.0.1:${API_PORT}, not public)"
case "$TLS_MODE" in
  letsencrypt) echo "Web:  systemctl status dtrace-web   (https://${DOMAIN})" ;;
  selfsigned)  echo "Web:  systemctl status dtrace-web   (https://${SERVER_IP} — browser will warn: self-signed cert, click through once)" ;;
  none)        echo "Web:  systemctl status dtrace-web   (http://<vm-ip>:${WEB_PORT})" ;;
esac
echo "Logs: journalctl -u dtrace-api -f   /   journalctl -u dtrace-web -f"
echo "Env:  ${ENV_DIR}/  (api.env, web.env, db_password) — back these up, they are NOT in the repo"
if ! step_done db-seed-notice; then
  warn "First run: Super Admin is ${SEED_ADMIN_EMAIL} — password is SEED_ADMIN_PASSWORD in ${API_ENV}. Log in once and rotate it."
  mark_done db-seed-notice
fi
