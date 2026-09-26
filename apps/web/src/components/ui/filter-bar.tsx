'use client';

import { ChevronDown, ListFilter, RotateCcw } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './button';
import { Card, CardBody, CardHeader } from './card';
import { SelectField, TextField } from './field';
import { cn } from '@/lib/utils/cn';

/**
 * One filter control, described rather than written.
 *
 * A list screen declares what it filters by; it does not lay out its own
 * inputs. That is what stops every new list from growing a slightly different
 * filter row.
 */
export type FilterDef =
  | { kind: 'text'; name: string; label: string; placeholder?: string }
  | {
      kind: 'select';
      name: string;
      label: string;
      placeholder?: string;
      options: { value: string; label: string }[];
    }
  | { kind: 'date'; name: string; label: string };

export type FilterValues = Record<string, string>;

export interface FilterBarProps {
  filters: FilterDef[];
  /** Current draft values, keyed by filter name. */
  values: FilterValues;
  onChange: (name: string, value: string) => void;
  onApply: () => void;
  onReset: () => void;
  isPending?: boolean;
  /** Adds the show/hide toggle. */
  collapsible?: boolean;
  /** Whether the fields start visible. Ignored when not collapsible. */
  defaultOpen?: boolean;
  /** Given a title, the bar renders as its own card with the toggle in the
   * header. Without one it is a bare row, for embedding in someone else's card. */
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * The filter panel every list screen uses.
 *
 * Presentational on purpose: it knows nothing about the URL or about fetching,
 * so it can be driven by URL state today and by something else later without
 * being rewritten. `UrlFilterBar` is the wired-up version.
 */
export function FilterBar({
  filters,
  values,
  onChange,
  onApply,
  onReset,
  isPending = false,
  collapsible = false,
  defaultOpen,
  title,
  description,
  icon,
  className,
}: FilterBarProps) {
  // A collapsible bar that starts open has not given the screen back yet, so
  // closed is the default. A bar that cannot collapse is always open.
  const [open, setOpen] = useState(defaultOpen ?? !collapsible);

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply();
  }

  const toggle = collapsible ? (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-controls="filter-bar-fields"
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {open ? 'Sembunyikan Filter' : 'Tampilkan Filter'}
      <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
    </button>
  ) : null;

  const fields = (
    <form id="filter-bar-fields" onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filters.map((filter) => {
          const value = values[filter.name] ?? '';

          if (filter.kind === 'select') {
            return (
              <SelectField
                key={filter.name}
                name={filter.name}
                label={filter.label}
                placeholder={filter.placeholder}
                options={filter.options}
                value={value}
                onValueChange={(value) => onChange(filter.name, value)}
              />
            );
          }

          return (
            <TextField
              key={filter.name}
              name={filter.name}
              label={filter.label}
              type={filter.kind === 'date' ? 'date' : 'text'}
              placeholder={filter.kind === 'text' ? filter.placeholder : undefined}
              value={value}
              onChange={(event) => onChange(filter.name, event.target.value)}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
        >
          Reset
        </Button>
        <Button
          type="submit"
          loading={isPending}
          leftIcon={<ListFilter className="h-4 w-4" aria-hidden />}
        >
          Terapkan
        </Button>
      </div>
    </form>
  );

  if (title) {
    return (
      <Card className={className}>
        <CardHeader
          title={title}
          description={description}
          icon={icon}
          action={toggle}
          // Collapsed, the header is the whole card; a bottom border under
          // nothing would read as an empty box.
          className={open ? undefined : 'border-b-0'}
        />
        {open && <CardBody className="space-y-4">{fields}</CardBody>}
      </Card>
    );
  }

  return (
    <div className={className}>
      {toggle && <div className="flex justify-end">{toggle}</div>}
      {open && fields}
    </div>
  );
}
