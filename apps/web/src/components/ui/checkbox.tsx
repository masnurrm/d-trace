'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label: string;
}

/**
 * A native checkbox with the app's accent colour. Native keeps the keyboard
 * behaviour and the form semantics a div-with-a-click-handler throws away.
 */
export function Checkbox({ label, className, ...props }: CheckboxProps) {
  const generatedId = useId();
  const id = props.name ? `field-${props.name}` : generatedId;

  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border-slate-300 text-sky-600 accent-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-600',
          className,
        )}
        {...props}
      />
      <label htmlFor={id} className="text-sm text-slate-600 select-none dark:text-slate-300">
        {label}
      </label>
    </div>
  );
}
