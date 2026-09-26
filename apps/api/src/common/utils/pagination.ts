import { buildPaginationMeta, type PaginationQuery, type Paginated } from '@dtrace/shared';

export interface PaginateArgs<TWhere, TOrderBy> {
  where?: TWhere;
  orderBy?: TOrderBy;
  select?: unknown;
  include?: unknown;
}

/**
 * Minimal structural shape every Prisma model delegate satisfies.
 *
 * The argument is `any` on purpose: Prisma's generated `findMany` signature is
 * a deeply conditional generic that no hand-written interface can express, and
 * narrowing it here would reject every real delegate. Type safety is preserved
 * where it matters - `TItem` is inferred by the caller, and `sortBy` is
 * checked against an allow-list before it reaches `orderBy`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface PaginatableDelegate {
  findMany: (args: any) => Promise<unknown[]>;
  count: (args: any) => Promise<number>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * One paginator for every list endpoint, so page/limit clamping, the count
 * query and the meta shape are written once instead of per module.
 *
 * `sortBy` is validated against `allowedSortFields` — passing user input
 * straight into `orderBy` would let a caller sort by (and thereby probe)
 * columns such as `passwordHash`.
 */
export async function paginate<TItem, TWhere, TOrderBy>(
  delegate: PaginatableDelegate,
  query: PaginationQuery,
  options: PaginateArgs<TWhere, TOrderBy> & {
    allowedSortFields: readonly string[];
    defaultSortField: string;
  },
): Promise<Paginated<TItem>> {
  const { page, limit, sortBy, sortOrder } = query;
  const sortField =
    sortBy && options.allowedSortFields.includes(sortBy) ? sortBy : options.defaultSortField;

  const args: Record<string, unknown> = {
    where: options.where,
    orderBy: options.orderBy ?? { [sortField]: sortOrder },
    skip: (page - 1) * limit,
    take: limit,
  };
  if (options.select) args['select'] = options.select;
  if (options.include) args['include'] = options.include;

  const [items, total] = await Promise.all([
    delegate.findMany(args),
    delegate.count({ where: options.where }),
  ]);

  // The row type comes from the caller's `TItem`, which it declares to match
  // the `select` it passed. Trying to unify it with Prisma's own conditional
  // return type instead makes every call site with a `_count` or a nested
  // `select` fail to compile for no benefit — the shape is the caller's claim
  // either way.
  return { items: items as TItem[], meta: buildPaginationMeta(page, limit, total) };
}
