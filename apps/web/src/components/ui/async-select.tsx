'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './combobox';
import { cn } from '@/lib/utils/cn';

export interface AsyncOption {
  value: string;
  label: string;
  /** A second line under the label — an email, a code, a role. */
  hint?: string;
}

export interface AsyncPage {
  options: AsyncOption[];
  hasNext: boolean;
}

/** Typing pauses this long before a request goes out. */
const DEBOUNCE_MS = 300;

/** How close to the bottom counts as "ask for more". */
const SCROLL_SLACK = 48;

export interface AsyncSelectProps {
  /** Stable prefix; the search text is appended to form the cache key. */
  queryKey: readonly unknown[];
  fetchPage: (search: string, page: number) => Promise<AsyncPage>;
  value: string;
  onValueChange: (value: string) => void;
  /**
   * The selected option, when it may not be in the loaded pages.
   * A preselected value would otherwise show as an empty box until the page
   * that happens to contain it is fetched.
   */
  selected?: AsyncOption | null;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** Rendered under the list, given whatever is currently typed. */
  footer?: (search: string) => ReactNode;
  /**
   * What the reader has typed, as they type it.
   *
   * The dropdown is not the only place an unmatched query matters — a caller
   * may want to offer something outside the popup, where it stays visible once
   * the list closes.
   */
  onSearchChange?: (search: string) => void;
}

/**
 * A searchable dropdown whose options live on the server.
 *
 * The plain `SelectControl` holds every option in memory, which is right for a
 * fixed list — six stages, four statuses. It is wrong for people: an install
 * with two thousand accounts would ship all of them to the browser to render
 * ten. This one asks the API, a page at a time, as the reader types and
 * scrolls.
 *
 * Base UI's own filtering is switched off with `filter={null}`. Leaving it on
 * would filter the page that happened to be loaded, so a name on page three
 * would look like it did not exist.
 */
export function AsyncSelect({
  queryKey,
  fetchPage,
  value,
  onValueChange,
  selected,
  placeholder,
  emptyMessage = 'Tidak ada yang cocok.',
  disabled,
  id,
  className,
  footer,
  onSearchChange,
  ...aria
}: AsyncSelectProps) {
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');

  /*
   * The callback is held in a ref so the effect below can depend on `typed`
   * alone. Callers pass an inline closure, which is a new function on every
   * render; depending on it directly would clear and restart the timer forever
   * and the search would never fire.
   */
  const reportSearch = useRef(onSearchChange);
  reportSearch.current = onSearchChange;

  // Debounced: a request per keystroke would put the network ahead of the
  // typist and answer questions nobody finished asking.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      reportSearch.current?.(typed.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery({
    queryKey: [...queryKey, search],
    queryFn: ({ pageParam }) => fetchPage(search, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasNext ? pages.length + 1 : undefined),
    staleTime: 30_000,
  });

  /*
   * Memoised, and that is not a micro-optimisation.
   *
   * `items` is what the combobox tracks its own list against. Handing it a new
   * array on every render told it the list had changed, and it answered by
   * resetting its transient state — clearing the input and dropping focus
   * mid-word. The parent re-renders on every debounce tick, so this fired
   * constantly.
   *
   * The chosen option may sit on a page nobody has scrolled to, so it is put
   * at the front rather than left unrenderable.
   */
  const items = useMemo(() => {
    const options = data?.pages.flatMap((page) => page.options) ?? [];

    return selected && !options.some((option) => option.value === selected.value)
      ? [selected, ...options]
      : options;
  }, [data, selected]);

  const current = items.find((option) => option.value === value) ?? null;

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage) return;

    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - SCROLL_SLACK) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <ComboboxPrimitive.Root
      items={items}
      value={current}
      onValueChange={(option) => onValueChange((option as AsyncOption | null)?.value ?? '')}
      itemToStringLabel={(option) => (option as AsyncOption).label}
      itemToStringValue={(option) => (option as AsyncOption).value}
      isItemEqualToValue={(a, b) => (a as AsyncOption).value === (b as AsyncOption).value}
      // Server-side search: filtering here would only filter what is loaded.
      filter={null}
      onInputValueChange={(next) => setTyped(next)}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        showClear={current !== null}
        className={cn('w-full', className)}
        {...aria}
      />

      <ComboboxContent>
        {isPending ? (
          <p className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Mencari…
          </p>
        ) : (
          <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        )}

        <ComboboxList onScroll={onScroll}>
          {(option: AsyncOption) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.hint && (
                  <span className="block truncate text-xs text-slate-500">{option.hint}</span>
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>

        {isFetchingNextPage && (
          <p className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Memuat lagi…
          </p>
        )}

        {footer && <div className="border-t border-slate-100 p-1">{footer(typed.trim())}</div>}
      </ComboboxContent>
    </ComboboxPrimitive.Root>
  );
}
