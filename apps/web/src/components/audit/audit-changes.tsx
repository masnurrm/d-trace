import { toFieldChanges, type FieldChange, type FieldValues } from '@dtrace/shared';
import { cn } from '@/lib/utils/cn';

/**
 * Blue for a value that appeared, green for one that moved, red for one that
 * went away - the same three colours whether the whole row was inserted,
 * edited or deleted.
 */
const KIND_STYLES: Record<FieldChange['kind'], { chip: string; label: string; rail: string }> = {
  added: {
    chip: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
    label: 'Tambah',
    rail: 'border-l-blue-400',
  },
  updated: {
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
    label: 'Ubah',
    rail: 'border-l-emerald-400',
  },
  removed: {
    chip: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
    label: 'Hapus',
    rail: 'border-l-red-400',
  },
};

/** Renders a stored value the way it was stored, not the way it reads nicely. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (value === '') return '(kosong)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function ValueLine({ tone, prefix, value }: { tone: string; prefix: string; value: unknown }) {
  return (
    <div className="flex gap-2 font-mono text-xs">
      <span aria-hidden className={cn('select-none', tone)}>
        {prefix}
      </span>
      <pre className={cn('min-w-0 flex-1 break-words whitespace-pre-wrap', tone)}>
        {formatValue(value)}
      </pre>
    </div>
  );
}

export interface AuditChangesProps {
  before: FieldValues | null;
  after: FieldValues | null;
  /** True when the record predates row snapshots, so "no changes" is wrong. */
  unavailable?: boolean;
}

/**
 * The field-level diff for one audit record.
 *
 * An insert shows every column arriving from nothing; an update shows only the
 * fields that moved, because that is all the trail stored; a delete shows the
 * row as it last was. Values are printed raw - this is evidence, so it is not
 * the place to prettify a timestamp or shorten an id.
 */
export function AuditChanges({ before, after, unavailable = false }: AuditChangesProps) {
  const changes = toFieldChanges({ before, after });

  if (changes.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {unavailable
          ? 'Catatan ini dibuat sebelum perubahan baris ikut disimpan.'
          : 'Tidak ada perubahan kolom yang tercatat.'}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {changes.map((change) => {
        const style = KIND_STYLES[change.kind];

        return (
          <li
            key={change.field}
            className={cn(
              'space-y-1.5 rounded-md border border-slate-200 border-l-4 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40',
              style.rail,
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                {change.field}
              </code>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                  style.chip,
                )}
              >
                {style.label}
              </span>
            </div>

            {change.kind !== 'added' && (
              <ValueLine tone="text-red-700 dark:text-red-400" prefix="−" value={change.before} />
            )}
            {change.kind !== 'removed' && (
              <ValueLine
                tone={
                  change.kind === 'added'
                    ? 'text-blue-700 dark:text-blue-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }
                prefix="+"
                value={change.after}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
