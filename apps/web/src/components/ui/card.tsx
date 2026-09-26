import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/** Surface primitive. Everything that sits on the page background uses it. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  tinted = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Sits on the right: a toggle, a menu, a link. */
  action?: ReactNode;
  /** A rendered element, never a component reference - a server component
   * cannot hand the latter to a client one. */
  icon?: ReactNode;
  /** A faint wash behind the header, to separate it from the rows below. */
  tinted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800',
        tinted && 'bg-sky-50/60 dark:bg-sky-950/20',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800',
        className,
      )}
      {...props}
    />
  );
}
