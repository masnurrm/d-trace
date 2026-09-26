# API reference

Base URL: `http://localhost:4000/api/v1`
Interactive docs (development only): `http://localhost:4000/api/docs`

---

## Conventions

**Authentication.** `Authorization: Bearer <accessToken>` on every endpoint except those marked
**Public**. The refresh token travels only as the signed, httpOnly cookie `dtrace_rt`.

**Envelope.** Every response uses one of these two shapes:

```jsonc
{ "success": true,  "data": …, "meta": { … }, "requestId": "…", "timestamp": "…" }
{ "success": false, "error": { "code": "…", "message": "…", "details": [ … ] }, "requestId": "…", "timestamp": "…" }
```

`meta` appears on paginated responses. `details` appears on `VALIDATION_FAILED`, one entry per
failing rule — a password can produce several.

**Error codes** (stable; branch on these, never on the message):

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | payload rejected; see `details` |
| `UNAUTHORIZED` | 401 | missing or unusable credentials |
| `INVALID_CREDENTIALS` | 401 | wrong email or password (deliberately indistinguishable) |
| `TOKEN_EXPIRED` | 401 | access or refresh token past its lifetime |
| `TOKEN_INVALID` | 401 | signature or shape wrong |
| `SESSION_REVOKED` | 401 | session (or its whole family) revoked |
| `FORBIDDEN` | 403 | authenticated, but the role does not allow it |
| `NOT_FOUND` | 404 | no such resource |
| `CONFLICT` | 409 | unique constraint or a rule such as "last administrator" |
| `RATE_LIMITED` | 429 | throttle bucket exhausted (per user when signed in, per address otherwise) |
| `PAYLOAD_TOO_LARGE` | 413 | body over `BODY_LIMIT` |
| `SERVICE_UNAVAILABLE` | 503 | the API could not be reached at all (client-side code only) |
| `INTERNAL_ERROR` | 500 | unexpected; quote `requestId` when reporting |

**Pagination query** (shared by every list endpoint):
`page` (≥1, default 1) · `limit` (1–100, default 20) · `sortBy` (allow-listed per endpoint) ·
`sortOrder` (`asc` | `desc`, default `desc`) · `search`.

**Roles:** `VIEWER < OPERATOR < AUDITOR < ADMIN`.

---

## Auth

### `POST /auth/register` · Public · 5 requests / 10 min

```jsonc
// request
{ "name": "Ada Lovelace", "email": "ada@example.com",
  "password": "correct horse Battery1", "confirmPassword": "correct horse Battery1" }

// 201 — plus Set-Cookie: dtrace_rt
{ "success": true, "data": { "user": { … }, "accessToken": "eyJ…", "expiresIn": 900, "tokenType": "Bearer" } }
```

New accounts are always `VIEWER`. The conflict response for an existing email is deliberately vague.

### `POST /auth/login` · Public · 10 requests / min

```jsonc
{ "email": "admin@dtrace.local", "password": "…" }
```

Returns the same payload as register. Failures return `INVALID_CREDENTIALS` whether the email is
unknown, the password is wrong, or the account is disabled. Repeated failures lock the account for
`LOCKOUT_MINUTES`.

### `POST /auth/refresh` · Public (cookie-authenticated) · 60 / min

Requires the `dtrace_rt` cookie. Rotates it and returns a new access token. Replaying an already
rotated token revokes **every** session descended from that login and returns `SESSION_REVOKED`.

### `POST /auth/logout` · Public

Revokes the presented session and clears the cookie. Public on purpose: logging out must work even
with an expired access token.

### `POST /auth/logout-all`

Revokes every session for the current user. Returns `{ "revoked": 3 }`.

### `GET /auth/me`

```jsonc
{ "success": true, "data": { "id": "…", "email": "…", "name": "…", "role": "ADMIN",
                             "isActive": true, "createdAt": "…" } }
```

### `POST /auth/change-password` · 5 requests / 10 min

```jsonc
{ "currentPassword": "…", "newPassword": "…", "confirmPassword": "…" }
```

Returns `{ "revokedSessions": 2 }`. **Every session is revoked, including the caller's own** — sign
in again afterwards.

---

## Users

`AUDITOR` or above may read; `ADMIN` only may write.

### `GET /users` · AUDITOR+

Query: pagination plus `role` (`ADMIN|AUDITOR|OPERATOR|VIEWER`) and `isActive` (`true|false`).
Sortable: `createdAt`, `updatedAt`, `name`, `email`, `role`, `lastLoginAt`.

