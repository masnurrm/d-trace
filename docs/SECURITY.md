# Security

What is implemented, why it was chosen, and what is deliberately left to the deployment.
Written to be reviewable: every claim below corresponds to code you can open.

---

## 1. Threat model in one paragraph

D-Trace holds accounts, roles and an audit trail — the value to an attacker is impersonating a
privileged user and then erasing the evidence. The design therefore assumes a token *will* leak
eventually, and spends its effort on making a leaked token short-lived, revocable and detectable,
rather than on pretending leaks do not happen.

---

## 2. Passwords

| Decision | Where | Why |
|---|---|---|
| Argon2id, 19 MiB / t=2 / p=1 | `apps/api/src/modules/auth/password.service.ts` | OWASP 2024 baseline. Memory-hard, so GPU cracking is expensive |
| Per-hash salt (library default) | same | Identical passwords produce different digests |
| Minimum 12 characters, mixed case + digit | `packages/shared/src/schemas/auth.schema.ts` | Length weighted over exotic character classes, per NIST |
| Dummy hash on unknown email | `auth.service.ts` → `dummyVerify()` | Equal response timing; otherwise login enumerates accounts |
| Lockout after `MAX_FAILED_LOGINS` for `LOCKOUT_MINUTES` | `auth.service.ts` → `registerFailedAttempt()` | Caps online guessing per account |
| Password change revokes every session | `auth.service.ts` → `changePassword()` | If the old password leaked, so did the sessions it created |

Hashes are never selected into a response: `USER_PUBLIC_SELECT` is an allow-list.

---

## 3. Tokens and sessions

| | Access token | Refresh token |
|---|---|---|
| Type | JWT (HS256), stateless | Opaque, 48 random bytes |
| Lifetime | 15 min (`JWT_ACCESS_TTL`) | 7 days (`JWT_REFRESH_TTL`) |
| Stored | httpOnly cookie on the **web** origin | httpOnly + **signed** cookie; DB row holds an HMAC |
| Revocable | no (short by design) | yes, individually or by family |
| Carries | `sub`, `role`, `sid` — no PII | nothing; it is a lookup key |

- **Refresh tokens are not JWTs.** A JWT cannot be revoked before it expires, and revocation is the
  entire point of a refresh token.
- **Stored as `HMAC-SHA256(token, JWT_REFRESH_SECRET)`** (`common/utils/crypto.ts`). A database dump
  alone is not replayable without the application secret. Argon2 would be wrong here: the token
  already has 384 bits of entropy, so there is nothing to brute force.
- **Rotation on every refresh**, inside one transaction, with `replacedById` recording the chain.
- **Reuse detection**: presenting a revoked token revokes the whole family. Verified.
- **Separate secrets**, enforced in production by `env.schema.ts` — the access secret and the refresh
  pepper must differ.
- Rotating `JWT_REFRESH_SECRET` invalidates every session, by construction.

---

## 4. Where tokens live (and why the browser has none)

The Next.js app is a backend-for-frontend. Tokens stop at its server process:

- `dtrace_at` / `dtrace_rt` — `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`
- The login response body contains **only** the user profile
- Client components call `/api/bff/*`, which attaches the token server-side

Consequence: an XSS bug is bad but not catastrophic — an attacker can act as the page while it is
open, but cannot exfiltrate a credential and replay it later. `localStorage` is not used for
anything auth-related, anywhere.

The API's own refresh cookie is **signed** (`cookie-parser` with `COOKIE_SECRET`), so a forged
cookie is rejected before any database lookup.

---

## 5. Authorization

- **Deny by default**: `JwtAuthGuard` is global; a route without `@Public()` requires a valid token.
  Forgetting a decorator locks a route down rather than opening one up.
- **Rate limits are charged to an identity, not an address.** Because the BFF is the API's only
  caller, every authenticated request shares one source address; `UserThrottlerGuard` therefore keys
  on the user id, and only unauthenticated routes (sign-in, refresh) fall back to the address. The
  trade-off is that a flood of invalid tokens reaches JWT verification before the limiter — an HMAC
  comparison with no database access. Coarse per-address limiting belongs at the edge proxy.
- `@Roles(...)` for an explicit set, `@MinRole(...)` for "this rank or above", ranks defined once in
  `@dtrace/shared`.
- **No privilege escalation**: `assertCanAssignRole()` refuses to grant a role above the caller's own.
- **No self-lockout**: the last active administrator cannot be demoted or deleted; an admin cannot
  remove their own admin role or delete their own account.
- **Role changes and deactivations revoke sessions**, because an issued access token still carries
  the old role until it expires.
- UI role checks (`visibleNavItems`) are presentation only. The API re-checks everything.

### Stored secrets

The SMTP password is the only secret the application must be able to *recover* rather than merely
verify, so it is encrypted (AES-256-GCM, key derived from `SETTINGS_SECRET` with scrypt) rather than
hashed — see `common/utils/secret-box.ts`. Consequences, all deliberate:

- the ciphertext never leaves `SettingsService`; the API returns `hasPassword: boolean`;
- a tampered value fails to decrypt instead of silently producing garbage (the GCM auth tag);
- rotating `SETTINGS_SECRET` makes stored passwords unreadable, which is the intended blast radius:
  the operator re-enters it, and the failure is logged in one clear line.

