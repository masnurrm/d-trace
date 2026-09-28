# @dtrace/shared

The contract between `@dtrace/web` and `@dtrace/api`: zod schemas, the types inferred from them,
role and error constants, and a few pure helpers.

```bash
npm run build     # tsc → dist (ESM + .d.ts)
npm run dev       # watch
```

**Rules for this package:** it may not import from an app workspace, may not read `process.env`, and
may not use Node or DOM globals. It has to run in both runtimes. Its only dependency is zod.

| Folder | Contents |
|---|---|
| `constants/` | `ROLES` and rank ordering, `ERROR_CODES`, `AUDIT_ACTIONS` |
| `schemas/` | one schema per payload, plus its inferred type |
| `types/` | the `ApiResponse` envelope, `Paginated<T>` |
| `utils/` | `redact()`, `maskEmail()`, `safeEqual()`, `toSlug()` |

Change a schema here and both sides move together — that is the entire point.