```jsonc
{ "success": true,
  "data": [ { "id": "…", "email": "…", "name": "…", "role": "VIEWER", "isActive": true,
              "lastLoginAt": null, "createdAt": "…", "updatedAt": "…" } ],
  "meta": { "page": 1, "limit": 20, "total": 4, "totalPages": 1, "hasNext": false, "hasPrev": false } }
```

### `GET /users/:id` · AUDITOR+

### `GET /users/stats` · AUDITOR+

`{ "total": 12, "active": 11, "inactive": 1, "newThisMonth": 3 }` — the four cards above the list.
Separate from the table's pagination meta on purpose: the table shows a *filtered* page, and a card
that changes meaning when someone types in the search box is worse than no card.

### `POST /users` · ADMIN

```jsonc
{ "name": "Grace Hopper", "email": "grace@example.com", "password": "…",
  "isChecker": false,
  "nodeAccess": [ { "nodeId": "…", "role": "MANAGER", "canCreateDocument": false } ] }
```

`role` (the system role) defaults to the lowest and is no longer sent by the user form — Super Admin
comes from the seed. Assigning a role above your own still returns `FORBIDDEN`.

`nodeAccess` is the complete list: what is sent replaces what is stored, so removing an entry is
simply leaving it out. `canCreateDocument` is forced to `false` for any role but `COLLABORATOR`.

### `PATCH /users/:id` · ADMIN

```jsonc
{ "name": "…", "email": "…", "isActive": false }   // at least one field
```

Setting `isActive: false` also revokes that user's sessions. Role is **not** accepted here — it has
its own endpoint so it can be audited separately.

### `PATCH /users/:id/role` · ADMIN

```jsonc
{ "role": "AUDITOR" }
```

Revokes the target's sessions (their old token still carries the old role). Refused when it would
escalate beyond the caller's role, remove the caller's own admin role, or demote the last active
administrator.

### `DELETE /users/:id` · ADMIN · `204 No Content`

Refused for your own account and for the last active administrator. Sessions cascade; audit records
survive with the actor's email preserved.

---

## Audit logs

### `GET /audit-logs` · ADMIN or AUDITOR

Query: pagination plus `action`, `actorId`, `entity`, `from` / `to` (ISO 8601).
Sortable: `createdAt`, `action`, `entity`. `search` matches action, actor email or target id.

```jsonc
{ "success": true,
  "data": [ { "id": "…", "action": "AUTH_LOGIN_FAILED", "entity": "User", "entityId": "…",
              "actorId": null, "actorEmail": "nobody@dtrace.local", "ip": "127.0.0.1",
              "userAgent": "curl/8.4.0", "metadata": { "reason": "unknown-account" },
              "createdAt": "…" } ],
  "meta": { … } }
```

Read-only by design: there is no endpoint that writes, edits or deletes a record. `metadata` has
already been passed through `redact()`, so it never contains a password or token.

Actions: `AUTH_LOGIN`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`, `AUTH_REFRESH`, `AUTH_REGISTER`,
`AUTH_PASSWORD_CHANGED`, `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`, `USER_ROLE_CHANGED`.

---

## Hierarchy

Two resources that only make sense together: **node types** are the grammar (what a node is, and
where that kind of thing may stand), **nodes** are the tree itself. Reading is `AUDITOR`+, writing
is `ADMIN`.

### `GET /node-types?includeInactive=true`

```jsonc
{ "success": true, "data": [
  { "id": "…", "name": "Department", "code": "DEPARTMENT", "canBeRoot": false, "isActive": true,
    "allowedParents": [{ "id": "…", "name": "Main Company", "code": "MAIN_COMPANY" }],
    "nodeCount": 3, "createdAt": "…", "updatedAt": "…" } ] }
```

`POST`, `PATCH /:id`, `DELETE /:id` follow. A type must be placeable — `canBeRoot` or at least one
allowed parent — and a rule change that would strand nodes already in the tree is refused with
`409 CONFLICT`, naming the node. A type still in use cannot be deleted.

### `GET /nodes?includeInactive&search&typeId&depth`

Returns the whole hierarchy **flat**; the client builds the tree from `parentId`. Each row carries
`depth`, `position`, `childCount` and its type.

### `POST /nodes` · `PATCH /nodes/:id` · `DELETE /nodes/:id` · ADMIN

Create takes `{ name, code, typeId, parentId }`; `parentId: null` means root, which the type must
allow. Delete refuses a node that still has children.

### `PATCH /nodes/:id/move` · ADMIN

`{ "parentId": "…" | null }`. The branch moves with the node and every descendant's depth is
corrected. Refused when the destination is inside the node's own subtree, or when the type rules
forbid the new placement.

### `POST /nodes/activation` · ADMIN

`{ "ids": ["…"], "isActive": false }` → `{ "affected": 6 }`.

Deactivation **cascades down** the branch: a live node under a dead parent is a contradiction.
Activation does **not** cascade — it refuses a node whose ancestor is still inactive, naming both,
so reviving a branch is always something the caller asked for explicitly.

---

## Role permissions

The project permission matrix. **Policy, not membership**: saving it changes what a project role is
capable of, never who holds that role. Reading is `AUDITOR`+, writing is `ADMIN`.

### `GET /role-permissions`

```jsonc
{ "success": true, "data": {
  "matrix": { "document.create": { "ADMIN": true, "MANAGER": true,
                                   "COLLABORATOR": true, "VIEWER": false }, … },
  "updatedAt": "…" | null, "updatedByEmail": "…" | null } }
