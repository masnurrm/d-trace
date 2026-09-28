import { z } from 'zod';
import { PROJECT_STAGES, type ProjectStage } from './workspace.schema.js';

/**
 * When the work happens, as opposed to how much of it there is.
 *
 * The task list is the mandays plan's — the same rows, not a copy — because
 * "Project kickoff" is one task whether you are estimating it or scheduling
 * it. What the timeline adds is a start, an end and a percentage.
 *
 * It is a separate contract from the estimate on purpose: a plan locks when it
 * is submitted for approval, and the schedule must not. Dates slip while an
 * estimate is being approved, and a timeline nobody may correct is one nobody
 * will trust.
 */

export const timelineTaskSchema = z
  .object({
    id: z.uuid(),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
    progressPercent: z.number().int().min(0).max(100).default(0),
    /** When work really began; independent of the planned start. */
    actualStartsAt: z.iso.datetime().nullable().default(null),
    /** When the work really finished; independent of the planned end. */
    actualEndsAt: z.iso.datetime().nullable().default(null),
  })
  .refine((task) => !task.startsAt || !task.endsAt || task.endsAt >= task.startsAt, {
    message: 'Tanggal selesai tidak boleh mendahului tanggal mulai',
    path: ['endsAt'],
  })
  .refine(
    (task) =>
      !task.actualStartsAt || !task.actualEndsAt || task.actualEndsAt >= task.actualStartsAt,
    {
      message: 'Actual end tidak boleh mendahului actual start',
      path: ['actualEndsAt'],
    },
  );

export type TimelineTaskInput = z.infer<typeof timelineTaskSchema>;

/**
 * Saved whole, like the estimate and the document template: the rows belong to
 * one schedule, and sending them one at a time would leave a project half
 * rescheduled whenever a call failed.
 */
export const saveProjectTimelineSchema = z.object({
  /** The project window the bars are drawn against; null leaves it unset. */
  startsAt: z.iso.datetime().nullable().default(null),
  goLiveAt: z.iso.datetime().nullable().default(null),
  tasks: z.array(timelineTaskSchema).max(300),
  /** The version the page loaded; a stale save is refused, never merged. */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
});

export type SaveProjectTimelineInput = z.infer<typeof saveProjectTimelineSchema>;

export interface TimelineTaskView {
  id: string;
  /** Null for a task sitting directly under its stage. */
  parentId: string | null;
  stage: ProjectStage;
  name: string;
  position: number;
  startsAt: string | null;
  endsAt: string | null;
  progressPercent: number;
  /** When work really began. */
  actualStartsAt: string | null;
  /** When the work really finished. Later than `endsAt` means the task ran late. */
  actualEndsAt: string | null;
  /**
   * Total days the mandays plan estimated for this task, across every role.
   * Carried here so the schedule can be read against the estimate without a
   * second request — a bar much shorter than its estimate is the thing worth
   * spotting.
   */
  estimatedDays: number;
}

export interface ProjectTimelineView {
  projectId: string;
  projectName: string;
  /** The node the project hangs under — the middle crumb in the breadcrumb. */
  node: { id: string; name: string };
  stage: ProjectStage;
  startsAt: string | null;
  goLiveAt: string | null;
  tasks: TimelineTaskView[];
  /**
   * Non-working days, sent with the schedule rather than fetched beside it:
   * the bar positions and the red columns have to agree, and two requests can
   * disagree. The name rides along so a red column can say why it is red.
   */
  holidays: { date: string; name: string }[];
  canEdit: boolean;
  updatedAt: string;
}

