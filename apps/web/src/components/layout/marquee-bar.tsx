'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import type { MarqueeItemView } from '@dtrace/shared';
import { isMarqueeItemActive } from '@dtrace/shared';
import { cn } from '@/lib/utils/cn';

interface MarqueeBarProps {
  items: MarqueeItemView[];
  speedSeconds: number;
}

/**
 * The scrolling announcement strip under the header.
 *
 * Three things it deliberately does:
 *
 *  - re-evaluates each item's schedule on a timer, so an announcement starts
 *    and stops without the reader reloading the page;
 *  - offers a pause button, because moving text that cannot be stopped is a
 *    WCAG failure (2.2.2) and an accessibility problem for anyone reading slowly;
 *  - stays still when the operating system asks for reduced motion, showing the
 *    text statically rather than not at all.
 */
export function MarqueeBar({ items, speedSeconds }: MarqueeBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  // `useSyncExternalStore` is the right tool for reading a browser API like
  // matchMedia: no effect, no state update during render, and the server
  // snapshot (false) keeps hydration consistent.
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotion,
    getReducedMotionOnServer,
  );

  // Once every 30s is enough for a schedule expressed in minutes, and cheap.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const active = useMemo(
    () => items.filter((item) => isMarqueeItemActive(item, new Date(now))),
    [items, now],
  );

  if (active.length === 0) return null;

  const content = active.map((item) => (
    <span key={item.id} className="mx-8 inline-flex items-center gap-2">
      {item.kind === 'LINK' && item.url ? (
        <a
          href={item.url}
          className="underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300"
          // The link is operator-supplied and may point off-site.
          target="_blank"
          rel="noopener noreferrer"
        >
          {item.text}
        </a>
      ) : (
        item.text
      )}
    </span>
  ));

  const still = prefersReducedMotion || paused;

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
      <div className="relative flex-1 overflow-hidden" aria-live="polite">
        <div
          className={cn(
            'whitespace-nowrap',
            still ? 'overflow-x-auto' : 'inline-block animate-[dtrace-marquee_linear_infinite]',
          )}
          style={still ? undefined : { animationDuration: `${speedSeconds}s` }}
        >
          {content}
          {/* A second copy makes the loop seamless; hidden from screen readers
              so the announcement is not read out twice. */}
          {!still && <span aria-hidden>{content}</span>}
        </div>
      </div>

      {!prefersReducedMotion && (
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'Jalankan running text' : 'Jeda running text'}
          title={paused ? 'Jalankan' : 'Jeda'}
          className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The server cannot know the preference; assume motion is fine and correct on hydration. */
function getReducedMotionOnServer(): boolean {
  return false;
}
