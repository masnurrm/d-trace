'use client';

import { useState, type ReactNode } from 'react';
import { FilterBar, type FilterDef, type FilterValues } from '@/components/ui/filter-bar';
import { useUrlFilters } from '@/lib/query/use-url-filters';

function readFromUrl(filters: FilterDef[], params: URLSearchParams): FilterValues {
  return Object.fromEntries(filters.map((filter) => [filter.name, params.get(filter.name) ?? '']));
}

export interface UrlFilterBarProps {
  filters: FilterDef[];
  isPending?: boolean;
  collapsible?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * `FilterBar` wired to the URL.
 *
 * Typing is local state, so every keystroke does not become a history entry;
 * pressing Terapkan is what writes the URL, and that single write is what the
 * list's query key is derived from. Resetting drops only the keys this bar
 * owns, so it cannot silently clear a filter some other control put there.
 */
export function UrlFilterBar({
  filters,
  isPending,
  collapsible,
  title,
  description,
  icon,
  className,
}: UrlFilterBarProps) {
  const { searchParams, setFilters } = useUrlFilters();
  const urlKey = searchParams.toString();

  const [values, setValues] = useState<FilterValues>(() => readFromUrl(filters, searchParams));

  // Closed on arrival, except when the link already carries a filter: a list
  // that is silently filtered, with no visible reason why, is worse than a
  // panel taking up room.
  const [defaultOpen] = useState(() =>
    filters.some((filter) => (searchParams.get(filter.name) ?? '') !== ''),
  );
  const [syncedFrom, setSyncedFrom] = useState(urlKey);

  // The URL can move without this bar: the back button, or a pasted link. When
  // it does, the inputs follow. Adjusting during render rather than in an
  // effect avoids a second paint with stale inputs — and avoids the loop an
  // effect would hit if a caller passed an inline `filters` array.
  if (syncedFrom !== urlKey) {
    setSyncedFrom(urlKey);
    setValues(readFromUrl(filters, searchParams));
  }

  return (
    <FilterBar
      filters={filters}
      values={values}
      isPending={isPending}
      collapsible={collapsible}
      defaultOpen={defaultOpen}
      title={title}
      description={description}
      icon={icon}
      className={className}
      onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      onApply={() =>
        setFilters((params) => {
          for (const filter of filters) {
            const value = values[filter.name]?.trim() ?? '';
            if (value) params.set(filter.name, value);
            else params.delete(filter.name);
          }
          // Any filter change invalidates the current page number.
          params.delete('page');
        })
      }
      onReset={() => {
        setValues(Object.fromEntries(filters.map((filter) => [filter.name, ''])));
        setFilters((params) => {
          for (const filter of filters) params.delete(filter.name);
          params.delete('page');
        });
      }}
    />
  );
}
