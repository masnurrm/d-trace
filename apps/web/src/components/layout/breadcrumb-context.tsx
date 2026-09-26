'use client';

import type { Route } from 'next';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Crumb {
  label: string;
  /** Omitted on the last crumb: the page you are already on is not a link. */
  href?: Route;
}

interface BreadcrumbStore {
  trail: Crumb[] | null;
  setTrail: (trail: Crumb[] | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbStore | null>(null);

/**
 * Lets a page name its own place in the trail.
 *
 * The header sits above the page in the tree, so it cannot know that
 * `/workspace/project/6716…/timeline` means "ESS-HR › ESS-HR Additional PTK ›
 * Timeline" — only the page has the project. This carries that upwards, and
 * the header falls back to the navigation definition when nothing is set.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<Crumb[] | null>(null);
  const value = useMemo(() => ({ trail, setTrail }), [trail]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbTrail(): Crumb[] | null {
  return useContext(BreadcrumbContext)?.trail ?? null;
}

/**
 * Publishes a trail for as long as the page is mounted.
 *
 * Render it anywhere in the page body; it draws nothing. The trail is compared
 * by value rather than by identity so a caller can pass an inline array
 * without re-publishing on every render, and it is cleared on unmount so the
 * next page starts from the navigation-derived default instead of inheriting
 * the last one's.
 */
export function SetBreadcrumbs({ trail }: { trail: Crumb[] }) {
  const store = useContext(BreadcrumbContext);
  const serialised = JSON.stringify(trail);

  useEffect(() => {
    if (!store) return;
    store.setTrail(JSON.parse(serialised) as Crumb[]);
    return () => store.setTrail(null);
    // `store` is stable apart from `trail`, which is what `serialised` tracks;
    // depending on the object itself would loop through its own update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised]);

  return null;
}
