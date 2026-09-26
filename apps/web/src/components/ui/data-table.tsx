import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { SelectControl } from './field';
import type { PaginationMeta } from '@dtrace/shared';
import { cn } from '@/lib/utils/cn';

export interface Column<TRow> {
  key: string;
  /**
   * The field the API sorts by. Present means the header is clickable — so a
   * column can only offer sorting the API actually allows.
   */
  sortKey?: string;
  header: ReactNode;
  /** Returning a node (not a string) lets a cell render a badge or a link. */
  cell: (row: TRow) => ReactNode;
  className?: string;
  headerClassName?: string;
}

/**
 * Row height. Only the vertical padding changes - the horizontal padding stays
 * put so the first column keeps lining up with the card header above it, at
 * every density.
 */
const cellVariants = cva('px-5', {
  variants: {
    density: {
      compact: 'py-1.5',
      comfortable: 'py-3',
    },
  },
  defaultVariants: { density: 'compact' },
});

export type Density = NonNullable<VariantProps<typeof cellVariants>['density']>;

export interface DataTableProps<TRow> {
  columns: Column<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  emptyMessage?: string;
  caption?: string;
  isLoading?: boolean;
  /** Defaults to compact; a table meant to be read rather than scanned passes
   * 'comfortable'. */
  density?: Density;
  /** The field currently sorted by, from the URL. */
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** Called with a column's `sortKey`; omit to disable sorting entirely. */
  onSort?: (sortKey: string) => void;
}

/**
 * Generic over the row type, so the users table and the audit table share one
 * implementation of markup, empty state, loading state and semantics rather
 * than each growing their own.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'Belum ada data.',
  caption,
  isLoading = false,
  density = 'compact',
  sortBy,
  sortOrder,
  onSort,
}: DataTableProps<TRow>) {
  const cellClasses = cellVariants({ density });
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onSort);
              const active = sortable && column.sortKey === sortBy;
              const SortIcon = !active ? ChevronsUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    cellClasses,
                    'whitespace-nowrap text-sm font-semibold text-slate-700 dark:text-slate-200',
                    column.headerClassName,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(column.sortKey!)}
                      className="inline-flex items-center gap-1.5 rounded transition-colors hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      {column.header}
                      <SortIcon
                        className={cn('h-3.5 w-3.5', active ? 'text-sky-600' : 'text-slate-400')}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={columns.length} className="px-5 py-10 text-center text-slate-500">
                Memuat…
              </td>
            </tr>
          )}

          {!isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-5 py-10 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          )}

          {!isLoading &&
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(cellClasses, 'text-slate-700 dark:text-slate-300', column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/** Row counts an operator can choose from. The API caps a page at 100. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

/**
 * The page numbers to render, with gaps collapsed into an ellipsis.
 *
 * Always keeps the first and last page reachable — on a 1229-page audit trail,
 * "go to the end" should not mean clicking Next a thousand times.
 */
export function paginationItems(
  current: number,
  totalPages: number,
  siblings = 1,
): (number | 'ellipsis')[] {
  // first + last + current + siblings on both sides + two ellipses
  const maxSlots = siblings * 2 + 5;
  if (totalPages <= maxSlots) return range(1, totalPages);

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, totalPages);
  const gapLeft = left > 2;
  const gapRight = right < totalPages - 1;

  if (!gapLeft && gapRight) return [...range(1, siblings * 2 + 3), 'ellipsis', totalPages];
  if (gapLeft && !gapRight) return [1, 'ellipsis', ...range(totalPages - (siblings * 2 + 2), totalPages)];
  return [1, 'ellipsis', ...range(left, right), 'ellipsis', totalPages];
}

export type PaginationBarProps = {
  meta: PaginationMeta;
  /** Renders the rows-per-page picker. Omit it to hide the control. */
  onPageSizeChange?: (size: number) => void;
} & (
  | {
      /**
       * Server-rendered tables pass a link builder. Paging is then plain
       * navigation - it works before hydration and survives a reload.
       */
      buildHref: (page: number) => string;
      onPageChange?: never;
    }
  | {
      /** Client tables pass a handler instead. */
      onPageChange: (page: number) => void;
      buildHref?: never;
    }
);

export function PaginationBar({
  meta,
  onPageChange,
  onPageSizeChange,
  buildHref,
}: PaginationBarProps) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  const controlClasses =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-300 px-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
  const disabledClasses = 'pointer-events-none opacity-40';
  const currentClasses =
    'border-sky-600 bg-sky-600 text-white hover:bg-sky-600 dark:border-sky-600 dark:text-white';

  /** One clickable page target, as a link or a button depending on the variant. */
  const control = (page: number, label: string, disabled: boolean, current = false) => {
    const className = cn(controlClasses, current && currentClasses, disabled && disabledClasses);

    // A server component cannot hand an onClick to the client, so the link
    // variant renders a span when disabled rather than an inert button.
    if (buildHref) {
      return disabled ? (
        <span key={label} className={className} aria-disabled="true">
          {label}
        </span>
      ) : (
        <a
          key={label}
          href={buildHref(page)}
          className={className}
          aria-current={current ? 'page' : undefined}
        >
          {label}
        </a>
      );
    }

    return (
      <button
        key={label}
        type="button"
        className={className}
        disabled={disabled}
        aria-current={current ? 'page' : undefined}
        onClick={() => onPageChange?.(page)}
      >
        {label}
      </button>
    );
  };

  return (
    <nav
      aria-label="Paginasi"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400"
    >
      <p>
        Menampilkan <span className="font-medium text-slate-700 dark:text-slate-200">{from}</span>–
        <span className="font-medium text-slate-700 dark:text-slate-200">{to}</span> dari{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">{meta.total}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <SelectControl
            aria-label="Baris per halaman"
            className="h-9 w-36"
            value={String(meta.limit)}
            onValueChange={(size) => size && onPageSizeChange(Number(size))}
            options={PAGE_SIZE_OPTIONS.map((size) => ({
              value: String(size),
              label: `${size} / halaman`,
            }))}
          />
        )}

        {control(meta.page - 1, '‹', !meta.hasPrev)}

        {paginationItems(meta.page, meta.totalPages).map((item, index) =>
          item === 'ellipsis' ? (
            <span
              // Two ellipses can appear, so the index is what tells them apart.
              key={`ellipsis-${index}`}
              aria-hidden
              className="px-1 text-slate-400"
            >
              …
            </span>
          ) : (
            control(item, String(item), false, item === meta.page)
          ),
        )}

        {control(meta.page + 1, '›', !meta.hasNext)}
      </div>
    </nav>
  );
}
