'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface TabDefinition {
  id: string;
  label: string;
}

/**
 * Segmented tab bar following the ARIA tabs pattern: arrow keys move between
 * tabs, and only the selected one is in the tab order.
 */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDefinition[];
  active: string;
  onChange: (id: string) => void;
}) {
  const baseId = useId();

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active);
    if (index === -1) return;

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next) onChange(next.id);
  }

  return (
    <div
      role="tablist"
      aria-label="Bagian pengaturan"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:grid-cols-4 dark:bg-slate-800"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}-tab`}
            aria-selected={selected}
            aria-controls={`${baseId}-${tab.id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              selected
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: string;
  children: ReactNode;
}) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" className="space-y-6">
      {children}
    </div>
  );
}
