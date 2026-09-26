/**
 * Rows per page before anyone chooses otherwise. The shared
 * `paginationQuerySchema` still defaults to 20 — that is the API's contract
 * for callers that send no limit, and this is the UI's preference. The list
 * parsers always send an explicit limit, so the two never disagree.
 */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Query keys in one place.
 *
 * A list is keyed by its canonical search string rather than by a parsed
 * object, so the key a server prefetch produces and the key the browser builds
 * for the same URL are identical strings — which is what lets the server's
 * first page seed the cache instead of being refetched on hydration.
 */
export const queryKeys = {
  users: (search: string) => ['users', 'list', search] as const,
  auditLogs: (search: string) => ['audit-logs', 'list', search] as const,
  /**
   * The Workspace sidebar: every node the caller reaches, its projects and
   * their documents. Not a list keyed by a search string — there is one tree
   * per caller — so it is a bare key that anything creating, renaming or
   * deleting inside the Workspace invalidates.
   */
  workspaceTree: () => ['workspace', 'tree'] as const,
} as const;

/**
 * Serialises a parsed query into a stable string. Undefined and empty values
 * are dropped, and the keys are sorted, so two equivalent filter states never
 * produce two different cache entries.
 */
export function toSearchString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  params.sort();
  return params.toString();
}
