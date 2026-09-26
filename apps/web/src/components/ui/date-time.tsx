'use client';

import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { useLocalTimeZone } from '@/lib/utils/use-local-time-zone';

export interface DateTimeProps {
  value: string | Date | null | undefined;
  /** `24 Sep 2026, 22.43` by default; `2 jam yang lalu` when relative. */
  relative?: boolean;
  /** Shown instead of a dash when there is nothing to show. */
  fallback?: string;
  className?: string;
}

/**
 * A timestamp, in the reader's own timezone.
 *
 * Every timestamp in this app arrives as UTC from the API, and the reader is in
 * Jakarta, or Makassar, or somewhere else entirely. Rendering the raw UTC made
 * the server and the browser agree at the cost of making the reader do the
 * arithmetic — "15:43 UTC" is not a time anybody recognises as half past ten at
 * night.
 *
 * So the server still renders UTC, and the browser re-renders in local time the
 * moment it hydrates. The HTML and the first paint match, so React is happy;
 * what settles a moment later is the clock the reader actually lives by. The
 * machine-readable instant stays on the `dateTime` attribute either way, and
 * the `title` keeps UTC within reach for anyone comparing against a log.
 */
export function DateTime({ value, relative = false, fallback = '—', className }: DateTimeProps) {
  const timeZone = useLocalTimeZone();

  if (!value) return <span className={className}>{fallback}</span>;

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return <span className={className}>{fallback}</span>;

  const text = relative ? formatRelative(date, timeZone) : formatDateTime(date, timeZone);

  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className={className}>
      {text}
    </time>
  );
}
