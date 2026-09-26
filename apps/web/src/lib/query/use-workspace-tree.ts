'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { WorkspaceTree } from '@dtrace/shared';
import { clientFetch } from '@/lib/api/client';
import { queryKeys } from './keys';

/**
 * The Workspace sidebar tree, as client state.
 *
 * It is rendered on the server with the shell — that is what makes the sidebar
 * arrive with the HTML — and `initial` seeds the cache with exactly that
 * payload, so the first render costs no request.
 *
 * It is a query rather than a prop because of what happens next. The tree lives
 * in `(app)/layout.tsx`, which every route under it shares, and a client-side
 * navigation reuses a shared layout instead of re-running it: a project created
 * from the dialog would not appear in the sidebar until a full page load.
 * `router.refresh()` is not a dependable answer either, since it and the push
 * that follows race over the same router cache. Owning the tree here removes
 * the question — whatever changes it calls `useInvalidateWorkspaceTree()` and
 * one request brings the sidebar up to date, wherever the reader happens to be.
 */
export function useWorkspaceTree(initial: WorkspaceTree | null): WorkspaceTree | null {
  const { data } = useQuery({
    queryKey: queryKeys.workspaceTree(),
    queryFn: async () => (await clientFetch<WorkspaceTree>('/workspace/tree')).data,
    initialData: initial ?? undefined,
    // The server render is fresh; without this the query would refetch it
    // immediately on mount and fetch the same tree twice on every page load.
    staleTime: 30_000,
    enabled: initial !== null,
  });

  return data ?? initial;
}

/** Marks the sidebar stale. Call after anything the tree shows has changed. */
export function useInvalidateWorkspaceTree(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTree() });
  }, [queryClient]);
}
