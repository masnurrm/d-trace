# apps/api — working notes

Root agreement: [../../CLAUDE.md](../../CLAUDE.md). This file covers what is specific to the API.

## Non-obvious things about this workspace

- **It is ESM.** Every relative import needs an explicit `.js` extension, in `.ts` files too:
  `import { AuthService } from './auth.service.js'`. Omitting it compiles and fails at runtime.
- **Prisma 7 needs a driver adapter.** `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
  `datasourceUrl` was removed. The client is generated into `src/generated/prisma` (gitignored);
  `prebuild` regenerates it, or run `npm run db:generate`.
- **CLI config lives in `prisma.config.ts`**, not in the schema. The datasource URL is read there.
- **`@node-rs/argon2` exports a `const enum`**, which `isolatedModules` forbids importing as a value.
  Argon2id is inlined as `2` in `password.service.ts` *and* `prisma/seed.ts` — keep them in step.
- **`JwtModule` is registered `global: true`** because `JwtAuthGuard` is bound globally and resolves
  `JwtService` from the root injector.
- **Middleware paths use Express 5 syntax**: `forRoutes('{*splat}')`, not `'*'`.
- Linting is **oxlint**, not ESLint. Tests are **Vitest**, not Jest.

## The order that matters

Global providers in `app.module.ts` run in registration order, and that order is the security
posture: `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`. Do not reorder them.

## When adding a module

1. Schema in `@dtrace/shared` first, then `npm run build:shared`.
2. Controller: `@MinRole()` / `@Roles()`, `@Body(zodPipe(schema))`, `@CurrentUser()`, `@Client()`.
3. Service: allow-list `select`, `paginate()` for lists, `AuditService.record()` for mutations.
4. Register the module in `AppModule`; add any new action to `AUDIT_ACTIONS`.

Full recipe with code: [../../docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

## Never

- Read `process.env` outside `src/config/` — it is validated once, at boot, with zod.
- Select a user without `USER_PUBLIC_SELECT`.
- Pass user input into `orderBy` without `allowedSortFields`.
- Distinguish "unknown email" from "wrong password" in a response.
- Add an endpoint that updates or deletes an `AuditLog`.
