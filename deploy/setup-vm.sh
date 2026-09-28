#!/usr/bin/env bash
#
# D-Trace — fresh Ubuntu 24.04 VM bootstrap.
#
# Takes a bare VM to a running app: system packages, Node.js, PostgreSQL,
# the app cloned/built, migrated, seeded, and running under systemd
# (optionally behind Nginx + Let's Encrypt).
#
# Usage (as a sudo-capable user, NOT root directly — the script re-execs
# itself with sudo where needed):
#   REPO_URL=https://github.com/<you>/d-trace.git DOMAIN=trace.example.com \
#     ./setup-vm.sh
#
# Safe to re-run: every step checks whether it already happened.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — override any of these via environment variables.
# ---------------------------------------------------------------------------
REPO_URL="${REPO_URL:-}"                       # required: git remote to clone
APP_DIR="${APP_DIR:-/opt/dtrace}"              # where the app lives on disk
APP_USER="${APP_USER:-dtrace}"                 # dedicated system user, no login shell
NODE_MAJOR="${NODE_MAJOR:-22}"                 # matches .nvmrc / package.json engines
PG_MAJOR="${PG_MAJOR:-17}"                     # matches docker-compose.yml
DB_NAME="${DB_NAME:-dtrace}"
DB_USER="${DB_USER:-dtrace}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DOMAIN="${DOMAIN:-}"                           # set to enable Nginx + HTTPS
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"      # required if DOMAIN is set
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@dtrace.local}"
ENV_DIR="/etc/dtrace"                          # secrets live outside the repo checkout
STATE_DIR="/var/lib/dtrace-setup"              # idempotency markers

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$1"; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo: sudo REPO_URL=... ./setup-vm.sh"
[[ -n "$REPO_URL" ]] || die "Set REPO_URL to your git remote, e.g. REPO_URL=git@github.com:you/d-trace.git"
if [[ -n "$DOMAIN" && -z "$LETSENCRYPT_EMAIL" ]]; then
  die "DOMAIN is set but LETSENCRYPT_EMAIL is not — certbot needs an email for renewal notices."
fi

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
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
log "Fetch / update source ($GIT_BRANCH)"
# ---------------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$GIT_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$GIT_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"
else
  sudo -u "$APP_USER" git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
fi

# ---------------------------------------------------------------------------
log "Environment files"
# ---------------------------------------------------------------------------
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

CORS_ORIGINS=$( [[ -n "$DOMAIN" ]] && echo "https://${DOMAIN}" || echo "http://localhost:${WEB_PORT}" )

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
if [[ -n "$DOMAIN" ]]; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
else
  ufw allow "${WEB_PORT}/tcp" >/dev/null
fi
ufw --force enable >/dev/null

# ---------------------------------------------------------------------------
if [[ -n "$DOMAIN" ]]; then
  log "Nginx reverse proxy + Let's Encrypt ($DOMAIN)"
  apt-get install -y nginx certbot python3-certbot-nginx

  cat > "/etc/nginx/sites-available/dtrace" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/dtrace /etc/nginx/sites-enabled/dtrace
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  certbot --nginx -d "$DOMAIN" -m "$LETSENCRYPT_EMAIL" --agree-tos --redirect --non-interactive
fi

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
echo "API:  systemctl status dtrace-api   (127.0.0.1:${API_PORT}, not public)"
echo "Web:  systemctl status dtrace-web   ($( [[ -n "$DOMAIN" ]] && echo "https://${DOMAIN}" || echo "http://<vm-ip>:${WEB_PORT}" ))"
echo "Logs: journalctl -u dtrace-api -f   /   journalctl -u dtrace-web -f"
echo "Env:  ${ENV_DIR}/  (api.env, web.env, db_password) — back these up, they are NOT in the repo"
if ! step_done db-seed-notice; then
  warn "First run: Super Admin is ${SEED_ADMIN_EMAIL} — password is SEED_ADMIN_PASSWORD in ${API_ENV}. Log in once and rotate it."
  mark_done db-seed-notice
fi
