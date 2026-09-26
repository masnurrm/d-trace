# @dtrace/api

NestJS 12 (ESM) backend for D-Trace: authentication, users, and the append-only audit trail.
It is the authority — every rule is enforced here, regardless of what the UI allows.

```bash
npm run start:dev     # watch mode
npm run build
npm run test
npm run lint

npm run db:migrate    # prisma migrate dev
npm run db:generate   # regenerate the client into src/generated/prisma
npm run db:seed       # first administrator; needs SEED_ADMIN_* in .env
npm run db:studio
```

Environment: copy `.env.example` to `.env`. `src/config/env.schema.ts` validates everything at boot,
so a missing or too-short secret stops the process instead of weakening it silently.

| Path | What it is |
|---|---|
| `src/config/` | the only place `process.env` is read |
| `src/common/` | guards, filters, interceptors, pipes, decorators, utils |
| `src/modules/auth/` | login, rotation with reuse detection, Argon2id hashing |
| `src/modules/users/` | CRUD, role changes, the public projection |
| `src/modules/audit/` | one writer, one read-only reader |
| `src/modules/health/` | `/health/live` (no DB), `/health/ready` (DB) |
| `prisma/` | schema, migrations, seed |

Swagger runs at `/api/docs` in development only. See [CLAUDE.md](CLAUDE.md) for the rules and
[../../docs/API.md](../../docs/API.md) for the endpoint reference.
