import { z } from 'zod';

/**
 * Implementation Plan: the runbook a release goes live by — every step of the
 * cut-over in the order it is run, how long each is expected to take, and what
 * actually happened when it ran.
 *
 * One plan per project, shaped phase → step and saved **whole**, like the test
 * scripts: a runbook is read top to bottom, the order is what it says, and the
 * estimated schedule is a running sum down the whole list, so a step means
 * little outside the rows above it. The structure travels as one JSON payload
 * with the same `expectedUpdatedAt` guard as every other replace-the-whole-thing
 * form.
 *
 * The estimate and the actual are kept side by side rather than one overwriting
 * the other, for the same reason the timeline keeps a planned end beside the
 * actual one: "how long was the service down, against how long we said it
 * would be" is the question this document exists to answer afterwards.
 */

export const IMPLEMENTATION_STEP_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'DONE',
  'FAILED',
  'SKIPPED',
] as const;
export type ImplementationStepStatus = (typeof IMPLEMENTATION_STEP_STATUSES)[number];

export const IMPLEMENTATION_STEP_STATUS_LABELS: Record<ImplementationStepStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

/**
 * Only Done and Skipped settle a step. Failed does not: a failed step is the
 * one thing a plan must not be marked finished over, since "finished" is what
 * the people waiting for the service to come back will read.
 */
export function isImplementationStepSettled(status: ImplementationStepStatus): boolean {
  return status === 'DONE' || status === 'SKIPPED';
}

export const IMPLEMENTATION_PLAN_STATUSES = ['DRAFT', 'COMPLETED'] as const;
export type ImplementationPlanStatus = (typeof IMPLEMENTATION_PLAN_STATUSES)[number];

export const IMPLEMENTATION_PLAN_STATUS_LABELS: Record<ImplementationPlanStatus, string> = {
  DRAFT: 'Draft',
  COMPLETED: 'Selesai',
};

/** Where the estimate starts counting when nobody has said otherwise. */
export const DEFAULT_IMPLEMENTATION_START = '22:00';

interface DefaultImplementationStep {
  activity: string;
  host: string;
  downtime: boolean;
  pic: string;
  durationMinutes: number;
  note?: string;
}

/**
 * What a plan starts with before anybody has saved one: a deliberately generic
 * sample. It demonstrates each field without using real hosts, addresses, or
 * operational details, and every value remains editable before the first save.
 *
 * No implementation date: a day in a template would be wrong for every project
 * but one.
 */
export const DEFAULT_IMPLEMENTATION_PLAN: {
  serviceName: string;
  hosts: readonly { label: string; address: string }[];
  phases: readonly { name: string; steps: readonly DefaultImplementationStep[] }[];
} = {
  serviceName: 'Minor Enhancement Aplikasi',
  hosts: [{ label: 'Application Server', address: 'app-server.example.local' }],
  phases: [
    {
      name: 'Persiapan',
      steps: [
        {
          activity: 'Konfirmasi kesiapan file enhancement',
          host: 'Application Server',
          downtime: false,
          pic: 'Developer',
          durationMinutes: 5,
        },
      ],
    },
    {
      name: 'Implementasi',
      steps: [
        {
          activity: 'Deploy minor enhancement aplikasi',
          host: 'Application Server',
          downtime: false,
          pic: 'Developer',
          durationMinutes: 10,
        },
      ],
    },
    {
      name: 'Validasi',
      steps: [
        {
          activity: 'Lakukan smoke test pada fitur yang diperbarui',
          host: 'Application Server',
          downtime: false,
          pic: 'QA',
          durationMinutes: 5,
        },
      ],
    },
  ],
};

/** A step's estimate, in minutes. A day is the ceiling: a longer step is several steps. */
export const IMPLEMENTATION_STEP_MAX_MINUTES = 24 * 60;

/* -------------------------------------------------------------------------- */
/* The payload                                                                 */
/* -------------------------------------------------------------------------- */

const text = (max: number) => z.string().trim().max(max).default('');

/**
 * One step, as the browser sends it.
 *
 * `id` is minted by the browser so a row keeps its identity across saves.
 * The actual start and finish are full timestamps, not times of day: a
 * cut-over that starts at 22:00 routinely finishes after midnight, and a
 * duration worked out from two clock readings would come out negative.
 */
