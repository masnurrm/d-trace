import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '@dtrace/shared';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      tone: {
        /** Filled, for the one value in a column worth spotting at a glance. */
        primary: 'bg-sky-600 text-white ring-sky-600 dark:bg-sky-600 dark:text-white dark:ring-sky-600',
        neutral: 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
        info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
        success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
        warning: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
        danger: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, className, children }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

/** One mapping from role to colour, so the legend means the same thing everywhere. */
const ROLE_TONES: Record<Role, NonNullable<BadgeProps['tone']>> = {
  // The highest rank, and the one worth spotting at a glance in a list.
  [ROLES.SUPER_ADMIN]: 'primary',
  [ROLES.ADMIN]: 'danger',
  [ROLES.AUDITOR]: 'info',
  [ROLES.OPERATOR]: 'success',
  [ROLES.VIEWER]: 'neutral',
};

export function RoleBadge({ role }: { role: Role | string }) {
  const tone = ROLE_TONES[role as Role] ?? 'neutral';
  return <Badge tone={tone}>{ROLE_LABELS[role as Role] ?? role}</Badge>;
}

export function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Aktif' : 'Nonaktif'}</Badge>;
}
