import { listAuditLogsQuerySchema, type ListAuditLogsQuery } from '@dtrace/shared';
import { DEFAULT_PAGE_SIZE, toSearchString } from '@/lib/query/keys';

const present = (value: string | null) => (value !== null && value !== '' ? value : undefined);

/** The columns the API will actually sort by (`SORTABLE_FIELDS` in audit.service.ts). */
export const AUDIT_SORT_FIELDS = ['createdAt', 'action', 'entity'] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `<input type="date">` hands back `YYYY-MM-DD`, but the API wants an ISO
 * datetime. The URL keeps the plain date — that is what the input has to be
 * refilled with — and the widening to a whole day happens only here, on the
 * way to the API. Anything that is not a plain date is dropped rather than
 * sent, so a hand-edited URL cannot make the whole query fall back to nothing.
 */
function dayBoundary(value: string | undefined, edge: 'start' | 'end'): string | undefined {
  if (!value || !DATE_ONLY.test(value)) return undefined;
  return edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

/** Same contract as `parseUsersQuery`; see that file for the reasoning. */
export function parseAuditQuery(params: URLSearchParams): ListAuditLogsQuery {
  const sortBy = present(params.get('sortBy'));

  const candidate = {
    page: params.get('page') ?? 1,
    limit: params.get('limit') ?? DEFAULT_PAGE_SIZE,
    action: present(params.get('action')),
    actorId: present(params.get('actorId')),
    entity: present(params.get('entity')),
    from: dayBoundary(present(params.get('from')), 'start'),
    to: dayBoundary(present(params.get('to')), 'end'),
    // An unrecognised sort field would be rejected by the API, so it never
    // leaves here.
    sortBy: AUDIT_SORT_FIELDS.includes(sortBy as (typeof AUDIT_SORT_FIELDS)[number])
      ? sortBy
      : 'createdAt',
    sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : 'desc',
  };

  const parsed = listAuditLogsQuerySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return listAuditLogsQuerySchema.parse({
    limit: DEFAULT_PAGE_SIZE,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
}

export function auditSearchString(params: URLSearchParams): string {
  return toSearchString(parseAuditQuery(params));
}