export const implementationStepSchema = z
  .object({
    id: z.uuid(),
    activity: text(1000),
    host: text(200),
    /** True when the service is unavailable while this step runs. */
    downtime: z.boolean().default(false),
    pic: text(80),
    durationMinutes: z.number().int().min(1).max(IMPLEMENTATION_STEP_MAX_MINUTES).default(5),
    estimatedStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
    estimatedEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
    actualStartedAt: z.iso.datetime().nullable().default(null),
    actualFinishedAt: z.iso.datetime().nullable().default(null),
    actualDurationMinutes: z.number().int().min(0).max(IMPLEMENTATION_STEP_MAX_MINUTES).nullable().default(null),
    status: z.enum(IMPLEMENTATION_STEP_STATUSES).default('NOT_STARTED'),
    note: text(1000),
  })
  .refine((step) => !step.actualFinishedAt || step.actualStartedAt, {
    path: ['actualFinishedAt'],
    message: 'Waktu selesai aktual diisi tanpa waktu mulai',
  })
  .refine(
    (step) =>
      !step.actualFinishedAt ||
      !step.actualStartedAt ||
      Date.parse(step.actualFinishedAt) >= Date.parse(step.actualStartedAt),
    { path: ['actualFinishedAt'], message: 'Waktu selesai aktual tidak boleh sebelum waktu mulai' },
  );

export type ImplementationStepInput = z.infer<typeof implementationStepSchema>;

export const implementationPhaseSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().max(120).default(''),
  steps: z.array(implementationStepSchema).max(200),
});

export type ImplementationPhaseInput = z.infer<typeof implementationPhaseSchema>;

/** A server the plan touches, named once in the header so a step can refer to it. */
export const implementationHostSchema = z.object({
  id: z.uuid(),
  label: text(60),
  address: text(200),
});

export type ImplementationHostInput = z.infer<typeof implementationHostSchema>;

export const saveImplementationPlanSchema = z.object({
  serviceName: text(160),
  /** A calendar day, `YYYY-MM-DD`. */
  implementationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid')
    .nullable()
    .default(null),
  /** `HH:MM` — where the estimated schedule starts counting. */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Jam mulai tidak valid')
    .default(DEFAULT_IMPLEMENTATION_START),
  hosts: z.array(implementationHostSchema).max(20).default([]),
  phases: z.array(implementationPhaseSchema).max(20),
  /**
   * True marks the implementation finished. Refused while any step is not Done
   * or Skipped: a plan marked finished over a failed step would tell everyone
   * waiting on the service that it is back.
   */
  complete: z.boolean().default(false),
  /** See rule 19 in CLAUDE.md — `null` means "I loaded a plan never saved". */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
});

export type SaveImplementationPlanInput = z.infer<typeof saveImplementationPlanSchema>;

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

export type ImplementationStepView = ImplementationStepInput;
export type ImplementationPhaseView = ImplementationPhaseInput;
export type ImplementationHostView = ImplementationHostInput;

