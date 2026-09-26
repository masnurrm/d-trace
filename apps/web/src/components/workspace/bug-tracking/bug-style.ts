import type { BugEnvironment, BugSeverity, BugStatus, BugView } from '@dtrace/shared';

/** The environment filter's "no filter" value — also what `?env=all` means. */
export const ENV_ALL = 'ALL';
export type EnvironmentFilter = BugEnvironment | typeof ENV_ALL;

/**
 * One colour per status, used by the legend, the badge, the summary card and
 * the timeline bar at once — the bar is the only place the status is shown
 * without its name, so it has to mean the same thing there as in the column
 * beside it.
 */
export const BUG_STATUS_STYLE: Record<
  BugStatus,
  { dot: string; badge: string; bar: string; tile: string }
> = {
  OPEN: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-700 ring-slate-200',
    bar: 'bg-slate-400',
    tile: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  IN_PROGRESS: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-blue-200',
    bar: 'bg-blue-500',
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300',
  },
  PENDING_TEST: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    bar: 'bg-amber-500',
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
  },
  IN_QA: {
    dot: 'bg-violet-500',
    badge: 'bg-violet-50 text-violet-700 ring-violet-200',
    bar: 'bg-violet-500',
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300',
  },
  DONE: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    bar: 'bg-emerald-500',
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
  },
};

/** Severity keeps the traffic-light reading; status does not borrow it. */
export const SEVERITY_STYLE: Record<BugSeverity, string> = {
  HIGH: 'bg-red-50 text-red-700 ring-red-200',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-200',
  LOW: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

/** Production is red on purpose: a bug there is an incident, not a finding. */
export const ENVIRONMENT_STYLE: Record<BugEnvironment, string> = {
  SIT: 'bg-sky-50 text-sky-700 ring-sky-200',
  UAT: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  PROD: 'bg-red-50 text-red-700 ring-red-200',
};

/* -------------------------------------------------------------------------- */
/* Days                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Days are compared as `YYYY-MM-DD` strings, never as instants.
 *
 * Found and target dates are calendar days stored as midnight UTC, so their day
 * is the first ten characters. The server's own stamps (handed to QA, resolved)
 * and "today" are real instants, so their day is the one on the reader's clock.
 * Mixing the two as `Date` objects would move a bug found "on the 25th" to the
 * 24th for anyone west of Greenwich.
 *
 * The zone comes from `useLocalTimeZone()`, which is `undefined` — read as UTC —
 * until hydration, so the server's HTML and the browser's first render agree.
 */
export const storedDay = (iso: string): string => iso.slice(0, 10);

/** `en-CA` because its short date *is* `YYYY-MM-DD`. */
export function dayIn(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export const instantDay = (iso: string, timeZone: string | undefined): string =>
  dayIn(new Date(iso), timeZone);

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

export function formatDay(day: string | null): string {
  if (!day) return '—';
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Still open and past its target day. */
export function isOverdue(bug: Pick<BugView, 'status' | 'fixEta'>, today: string): boolean {
  return bug.status !== 'DONE' && bug.fixEta !== null && storedDay(bug.fixEta) < today;
}

/**
 * The span a bug occupies on the timeline.
 *
 * It starts the day it was found. A resolved bug ends the day it reached Done;
 * an open one ends on its target, or today when it has none or has passed it —
 * an open bug is still taking up somebody's time today, whatever was planned.
 * Past the target, the days between it and today are the overrun, drawn red
 * the way the project timeline draws a late task.
 */
export function spanOf(
  bug: Pick<BugView, 'status' | 'foundAt' | 'fixEta' | 'resolvedAt'>,
  today: string,
  timeZone: string | undefined,
): { start: string; end: string; overrunFrom: string | null } {
  const start = storedDay(bug.foundAt);
  const eta = bug.fixEta ? storedDay(bug.fixEta) : null;

  if (bug.status === 'DONE') {
    const end = bug.resolvedAt ? instantDay(bug.resolvedAt, timeZone) : (eta ?? start);
    return { start, end: end < start ? start : end, overrunFrom: null };
  }

  if (eta && eta < today) {
    return { start, end: today, overrunFrom: addDays(eta, 1) };
  }

  const end = eta ?? today;
  return { start, end: end < start ? start : end, overrunFrom: null };
}
