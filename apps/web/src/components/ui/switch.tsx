'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * A toggle built on `role="switch"` rather than a styled checkbox: it announces
 * "on"/"off" to a screen reader, and the label is clickable because it is tied
 * to the control by id.
 */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-50',
          checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>

      <div className="space-y-0.5">
        <label htmlFor={id} className="block text-sm font-medium text-slate-900 dark:text-slate-100">
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="text-xs text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
