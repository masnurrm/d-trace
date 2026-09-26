'use client';

import { Check, ChevronsUpDown, LayoutGrid, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { AppMode } from '@dtrace/shared';
import { MODE_HOME, MODE_LABELS } from './navigation';
import { cn } from '@/lib/utils/cn';

const MODE_ICONS: Record<AppMode, typeof ShieldCheck> = {
  workspace: LayoutGrid,
  admin: ShieldCheck,
};

const MODE_HINTS: Record<AppMode, string> = {
  workspace: 'Project dan dokumen Anda',
  admin: 'Konfigurasi platform',
};

export interface ModeSwitcherProps {
  current: AppMode;
  /** Modes this account may enter. One entry renders a label, not a menu. */
  available: AppMode[];
}

/**
 * The scope picker at the top of the sidebar.
 *
 * With a single mode available it deliberately still renders — as a plain
 * label of the same height, not as a disabled button. An account that will
 * never see the Admin Panel should not be shown a control that hints at one,
 * and the sidebar below it must not shift by a pixel between the two cases.
 */
export function ModeSwitcher({ current, available }: ModeSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const CurrentIcon = MODE_ICONS[current];
  const canSwitch = available.length > 1;

  // Same box, same height, whether or not it can be opened.
  const boxClasses =
    'flex h-10 w-full items-center gap-2 rounded-lg border border-slate-700/60 px-3 text-sm font-medium text-slate-200';

  if (!canSwitch) {
    return (
      <div className="mx-3 mb-3">
        <div className={boxClasses}>
          <CurrentIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">{MODE_LABELS[current]}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative mx-3 mb-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(boxClasses, 'transition-colors hover:bg-slate-800 hover:text-white')}
      >
        <CurrentIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span className="flex-1 truncate text-left">{MODE_LABELS[current]}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Mode
          </p>
          {available.map((mode) => {
            const Icon = MODE_ICONS[mode];
            const isCurrent = mode === current;

            return (
              <button
                key={mode}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) router.push(MODE_HOME[mode]);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{MODE_LABELS[mode]}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {MODE_HINTS[mode]}
                  </span>
                </span>
                {isCurrent && <Check className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
