'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { PopupContainerProvider } from './popup-container';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Built on the native `<dialog>` element rather than a div-with-a-backdrop.
 *
 * `showModal()` gives the focus trap, the inert background, the top layer and
 * Escape-to-close for free — all things a hand-rolled modal reimplements badly.
 * What is left to do here is closing on a backdrop click and keeping React's
 * `open` prop in step with the element's own state.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // Held as state as well as a ref: the ref alone would not re-render the
  // provider below when the element arrives, so a dropdown rendered on the
  // first paint would still portal to the body.
  const [element, setElement] = useState<HTMLDialogElement | null>(null);

  const attach = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setElement(node);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={attach}
      // `cancel` fires on Escape; let React own the state rather than the DOM.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog element itself is on the backdrop:
        // the content sits in a child, so anything inside stops here.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        // A native <dialog> is centred by the UA stylesheet with `margin: auto`
        // against `inset: 0`. Tailwind's preflight zeroes every margin, which
        // takes that away and drops the dialog in the top-left corner - so the
        // centring is restated here. `h-fit` is the part that matters: with
        // `inset-0` and an auto height the box would stretch instead of centre.
        'fixed inset-0 m-auto h-fit max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
        SIZES[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/*
        Popups opened from inside this dialog portal into the dialog, not the
        body: the body is in the normal layer and a modal <dialog> is in the
        top layer above it, so a dropdown portalled out would be painted behind
        the very dialog that opened it.
      */}
      <PopupContainerProvider value={element}>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </PopupContainerProvider>

      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          {footer}
        </div>
      )}
    </dialog>
  );
}
