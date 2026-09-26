import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

const TONES = {
  info: {
    wrapper: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
    Icon: Info,
  },
  success: {
    wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
    Icon: CheckCircle2,
  },
  warning: {
    wrapper: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
    Icon: AlertTriangle,
  },
  danger: {
    wrapper: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
    Icon: XCircle,
  },
} as const;

export interface AlertProps {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * `role="alert"` on the danger tone only: assertive announcements are for
 * things that went wrong, not for every confirmation message.
 */
export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const { wrapper, Icon } = TONES[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', wrapper, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}