---

## 6. Input handling

- One zod schema per payload in `@dtrace/shared`, used by the form **and** the endpoint.
- `ZodValidationPipe` returns the *parsed* value, so undeclared fields are stripped — mass assignment
  is impossible by construction rather than by review.
- Sorting uses an `allowedSortFields` allow-list in `paginate()`; `?sortBy=passwordHash` is rejected
  rather than executed.
- Pagination is capped at 100 items per page.
- Body size is capped (`BODY_LIMIT`, default 1 MB) on the API and on the BFF proxy.
- Prisma parameterises every query; there is no raw SQL except `SELECT 1` in the health probe.

---

## 7. Transport and browser hardening

**API** (`apps/api/src/main.ts`)

| Control | Setting |
|---|---|
| helmet | CSP `default-src 'none'`, `frame-ancestors 'none'`, `referrer-policy: no-referrer` |
| HSTS | 1 year, `includeSubDomains`, `preload` — production only |
| CORS | exact-origin allow-list from `CORS_ORIGINS`, `credentials: true`, never a reflected wildcard |
| Origin check | non-GET requests carrying a foreign `Origin`/`Referer` are rejected (CSRF defence in depth) |
| Rate limit | one bucket, 300/min **per user per route**, overridden at the credential routes with `@Throttle`: login 10/min, refresh 60/min, register and change-password 5/10 min — all keyed by address while unauthenticated. Health probes are exempt. A second *named* throttler is deliberately not registered: every registered throttler is evaluated on every request, so it would cap the whole API |
| `x-powered-by` | disabled |
| Proxy trust | off unless `TRUST_PROXY=true`, so `X-Forwarded-For` cannot be spoofed past the limiter |

**Web** (`apps/web/next.config.ts` + `src/proxy.ts`)

| Control | Setting |
|---|---|
| CSP | per-request **nonce** + `strict-dynamic`; no `unsafe-inline` for scripts. Verified: all 16 script tags carry the nonce |
| Frames | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| MIME | `X-Content-Type-Options: nosniff` |
| Referrer | `strict-origin-when-cross-origin` |
| Permissions-Policy | camera, microphone, geolocation, FLoC all denied |
| Caching | `no-store` on `/api/*` and on every per-user page |
| Indexing | `robots: noindex, nofollow` |
| Open redirect | the `?next=` parameter must start with `/` and not `//` |

---

## 8. Logging, errors and the audit trail

- Secrets are redacted centrally: pino redacts `authorization`, `cookie`, `set-cookie` and every key
  in `SENSITIVE_KEYS`; `AuditService` runs `redact()` over metadata before it is stored.
- Prisma query logging is off even in development — query logs contain parameter values.
- Unexpected errors return a generic message plus a `requestId`; the real error goes to the log.
  Prisma errors are translated (`P2002` → `CONFLICT`, `P2025` → `NOT_FOUND`) so no SQL detail leaks.
- Swagger is disabled in production, enforced by `env.schema.ts` at boot rather than by convention.
- The audit trail is append-only: no update or delete path exists, and `AuditLog.actorId` is
  `ON DELETE SET NULL` with a denormalised email, so deleting a user does not erase their history.

---

## 9. Secrets and configuration

- Three separate secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, each ≥ 32
  characters, validated at boot. Production additionally requires that the first two differ.
- `.env` is gitignored; `.env.example` ships placeholders, never working values.
- **There is no default admin password.** `db:seed` fails unless `SEED_ADMIN_EMAIL` and
  `SEED_ADMIN_PASSWORD` are set, because a default that ships with a repository is how production
  systems are lost.
- Supply chain: install scripts are approved individually (npm 11 blocks them by default) and
  `@scarf/scarf` telemetry is left unapproved. Root `overrides` pin `mysql2` and `deepmerge-ts`,
  vulnerable transitive deps of the Prisma CLI. `npm audit` currently reports **0 vulnerabilities**.

---

## 10. Before you deploy

Not implemented here, because it depends on the target environment:

- [ ] **TLS everywhere.** `secure` cookies and HSTS assume HTTPS; nothing works safely without it.
- [ ] **Distributed rate limiting.** `@nestjs/throttler` uses in-memory storage, so with N instances
      the effective limit is N×. Add the Redis storage adapter before scaling out.
- [ ] **Coarse per-address limiting at the edge** (nginx, Cloudflare, an ALB rule), since the
      application limiter now runs after authentication.
- [ ] Set `TRUST_PROXY=true` so the `X-Forwarded-For` the BFF already sends is honoured; without
      it, every unauthenticated request looks like it came from the web server.
- [ ] **Real secret management** (Vault, AWS Secrets Manager, …) rather than env files.
- [ ] **Session cleanup job** — `TokenService.purgeExpiredSessions()` exists and is not scheduled.
- [ ] **Audit retention / export** policy, and shipping logs off the host.
- [ ] `TRUST_PROXY=true` **only** behind a proxy you control, with `CORS_ORIGINS` set to real origins.
- [ ] Email verification and password reset — deliberately absent, since both need a mail provider.
- [ ] MFA for `ADMIN`, if the data warrants it.
- [ ] Dependency scanning and `npm audit` in CI.

---

## 11. Reporting

This is a private project. Report anything you find through the project's issue tracker, not in a
public channel.
