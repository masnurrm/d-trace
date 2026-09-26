# Flow

Every lifecycle in D-Trace, written so it can be followed without reading the source first.
If you change one of these, change this document in the same commit.

---

## 1. Who talks to whom

```
┌─────────┐        ┌────────────────────────────┐        ┌───────────────────┐      ┌────────────┐
│ Browser │───────▶│ Next.js  (apps/web)        │───────▶│ NestJS (apps/api) │─────▶│ PostgreSQL │
└─────────┘        │                            │        │                   │      └────────────┘
     ▲             │ • server components        │        │ • guards          │
     │             │ • /api/auth/*  (cookies)   │        │ • zod pipes       │
     └─────────────│ • /api/bff/*   (proxy)     │        │ • services        │
   only the web    │ • proxy.ts (refresh + CSP) │        │ • Prisma          │
   app, ever       └────────────────────────────┘        └───────────────────┘
```

**The browser never receives a token and never learns the API's address.** `API_URL` is a
server-only variable — nothing in this repo is prefixed `NEXT_PUBLIC_`.

---

## 2. Sign-in

```
 Browser                Next.js (BFF)                     NestJS API                  Postgres
    │                        │                                 │                          │
    │ POST /api/auth/login   │                                 │                          │
    │───────────────────────▶│ zod: loginSchema                │                          │
    │                        │ POST /api/v1/auth/login ───────▶│ ThrottlerGuard (10/min)  │
    │                        │                                 │ zod: loginSchema         │
    │                        │                                 │ findUnique(email) ──────▶│
    │                        │                                 │◀─────────────────────────│
    │                        │                                 │ lockout check            │
    │                        │                                 │ argon2id verify          │
    │                        │                                 │   (dummy hash if no user)│
    │                        │                                 │ AuditLog ───────────────▶│
    │                        │                                 │ issue tokens ───────────▶│ (Session row)
    │                        │◀─ 200 { user, accessToken }     │                          │
    │                        │   Set-Cookie: dtrace_rt         │                          │
    │                        │                                 │                          │
    │                        │ store BOTH as its own           │                          │
    │                        │ httpOnly cookies                │                          │
    │◀─ 200 { user }         │                                 │                          │
    │   Set-Cookie: dtrace_at (httpOnly, TTL = token TTL)      │                          │
    │   Set-Cookie: dtrace_rt (httpOnly, 7d)                   │                          │
```

Failure modes, all returning the same `INVALID_CREDENTIALS`:

| Case | What happens | Why |
|---|---|---|
| Unknown email | A dummy Argon2 hash is computed, then 401 | Equal timing; otherwise the endpoint enumerates accounts |
| Wrong password | Failure counter incremented; 401 | Lockout after `MAX_FAILED_LOGINS` |
| Disabled account | Checked *after* the password verifies; 401 | Otherwise it reveals that the account exists |
| Locked account | 401 with a lockout message | The user needs to know to wait |

---

## 3. An authenticated page render

```
GET /users?role=ADMIN
   │
   ├─▶ proxy.ts
   │     ├─ access cookie present? ──── no ──▶ refresh (§4) or redirect to /login
   │     └─ attach CSP nonce to the request
   │
   ├─▶ app/(app)/layout.tsx  →  getSessionUser()  →  GET /api/v1/auth/me
   │     └─ null (revoked/disabled) ──▶ redirect('/login')
   │
   ├─▶ app/(app)/users/page.tsx
   │     ├─ listUsersQuerySchema.parse(searchParams)   ← same schema the API validates with
   │     └─ apiFetch('/users?…')  →  Bearer token attached server-side
   │
   └─▶ HTML, already containing the data. No loading flash, no token in the payload.
```

Client interactions after that go `clientFetch()` → `/api/bff/*` → API, so the token still never
leaves the server.

---

## 4. Refresh and rotation

The access cookie is given the access token's own lifetime. When it expires the browser drops it,
which is precisely the signal the proxy watches for.

