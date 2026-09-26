# Conventions

Recipes for the things you will actually do in this repository. Follow the path; it exists so the
tenth endpoint looks like the first.

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case, suffixed by role | `token.service.ts`, `user-role-select.tsx` |
| Classes / components | PascalCase | `TokenService`, `UserRoleSelect` |
| Functions / variables | camelCase | `revokeAllForUser` |
| Constants | SCREAMING_SNAKE | `USER_PUBLIC_SELECT`, `ROLE_VALUES` |
| Zod schemas | `<thing>Schema`, type inferred with the same name | `loginSchema` → `LoginInput` |
| Booleans | `is` / `has` / `can` prefix | `isActive`, `hasSession` |
| DB tables | snake_case plural via `@@map` | `audit_logs` |

**Imports in `apps/api` need the `.js` extension** — the package is ESM. TypeScript resolves the
`.ts`, Node loads the `.js`. Omitting it compiles and then fails at runtime.

---

## Recipe: a new API endpoint

Adding `POST /api/v1/projects`:

**1. Contract first** — `packages/shared/src/schemas/project.schema.ts`

```ts
import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  ownerId: z.uuid().optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
```

Export it from `schemas/index.ts`, then `npm run build:shared` (or leave `npm run dev` running).

**2. Schema + migration** — add the model to `apps/api/prisma/schema.prisma`, then
`npm run db:migrate -- --name add_projects`.

**3. Service** — business rules, Prisma, audit

```ts
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(input: CreateProjectInput, actor: AuthenticatedUser, client: ClientInfo) {
    const project = await this.prisma.project.create({
      data: { ...input, ownerId: actor.id },
      select: PROJECT_PUBLIC_SELECT,       // an allow-list, like USER_PUBLIC_SELECT
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.PROJECT_CREATED,
      entity: 'Project',
      entityId: project.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return project;
  }

  list(query: ListProjectsQuery) {
    return paginate(this.prisma.project, query, {
      where: query.ownerId ? { ownerId: query.ownerId } : undefined,
      select: PROJECT_PUBLIC_SELECT,
      allowedSortFields: ['createdAt', 'name'],   // never accept arbitrary sortBy
      defaultSortField: 'createdAt',
    });
  }
}
```

**4. Controller** — HTTP shape only

```ts
@ApiTags('projects')
@Controller('projects')
@MinRole(ROLES.OPERATOR)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @Body(zodPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.projectsService.create(body, actor, client);
  }

  @Get()
  list(@Query(zodPipe(listProjectsQuerySchema)) query: ListProjectsQuery) {
    return this.projectsService.list(query);   // { items, meta } is unwrapped by the interceptor
  }
}
```

**5. Register** the module in `AppModule` and add any new action to `AUDIT_ACTIONS`.

**Checklist:** shared schema · role guard · audit on mutation · allow-list projection ·
`paginate()` with `allowedSortFields` · no `process.env` · no secret in a response.

---

## Recipe: a new page

```tsx
// apps/web/src/app/(app)/projects/page.tsx
export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';          // per-user data: never prerender

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = listProjectsQuerySchema.parse({  // the same schema the API validates with
    page: params.page ?? 1,
    limit: params.limit ?? 20,
  });

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }

  const { data, meta } = await apiFetch<Project[]>(`/projects?${search}`);

  return (
    <div className="space-y-6">
      <PageHeader title="Projects" description="…" />
      <Card>
        <DataTable columns={columns} rows={data} rowKey={(row) => row.id} />
        {meta && <PaginationBar meta={meta} buildHref={(page) => `/projects?page=${page}`} />}
      </Card>
    </div>
  );
}
```

Rules:
- Server component unless it needs interaction; then extract the interactive bit into a small
  `'use client'` component instead of converting the page.
- Filters and pagination belong in the URL — shareable, bookmarkable, and the back button works.
- Never pass a component *reference* into a client component (`Icon={Icon}`). Pass a rendered
  element (`icon={<Icon />}`). React cannot serialise the former.
- Build URLs at runtime through `dynamicRoute()`; `typedRoutes` checks the literal ones.

---

## Recipe: a UI component

```tsx
const alertVariants = cva('base classes here', {
  variants: { tone: { info: '…', danger: '…' } },
  defaultVariants: { tone: 'info' },
});

export function Thing({ className, tone, ...props }: ThingProps) {
  return <div className={cn(alertVariants({ tone }), className)} {...props} />;
}
```

- Variants with `cva`, never conditional string concatenation.
- Always merge an incoming `className` last through `cn()`, so callers can override.
- Semantic HTML first; `aria-*` where semantics are not enough; a visible focus ring always.
- Export from `components/ui/index.ts`.

---

## Testing

Test the logic that would hurt if it broke, not the framework.

| Worth testing | Not worth testing |
|---|---|
| Guards (`roles.guard.spec.ts`) | that Nest routes a decorator |
| Validation pipes, including field-stripping | that zod validates |
| Crypto helpers: rotation, duration parsing | Prisma itself |
| Password hashing and verification | a component's class names |

```bash
npm run test --workspace @dtrace/api
```

Current suite: 21 tests across crypto, the validation pipe, the roles guard and password hashing.

---

## Commits

Conventional Commits, scoped by workspace:

```
feat(api): add project endpoints
fix(web): stop the proxy redirecting BFF calls to /login
refactor(shared): extract the pagination meta builder
docs: record the refresh-rotation flow
```

Before pushing: `npm run typecheck && npm run lint && npm run test && npm run build`.
`build` is the strictest of the four — Next typechecks routes only at build time.

---

## Code review checklist

- [ ] Shared types used; nothing redeclared in an app workspace
- [ ] Input validated at the boundary with a shared schema
- [ ] Route carries the right `@Roles` / `@MinRole`
- [ ] Mutations write to the audit trail
- [ ] Queries use an allow-list projection; list endpoints use `paginate()`
- [ ] No `process.env` outside the config layer
- [ ] No secret in a log, a response or an audit record
- [ ] Errors go through `AppException`, so the client sees a stable `code`
- [ ] New UI reuses `components/ui`
- [ ] `CLAUDE.md` / `docs/` updated if a rule or flow changed
