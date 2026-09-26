'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Renders in red and sits below a separator: destructive, not routine. */
  danger?: boolean;
  disabled?: boolean;
}

const DEFAULT_WIDTH = 208;
const GAP = 4;

/**
 * The row action menu.
 *
 * The panel is rendered in a portal on `document.body`, not next to its
 * trigger. A row menu usually lives inside a table that scrolls, and an
 * absolutely-positioned panel inside a scroll container gets clipped by it —
 * the menu ends up trapped behind a scrollbar instead of floating over the
 * page. Portalling escapes that, at the cost of positioning by hand.
 *
 * It keeps the three behaviours people expect from a menu: Escape closes it,
 * a click outside closes it, and arrow keys move through the items.
 */
export function DropdownMenu({
  actions,
  label = 'Aksi lainnya',
  trigger,
  triggerClassName,
  header,
  width = DEFAULT_WIDTH,
}: {
  actions: MenuAction[];
  label?: string;
  /** Replaces the default "…" button. A rendered element, not a component. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Sits above the items, separated: who this menu is about. */
  header?: ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Measured before paint, so the panel never flashes in the wrong corner.
  useLayoutEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? actions.length * 40 + 8;

    // Flip above when there is no room below, and never run off the left edge.
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < height + GAP ? rect.top - height - GAP : rect.bottom + GAP;
    const left = Math.max(GAP, rect.right - width);

    setPosition({ top, left });
  }, [open, actions.length, width]);

  useEffect(() => {
    if (!open) return;

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // A fixed panel would drift away from its row once anything scrolls, so it
    // closes instead of chasing the trigger.
    const handleScroll = () => setOpen(false);

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  function moveFocus(from: number, step: number) {
    const next = (from + step + actions.length) % actions.length;
    itemsRef.current[next]?.focus();
  }

  const routine = actions.filter((action) => !action.danger);
  const destructive = actions.filter((action) => action.danger);
  const ordered = [...routine, ...destructive];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          trigger
            ? 'rounded-lg transition-colors'
            : 'rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100',
          triggerClassName,
        )}
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" aria-hidden />}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width,
              // Hidden until measured, rather than rendered in the corner first.
              visibility: position ? 'visible' : 'hidden',
            }}
            className="z-50 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            {header && (
              <>
                <div className="px-3 py-2">{header}</div>
                <div className="mb-1 border-t border-slate-200 dark:border-slate-700" />
              </>
            )}
            {ordered.map((action, index) => (
              <div key={action.label}>
                {/* A hairline before the destructive group, so a stray click on
                    "delete" takes a deliberate extra glance. */}
                {action.danger && routine.length > 0 && index === routine.length && (
                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                )}
                <button
                  ref={(element) => {
                    itemsRef.current[index] = element;
                  }}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveFocus(index, 1);
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveFocus(index, -1);
                    }
                  }}
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    action.danger
                      ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                  )}
                >
                  {action.icon}
                  {action.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
