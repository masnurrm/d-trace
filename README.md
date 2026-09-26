# D-Trace

Traceability platform — accounts, roles, and an append-only audit trail of every authentication and
administrative action. Next.js frontend, NestJS backend, one shared contract package.

```
┌──────────┐   httpOnly cookies    ┌────────────────┐   Bearer token   ┌──────────────┐
│ Browser  │ ────────────────────▶ │ Next.js (BFF)  │ ───────────────▶ │  NestJS API  │
└──────────┘                       │  apps/web      │                  │  apps/api    │
                                   └────────────────┘                  └──────┬───────┘
                                            ▲                                 │
                                            │      @dtrace/shared             ▼
                                            └──── zod schemas, types ──── PostgreSQL
```

The browser never holds a token and never calls the API directly. See
[docs/FLOW.md](docs/FLOW.md) for the full request and session lifecycle.

---

## Stack

| | |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, TanStack Query, react-hook-form |
| Backend | NestJS 12 (ESM), Prisma 7, PostgreSQL 17, Argon2id, pino |
| Shared | TypeScript 6, Zod 4 |
| Tooling | npm workspaces, Vitest, oxlint, ESLint, Prettier, Docker Compose |

---

## Quick start

Requires Node **22.12+** and Docker.

```bash
npm install

# 1. database
npm run docker:up

# 2. environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# generate four DIFFERENT secrets and paste them into apps/api/.env
# (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET, SETTINGS_SECRET)
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

# 3. schema + first administrator
npm run db:migrate
npm run db:seed          # uses SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from apps/api/.env

# 4. run everything
npm run dev
```

| | |
|---|---|
| Web | http://localhost:3000 (Next picks 3001+ if the port is taken) |
| API | http://localhost:4000/api/v1 |
| API docs (dev only) | http://localhost:4000/api/docs |
| Health | http://localhost:4000/api/v1/health/ready |

The seed also creates `auditor@`, `operator@` and `viewer@dtrace.local` in development, sharing the
seed admin password, so every role can be tried without extra setup.

---

## Layout

```
D-Trace/
├── apps/
│   ├── api/                 NestJS — the authority on data and access
│   └── web/                 Next.js — UI and backend-for-frontend
├── packages/
│   └── shared/              zod schemas, types, constants shared by both
├── docs/                    architecture, flow, security, conventions, API
├── CLAUDE.md                working agreement + project memory for agents
└── docker-compose.yml       PostgreSQL for local development
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | shared (watch) + api (watch) + web, together |
| `npm run build` | builds shared → api → web in dependency order |
| `npm run typecheck` / `lint` / `test` | across every workspace |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma against the local database |
| `npm run docker:up` / `docker:down` | PostgreSQL container |
| `npm run format` | Prettier over the repo |

---

## What is already built

- **Auth** — register, login, logout, logout-everywhere, change password
- **Sessions** — short-lived JWT access tokens + rotating opaque refresh tokens with
  reuse detection (a replayed token revokes the whole family)
- **Users** — paginated, filterable list; create; update; role change; delete, with
  last-administrator and self-demotion protection
- **Audit trail** — every auth and admin action recorded with actor, IP, user agent and
  redacted context; read-only, for `ADMIN` and `AUDITOR`
- **Settings** — app identity, a scheduled header marquee, footer, and SMTP configuration with a
  test send; the SMTP password is stored encrypted and never returned, and saves are guarded
  against a stale tab overwriting someone else's change
- **Hardening** — Argon2id, account lockout, per-user rate limiting, helmet, strict CORS allow-list,
  signed httpOnly cookies, origin checking, nonce-based CSP, zod validation everywhere

---

## Documentation

| Document | Read it when |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Before writing any code here — the rules and the flow |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You want the layer-by-layer picture |
| [docs/FLOW.md](docs/FLOW.md) | You need the auth, request or error lifecycle |
| [docs/SECURITY.md](docs/SECURITY.md) | You touch auth, cookies, headers or deployment |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | You are adding an endpoint, a page or a component |
| [docs/API.md](docs/API.md) | You are calling the API |

---

## License

UNLICENSED — private project.
