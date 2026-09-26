'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

type Mutate = (params: URLSearchParams) => void;

/**
 * Reads and writes the filter state that lives in the URL.
 *
 * The write goes through `history.pushState` rather than `router.push`: the
 * page is `force-dynamic`, so a router navigation would re-run the server
 * component and re-fetch the list that TanStack Query already has. Pushing the
 * URL directly keeps the view shareable and the back button working, while the
 * query key change alone decides whether anything is actually refetched.
 */
export function useUrlFilters() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const setFilters = useCallback(
    (mutate: Mutate, { replace = false }: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);

      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;

      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    },
    [pathname, searchParams],
  );

  return { searchParams, setFilters };
}