/** Calendar days a bar spans, inclusive of both ends. */
export function calendarDays(startsAt: string | null, endsAt: string | null): number | null {
  if (!startsAt || !endsAt) return null;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/**
 * Working days a bar spans, weekends removed.
 *
 * Public holidays are not subtracted: the platform has no holiday calendar,
 * and quietly guessing at one would make the number wrong in a way nobody
 * could see. Weekends are the part that is true everywhere.
 */
export function workingDays(startsAt: string | null, endsAt: string | null): number | null {
  if (!startsAt || !endsAt) return null;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  let days = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

/** Progress across a stage, weighted by nothing — every task counts once. */
export function stageProgress(tasks: TimelineTaskView[]): number {
  if (tasks.length === 0) return 0;
  const total = tasks.reduce((sum, task) => sum + task.progressPercent, 0);
  return Math.round(total / tasks.length);
}

export const TIMELINE_STAGE_ORDER = PROJECT_STAGES;

/* -------------------------------------------------------------------------- */
/* Scheduling                                                                  */
/* -------------------------------------------------------------------------- */

/** One task as the scheduler sees it: an id and how many days it needs. */
export interface SchedulableTask {
  id: string;
  /** Working days of effort, from the mandays estimate. */
  days: number;
}

export interface ScheduledDates {
  startsAt: string;
  endsAt: string;
}

const DAY_MS = 86_400_000;

function nextDay(date: Date): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

/**
 * Lays tasks end to end from a start date, stepping over non-working days.
 *
 * Strictly sequential: task two starts the working day after task one ends.
 * That is the shape the Gantt in the brief has, and it makes the project's
 * total duration the sum of its estimate — a number somebody can check.
 *
 * **A task with no estimate is not scheduled at all** — it is absent from the
 * result and keeps no dates. Zero days used to be rounded up to one, on the
 * reasoning that a bar of no width reads as missing; but a task nobody has
 * estimated *is* missing, and rounding it up invented a day of work, moved
 * every task after it along by one, and gave a project estimated at nothing a
 * full calendar. Half a day still rounds up to one: that is an estimate, and a
 * real one.
 *
 * `holidays` are `YYYY-MM-DD` keys. Weekends are skipped unconditionally
 * because they are true everywhere; holidays are data and may be empty, in
 * which case the schedule is honest about only knowing about weekends.
 */
export function scheduleSequentially(
  tasks: readonly SchedulableTask[],
  startsAt: string,
  holidays: ReadonlySet<string> = new Set(),
): Record<string, ScheduledDates> {
  const result: Record<string, ScheduledDates> = {};

  let cursor = new Date(`${startsAt.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime())) return result;

  const isWorking = (date: Date) => {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false;
    return !holidays.has(date.toISOString().slice(0, 10));
  };

  const advanceToWorkingDay = (from: Date) => {
    let date = new Date(from);
    // A bounded walk: a year of consecutive holidays is a broken calendar, not
    // a schedule, and an unbounded loop would hang the request rather than say so.
    for (let guard = 0; guard < 400 && !isWorking(date); guard += 1) {
      date = nextDay(date);
    }
    return date;
  };

  for (const task of tasks) {
    if (!(task.days > 0)) continue;
    const needed = Math.max(1, Math.ceil(task.days));

    const start = advanceToWorkingDay(cursor);
    let end = new Date(start);

    for (let counted = 1; counted < needed; counted += 1) {
      end = advanceToWorkingDay(nextDay(end));
    }

    result[task.id] = {
      startsAt: `${start.toISOString().slice(0, 10)}T00:00:00.000Z`,
      endsAt: `${end.toISOString().slice(0, 10)}T00:00:00.000Z`,
    };

    cursor = nextDay(end);
  }

  return result;
}

/** Working days between two dates, weekends and holidays removed. */
export function workingDaysBetween(
  startsAt: string | null,
  endsAt: string | null,
  holidays: ReadonlySet<string> = new Set(),
): number | null {
  if (!startsAt || !endsAt) return null;

  const start = new Date(`${startsAt.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${endsAt.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  let days = 0;
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (holidays.has(cursor.toISOString().slice(0, 10))) continue;
    days += 1;
  }

  return days;
}

/**
 * A task finished after the day it was planned to end.
 *
 * Compared by calendar day, not by instant: both dates are picked as days, and
 * a time of day that crept in through a timezone must not make a task that
 * finished on its planned day read as late.
 */
export function isFinishedLate(task: {
  endsAt: string | null;
  actualEndsAt: string | null;
}): boolean {
  if (!task.endsAt || !task.actualEndsAt) return false;
  return task.actualEndsAt.slice(0, 10) > task.endsAt.slice(0, 10);
}
