import type { LucideIcon } from 'lucide-react';
import { Card } from './card';

export function StatCard({
  label,
  value,
  hint,
  Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  Icon?: LucideIcon;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {value}
          </p>
          {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        {Icon && (
          <span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </div>
    </Card>
  );
}
