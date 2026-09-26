/**
 * Conversions for `<input type="datetime-local">`, which speaks wall-clock time
 * in the browser's timezone while the API stores absolute instants.
 *
 * Keeping the conversion here means the settings form is the only place that
 * has to think about it, and an announcement scheduled in Jakarta means the
 * same moment to a reader in another zone.
 */

/** ISO instant -> `YYYY-MM-DDTHH:mm` in local time, for an input's value. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T');
}

/** `YYYY-MM-DDTHH:mm` in local time -> ISO instant, or null when empty. */
export function localInputToIso(local: string): string | null {
  if (!local.trim()) return null;

  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

/** Short human range for a schedule badge, e.g. `18 Sep 2026, 20.12 — selamanya`. */
export function formatSchedule(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return 'Tampil terus';

  const formatter = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const start = startsAt ? formatter.format(new Date(startsAt)) : 'Sekarang';
  const end = endsAt ? formatter.format(new Date(endsAt)) : 'selamanya';
  return `${start} — ${end}`;
}