```
 proxy.ts sees: no dtrace_at, but dtrace_rt exists
    │
    ├─▶ POST /api/v1/auth/refresh   (Cookie: dtrace_rt=…)
    │      │
    │      ├─ look up Session by HMAC(token, JWT_REFRESH_SECRET)
    │      │
    │      ├─ not found ──────────▶ 401 TOKEN_INVALID
    │      ├─ already revoked ────▶ revoke the WHOLE family ▶ 401 SESSION_REVOKED
    │      ├─ expired ────────────▶ revoke it              ▶ 401 TOKEN_EXPIRED
    │      ├─ user disabled ──────▶ revoke the whole family ▶ 401 SESSION_REVOKED
    │      │
    │      └─ ok ▶ transaction: create new Session, revoke the old one (replacedById)
    │              ▶ 200 { user, accessToken } + Set-Cookie: dtrace_rt (new)
    │
    ├─ success ▶ rewrite both cookies on the response, continue the request
    └─ failure ▶ clear both cookies, redirect to /login
```

### Why reuse detection matters

```
login ──▶ RT1 ──rotate──▶ RT2 ──rotate──▶ RT3        (family F)
             │
             └─ attacker replays RT1 (already revoked)
                        │
                        └─▶ every token in family F is revoked, including RT3.
                            The legitimate user is signed out, the thief gains nothing,
                            and the event is in the audit trail.
```

Verified behaviour: replaying a rotated token returns `SESSION_REVOKED`, and the *current* token
then fails too.

---

## 5. Request lifecycle inside the API

```
HTTP request
  │
  ├─ helmet                → security headers
  ├─ compression
  ├─ cookie-parser         → signed cookies only
  ├─ CORS                  → exact-origin allow-list, credentials: true
  ├─ OriginCheckMiddleware → non-GET with a foreign Origin is rejected
  ├─ pino-http             → x-request-id generated / echoed
  │
  ├─ JwtAuthGuard          → 401 unless @Public()      (deny by default)
  ├─ UserThrottlerGuard    → 429 RATE_LIMITED; keyed by user id, else by address
  ├─ RolesGuard            → 403 unless the role fits  (opt-in per route)
  ├─ ZodValidationPipe     → 400 VALIDATION_FAILED, with per-field details
  │
  ├─ Controller → Service → Prisma
  │                  └─ AuditService.record() for anything that mutates
  │
  ├─ ResponseInterceptor   → { success: true, data, meta?, requestId, timestamp }
  └─ AllExceptionsFilter   → { success: false, error: { code, message, details? }, requestId }
```

### The envelope

```jsonc
// success
{ "success": true, "data": { … }, "meta": { "page": 1, "total": 42, … }, "requestId": "…", "timestamp": "…" }

// failure
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "…",
  "details": [{ "field": "email", "message": "Invalid email address" }] }, "requestId": "…", "timestamp": "…" }
```

`requestId` appears in both the response and the server log line, so a user-reported failure maps to
exactly one log entry. Unexpected errors return a generic message — the real one stays server-side.

---

## 6. Role change

```
PATCH /api/v1/users/:id/role   (ADMIN only)
  ├─ target exists?                              → 404
  ├─ caller's rank ≥ requested rank?             → 403  (no privilege escalation)
  ├─ demoting yourself from ADMIN?               → 403
  ├─ demoting the last active ADMIN?             → 403
  ├─ update the row
  ├─ revoke ALL of that user's sessions          ← the old access token still carries the old role
  └─ AuditLog: USER_ROLE_CHANGED { from, to }
```

The same reasoning applies to deactivation (`isActive: false` also revokes sessions) and to a
password change (revokes every session, including the caller's own).

---

## 7. What lands in the audit trail

| Action | Written when |
|---|---|
| `AUTH_LOGIN`, `AUTH_LOGIN_FAILED` | every attempt, successful or not, with the reason |
| `AUTH_REGISTER`, `AUTH_LOGOUT`, `AUTH_REFRESH` | session lifecycle |
| `AUTH_PASSWORD_CHANGED` | with the number of sessions revoked |
| `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`, `USER_ROLE_CHANGED` | administrative actions |

Each record carries actor id and email (denormalised, so it survives the user being deleted), IP,
user agent, and a `metadata` object passed through `redact()`. `AuditService.record()` never throws —
a failed audit write is logged, but does not roll back the operation that succeeded.

---

## 8. Error handling in the browser

```
API error ──▶ ApiRequestError (server)  /  ApiClientError (browser)
                  │
                  ├─ VALIDATION_FAILED → details mapped onto form fields via setError()
                  ├─ 401               → proxy has already redirected, or the layout does
                  ├─ 403               → the UI simply does not offer the action
                  └─ 5xx               → generic message + the digest, which matches the server log
```

Client code branches on `error.code`, never on the message text — codes are stable, messages are not.