```

Keys come from the `PERMISSIONS` catalog in @dtrace/shared, which is code — each one names a place
that checks it. Anything unsaved reads as its shipped default, so a release that adds a key needs no
migration and no configuration step.

### `PUT /role-permissions` · ADMIN

```jsonc
{ "expectedUpdatedAt": "…" | null, "matrix": { … } }
```

Only changed cells are written, and the audit entry lists them one by one rather than storing two
copies of the matrix. Four ways it refuses:

| Case | Response |
|---|---|
| A key not in the catalog | `400 VALIDATION_FAILED` — "Izin tidak dikenal" |
| A dependant without its parent (create without view) | `400`, naming both |
| A locked cell (admin console for a project role) | `400`, naming the role |
| `expectedUpdatedAt` behind the stored version | `409 CONFLICT` |

Super Admin has no stored column: it holds everything, always, and the UI shows it locked.

---

## Settings

One settings document, read by every signed-in user and written only by `ADMIN`.

### `GET /settings`

```jsonc
{ "success": true, "data": {
  "identity": { "appName": "D-Trace", "tagline": "Lacak hari ini, bangun hari esok",
                "version": "1.0.0+56120f5…" },
  "marquee": { "enabled": true, "speedSeconds": 15, "items": [
    { "id": "…", "kind": "TEXT", "text": "…", "url": null,
      "startsAt": "2026-09-18T13:12:00.000Z", "endsAt": "2026-09-30T13:12:00.000Z",
      "isActive": true } ] },
  "footer": { "text": "PT Astra Graphia IT 2026", "align": "CENTER",
              "showAppName": true, "showVersion": true },
  "email": { "host": "smtp.contoh.com", "port": 587, "encryption": "STARTTLS",
             "username": "notif@contoh.com", "fromName": "D-Trace",
             "fromEmail": "no-reply@contoh.com", "hasPassword": true },
  "updatedAt": "…" } }
```

`isActive` is computed server-side, so every client agrees on what is live regardless of its own
clock. The `email` section is **omitted entirely** for non-administrators, and the SMTP password is
never returned to anyone — `hasPassword` only says whether one is stored.

`version` comes from the build (`APP_VERSION`, or the package version plus `GIT_SHA`), not from
the database: a number an operator could type is a number that can disagree with what is deployed.

### `PUT /settings` · ADMIN

Takes the whole document: `identity`, `marquee`, `footer`, and optionally `email`. Marquee items
are reconciled by id — any item not present is deleted, and array order becomes display order.

`email.password` is write-only. Send it to replace the stored secret; omit it or send an empty
string to keep the current one.

`expectedUpdatedAt` carries the `updatedAt` the editor loaded. If the stored row has moved on, the
API answers `409 CONFLICT` instead of applying the change — an editor that has been open for a
while would otherwise write its stale view back over someone else's save. Omit the field only for a
deliberate scripted overwrite.

### `POST /settings/email/test` · ADMIN · 5 requests / 10 min

```jsonc
{ "to": "anda@contoh.com" }   // -> { "sent": true, "messageId": "…" }
```

Uses the **stored** configuration, not unsaved form values. Both outcomes are written to the audit
trail as `SETTINGS_EMAIL_TESTED`; SMTP failures return a short reason, with the detail in the log.

---

## Health

### `GET /health/live` · Public

`{ "status": "ok", "uptime": 1234 }` — never touches the database, so a database outage does not
get the process restarted.

### `GET /health/ready` · Public

```jsonc
{ "status": "ok", "info": { "database": { "status": "up" }, "memory_heap": { "status": "up" } } }
```

Returns `503` when a check fails. The reason is deliberately vague; details go to the logs.

---

## Calling it from the web app

Do not call the API from the browser. Use the BFF:

```ts
// server component
const { data, meta } = await apiFetch<User[]>('/users?page=1');

// client component
const { data } = await clientFetch<User[]>('/users', { searchParams: { page: 1 } });
```

Both attach the token server-side and unwrap the envelope. See [FLOW.md](FLOW.md).
