import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  titleAction,
  actions,
}: {
  title: string;
  description?: string;
  /** A control that acts on the thing the title names, drawn right beside it. */
  titleAction?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h1>
          {titleAction}
        </div>
        {description && <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
