/**
 * Date and time, written the way this app speaks: Indonesian.
 *
 * **Timezone is a parameter, never an assumption.** A server render and a
 * browser render must produce the same characters or React reports a hydration
 * mismatch, and the server's clock is not the reader's. So every function here
 * defaults to UTC — deterministic everywhere — and the reader's own zone is
 * passed in by `useLocalTimeZone()`, which only has an answer after hydration.
 * That is why these stay plain functions: the decision belongs to the caller
 * that knows whether it has hydrated yet.
 *
 * Use `<DateTime>` (components/ui/date-time.tsx) rather than calling these
 * directly to display a timestamp; it wires the hook up for you.
 */

const LOCALE = 'id-ID';

/** UTC until a caller says otherwise, because only UTC is the same everywhere. */
const FALLBACK_ZONE = 'UTC';

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A moment in time: `24 Sep 2026, 22.43`.
 *
 * With no zone it renders in UTC and says so, because a bare time in an
 * unstated zone is a time nobody can act on. With the reader's zone it says
 * nothing — that is simply the clock on their wall.
 */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone?: string,
): string {
  const date = toDate(value);
  if (!date) return '—';

  const zone = timeZone ?? FALLBACK_ZONE;
  const text = new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(date);

  return zone === 'UTC' ? `${text} UTC` : text;
}

/**
 * A calendar day: `24 Sep 2026`.
 *
 * Always read in UTC, and deliberately not offered the reader's zone. A start
 * date or a go-live date is a day somebody picked on a form, stored as
 * midnight; shifting it into a local zone moves it to the previous evening for
 * half the world and renames the day for the other half. The day is the fact.
 */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';

  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

/** Just the clock: `22.43`. */
export function formatTime(
  value: string | Date | null | undefined,
  timeZone?: string,
): string {
  const date = toDate(value);
  if (!date) return '—';

  return new Intl.DateTimeFormat(LOCALE, {
    timeStyle: 'short',
    timeZone: timeZone ?? FALLBACK_ZONE,
  }).format(date);
}

/**
 * How long ago: `2 jam yang lalu`.
 *
 * A difference between two instants, so it needs no timezone — but it does
 * need a clock, and the server's differs from the reader's by however long the
 * response took. That is under a second in practice and the two agree, which is
 * why this one renders on the server. Anything older than a year falls back to
 * an absolute date, which is why the zone is still accepted and passed on.
 */
export function formatRelative(
  value: string | Date | null | undefined,
  timeZone?: string,
): string {
  const date = toDate(value);
  if (!date) return '—';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  let remaining = diffSeconds;
  for (const [unit, limit] of units) {
    if (Math.abs(remaining) < limit) {
      return new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }).format(
        Math.round(remaining),
        unit,
      );
    }
    remaining /= limit;
  }

  return formatDateTime(date, timeZone);
}
