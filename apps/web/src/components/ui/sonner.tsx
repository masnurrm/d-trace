'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Transient confirmations, top right.
 *
 * For the outcome of an action the reader just took — saved, submitted, failed
 * — and nothing else. A fact about the current state, like "this estimate is
 * locked", belongs in the page where it stays readable; a toast that carries
 * it would take the answer away after four seconds.
 *
 * The generated version read the theme from `next-themes`, which this app does
 * not use: it is light only, by the same decision that rebinds the `dark:`
 * variant to a class nothing sets.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-right"
      /*
       * Coloured by outcome, not uniformly neutral.
       *
       * A toast is read at a glance, off to one side, while the reader is
       * already looking somewhere else — and a saved draft and a failed submit
       * looked identical until the sentence was read. The colour is what makes
       * "this went wrong" land before the words do. The icon carries the same
       * distinction, so the meaning never rests on hue alone.
       */
      richColors
      // Long enough to read a sentence, short enough not to sit over the page.
      duration={4000}
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',

          /*
           * The four outcome palettes, pinned rather than left to Sonner's own
           * defaults: these are the same 50/200/800 steps `Alert` and the stage
           * badges use, so a green here and a green in the page are one green.
           * Every pair clears 4.5:1 against its own tint.
           */
          '--success-bg': '#ecfdf5',
          '--success-border': '#a7f3d0',
          '--success-text': '#065f46',

          '--error-bg': '#fef2f2',
          '--error-border': '#fecaca',
          '--error-text': '#991b1b',

          '--warning-bg': '#fffbeb',
          '--warning-border': '#fde68a',
          '--warning-text': '#92400e',

          '--info-bg': '#eff6ff',
          '--info-border': '#bfdbfe',
          '--info-text': '#1e40af',
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: 'cn-toast' } }}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from 'sonner';
