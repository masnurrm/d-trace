import { listUsersQuerySchema, type ListUsersQuery } from '@dtrace/shared';
import { DEFAULT_PAGE_SIZE, toSearchString } from '@/lib/query/keys';

const present = (value: string | null) => (value !== null && value !== '' ? value : undefined);

/**
 * Turns the URL into the query the API will receive, using the very schema the
 * API validates against. The server page and the client table both call this,
 * so both produce byte-identical search strings — and therefore the same cache
 * key — for the same URL.
 *
 * A malformed query string falls back to the defaults rather than throwing:
 * a hand-edited URL should show the unfiltered list, not an error screen.
 */
export function parseUsersQuery(params: URLSearchParams): ListUsersQuery {
  const candidate = {
    page: params.get('page') ?? 1,
    limit: params.get('limit') ?? DEFAULT_PAGE_SIZE,
    search: present(params.get('search')),
    role: present(params.get('role')),
    isActive: present(params.get('isActive')),
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const parsed = listUsersQuerySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return listUsersQuerySchema.parse({ limit: DEFAULT_PAGE_SIZE, sortBy: 'createdAt', sortOrder: 'desc' });
}

export function usersSearchString(params: URLSearchParams): string {
  return toSearchString(parseUsersQuery(params));
}