export interface ImplementationPlanView {
  projectId: string;
  serviceName: string;
  implementationDate: string | null;
  startTime: string;
  hosts: ImplementationHostView[];
  phases: ImplementationPhaseView[];
  status: ImplementationPlanStatus;
  completedAt: string | null;
  completedByName: string | null;
  /** Null until the first save — the plan is not written just by opening it. */
  updatedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Schedule and totals                                                         */
/* -------------------------------------------------------------------------- */

/** `HH:MM` as minutes after midnight; anything unreadable counts from midnight. */
export function minutesOfClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Minutes after midnight of the implementation day as a clock reading, plus
 * how many days past that day it falls — a step estimated to end at 00:15
 * after a 22:00 start ends on the next day, and the screen says so.
 */
export function clockOfMinutes(minutes: number): { time: string; dayOffset: number } {
  const whole = Math.max(0, Math.round(minutes));
  const inDay = whole % (24 * 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    time: `${pad(Math.floor(inDay / 60))}:${pad(inDay % 60)}`,
    dayOffset: Math.floor(whole / (24 * 60)),
  };
}

/** A span in seconds as `HH:MM:SS`; hours run past 24 rather than wrapping. */
export function formatSpan(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
}

/** Seconds between a step's actual start and finish, or null until both are known. */
export function actualStepSeconds(step: {
  actualStartedAt: string | null;
  actualFinishedAt: string | null;
  actualDurationMinutes?: number | null;
}): number | null {
  if (step.actualDurationMinutes !== null && step.actualDurationMinutes !== undefined) {
    return step.actualDurationMinutes * 60;
  }
  if (!step.actualStartedAt || !step.actualFinishedAt) return null;
  const span = Date.parse(step.actualFinishedAt) - Date.parse(step.actualStartedAt);
  return Number.isFinite(span) && span >= 0 ? span / 1000 : null;
}

/**
 * The estimated start and end of every step, in minutes after midnight of the
 * implementation day, keyed by step id.
 *
 * Sequential by construction: each step starts where the one above it ended,
 * across phase boundaries. A runbook is run one step at a time by people
 * reading down it, so that is the schedule it actually keeps — and the one
 * definition the table, the summary cards and the export all read.
 */
export function scheduleImplementationPlan(
  startTime: string,
  phases: {
    steps: {
      id: string;
      durationMinutes: number;
      estimatedStartTime?: string | null;
      estimatedEndTime?: string | null;
    }[];
  }[],
): { steps: Record<string, { start: number; end: number }>; end: number } {
  let cursor = minutesOfClock(startTime);
  const steps: Record<string, { start: number; end: number }> = {};

  for (const phase of phases) {
    for (const step of phase.steps) {
      let start = cursor;
      if (step.estimatedStartTime) {
        start = minutesOfClock(step.estimatedStartTime);
        while (start < cursor) start += 24 * 60;
      }
      let end = start + Math.max(0, step.durationMinutes);
      if (step.estimatedEndTime) {
        end = minutesOfClock(step.estimatedEndTime);
        while (end <= start) end += 24 * 60;
      }
      cursor = end;
      steps[step.id] = { start, end };
    }
  }

  return { steps, end: cursor };
}

export interface ImplementationPlanSummary {
  total: number;
  /** Done plus Skipped — the steps nothing more is expected of. */
  settled: number;
  done: number;
  inProgress: number;
  failed: number;
  skipped: number;
  notStarted: number;
  /** Settled over every step, 0-100. */
  progressPercent: number;
  estimatedMinutes: number;
  estimatedDowntimeMinutes: number;
  /** Only steps with both an actual start and finish count. */
  actualSeconds: number;
  actualDowntimeSeconds: number;
}

/**
 * The one definition of the counters, so the cards on screen, the totals row
 * and the export can never disagree.
 */
export function summarizeImplementationPlan(
  phases: {
    steps: {
      status: ImplementationStepStatus;
      downtime: boolean;
      durationMinutes: number;
      actualStartedAt: string | null;
      actualFinishedAt: string | null;
      actualDurationMinutes?: number | null;
    }[];
  }[],
): ImplementationPlanSummary {
  const steps = phases.flatMap((phase) => phase.steps);
  const count = (status: ImplementationStepStatus) =>
    steps.filter((step) => step.status === status).length;
  const settled = steps.filter((step) => isImplementationStepSettled(step.status)).length;

  let estimatedMinutes = 0;
  let estimatedDowntimeMinutes = 0;
  let actualSeconds = 0;
  let actualDowntimeSeconds = 0;

  for (const step of steps) {
    const actual = actualStepSeconds(step) ?? 0;
    estimatedMinutes += step.durationMinutes;
    actualSeconds += actual;
    if (step.downtime) {
      estimatedDowntimeMinutes += step.durationMinutes;
      actualDowntimeSeconds += actual;
    }
  }

  return {
    total: steps.length,
    settled,
    done: count('DONE'),
    inProgress: count('IN_PROGRESS'),
    failed: count('FAILED'),
    skipped: count('SKIPPED'),
    notStarted: count('NOT_STARTED'),
    progressPercent: steps.length === 0 ? 0 : Math.round((settled / steps.length) * 100),
    estimatedMinutes,
    estimatedDowntimeMinutes,
    actualSeconds,
    actualDowntimeSeconds,
  };
}
