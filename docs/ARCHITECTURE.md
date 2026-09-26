# Architecture

Why the pieces are arranged this way, and what each layer is allowed to do.

---

## 1. Three workspaces, one contract

```
packages/shared  ──imported by──▶  apps/api
       │                                │
       └────────imported by──────▶  apps/web
```

`@dtrace/shared` is the only package both apps depend on, and it depends on nothing but zod. It
compiles to ESM with type declarations; the apps consume the build output, not the source.

**The rule that makes this work:** shared code may not import from an app, may not read
`process.env`, and may not touch Node or DOM globals. It has to run in both runtimes.

What lives there:

| Folder | Contents |
|---|---|
| `constants/` | `ROLES` + rank ordering, `ERROR_CODES`, `AUDIT_ACTIONS` |
| `schemas/` | one zod schema per payload, plus the inferred type |
| `types/` | the `ApiResponse` envelope, `Paginated<T>` |
| `utils/` | `redact()`, `maskEmail()`, `safeEqual()` — pure functions only |

The payoff is concrete: change the password policy in `auth.schema.ts` and the register form, the
change-password form and the API endpoint all move together. They cannot drift.

---

## 2. Backend layers (apps/api)

```
main.ts                 process-level middleware, CORS, Swagger, shutdown hooks
  └─ AppModule          composition root; global guards, filter, interceptor
       ├─ config/       zod-validated env → one typed, immutable config tree
       ├─ common/       cross-cutting: decorators, guards, filters, pipes, utils
       └─ modules/
            prisma/     the only path to the database
            auth/       auth.service · token.service · password.service
            users/      CRUD, role changes, the public projection
            audit/      the trail: one writer, one read-only reader
            health/     liveness (no DB) and readiness (DB)
```

**Layer responsibilities**

| Layer | May do | May not do |
|---|---|---|
| Controller | HTTP shape: routes, status codes, cookies, decorators | business rules, Prisma calls |
| Service | business rules, Prisma calls, audit writes | touch `Request`/`Response` |
| `common/` | anything cross-cutting | know about a specific domain |
| `config/` | read `process.env` — the **only** place that may | anything else |

**Why a global guard chain rather than per-controller decorators.** Authentication that is opt-in
fails silently the day someone forgets a decorator. Here, a new route is protected the moment it
exists; making it public takes a deliberate `@Public()` that a reviewer can see in the diff.

**Why zod and not class-validator.** class-validator would mean DTO classes that duplicate what the
frontend already needs. With zod the schema is a value, so one definition can be imported by a
React form and by a Nest pipe. The `ZodValidationPipe` returns the parsed value, which also strips
undeclared fields — validation and sanitisation in one step.

---

## 3. Frontend layers (apps/web)

```
proxy.ts                session refresh · route gating · CSP nonce   (runs before everything)
  └─ app/
       (auth)/          public screens
       (app)/           authenticated screens; the layout is the auth boundary
       api/auth/*       route handlers that mint and clear session cookies
       api/bff/*        authenticated proxy for client components
  ├─ components/ui/     the design system
  ├─ components/<domain>/ feature components
  └─ lib/
       api/             server.ts (server components) · client.ts (browser)
       auth/            cookie helpers · refresh
       config/          zod-validated, server-only env
       query/           TanStack Query provider + key registry
```

**Server components by default.** A page fetches its own data during render, so the HTML arrives
complete: no loading flash, no request waterfall, and no token in the client bundle. A component
becomes `'use client'` only when it needs interaction, and stays as small as possible when it does.

**Why the app is a BFF.** If the browser called the API directly it would need the token in
JavaScript, which means `localStorage` or a readable cookie, which means an XSS bug becomes a
permanent account takeover. Routing through this server keeps the credential out of reach and gives
one place to add per-user caching, aggregation or rate limiting later.

**Two clients, one contract.** `apiFetch` (server) and `clientFetch` (browser) differ only in how
they authenticate; both unwrap the same envelope and raise a typed error carrying the API's stable
`code`.

---

## 4. Data model

```
User 1───∞ Session          (cascade delete: sessions die with the user)
  │
  └──1───∞ AuditLog         (SET NULL: the trail outlives the user)
```

| Table | Notes |
|---|---|
| `users` | `passwordHash`, lockout counters and `passwordChangedAt` never leave the server |
| `sessions` | one row per issued refresh token: `tokenHash` (HMAC), `familyId`, `revokedAt`, `replacedById` |
| `audit_logs` | append-only; denormalised `actorEmail` so the record survives a deleted actor |

Indexes follow the access patterns: `(action, createdAt)` and `(actorId, createdAt)` for the trail,
`role` / `isActive` / `createdAt` for the user list, `familyId` and `expiresAt` for session cleanup.

The `Role` enum exists twice — in `schema.prisma` and in `@dtrace/shared` — because neither side can
import the other. They must be changed together; `CLAUDE.md` names this explicitly.

---

## 5. Reuse, concretely

Every one of these exists so a second implementation never gets written:

| Mechanism | Where | Replaces |
|---|---|---|
| Zod schemas | `@dtrace/shared` | duplicated DTOs and form rules |
| `paginate()` | `common/utils/pagination.ts` | per-module page/limit/count/meta code |
| `USER_PUBLIC_SELECT` | `modules/users/user.select.ts` | ad-hoc `select` blocks that eventually leak a column |
| `AppException` factories | `common/exceptions` | hand-rolled `throw new HttpException(...)` |
| `ResponseInterceptor` + `AllExceptionsFilter` | `common/` | per-controller response shaping |
| `apiFetch` / `clientFetch` | `web/src/lib/api` | scattered `fetch` calls with hand-attached headers |
| `DataTable` / `PaginationBar` | `web/src/components/ui` | a second table implementation per screen |
| `cva` variants + `cn()` | `web/src/components/ui` | copy-pasted Tailwind strings |
| `queryKeys` | `web/src/lib/query/keys.ts` | keys built inline that fail to invalidate each other |

---

## 6. Decisions and their trade-offs

| Decision | Alternative | Why this one |
|---|---|---|
| npm workspaces | pnpm / Turborepo / Nx | Zero extra tooling; the repo is three packages, not thirty |
| BFF pattern | Direct browser → API | Keeps tokens out of JavaScript entirely |
| Opaque refresh tokens | Refresh JWTs | Revocable; a JWT cannot be withdrawn before it expires |
| HMAC-stored tokens | Plaintext / Argon2 | A DB dump is useless without the pepper; lookup stays one indexed query |
| Prisma | TypeORM / Drizzle | Typed client generated from the schema; migrations included |
| Response envelope | Bare JSON | One parse path, and a `requestId` on every response for support |
| `@node-rs/argon2` | `argon2` (node-gyp) | Prebuilt native binaries; no build toolchain on Windows |
| Global guards | Per-route decorators | Deny by default; forgetting a decorator cannot open a hole |
| URL-based filters | Component state | Shareable links, working back button, server-rendered results |

---

## 7. Deliberate gaps

Real, and named rather than hidden: no email verification or password reset (both need a mail
provider), no MFA, no file uploads, no i18n, no real-time updates, and rate limiting is in-memory so
it does not hold across multiple instances. [SECURITY.md §10](SECURITY.md) lists what to add before
a production deployment.
