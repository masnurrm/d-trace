import { z } from 'zod';

/**
 * The work a project is actually made of, tracked twice over.
 *
 * Every task is followed through development and then through testing, and the
 * two are kept as separate columns rather than one "status" because they move
 * independently: a task can be Closed Dev and Re-Opened by test on the same
 * day, and a single field would have to pick one of those to be true.
 *
 * Plan and actual dates are likewise both kept. A plan that is overwritten the
 * moment it slips answers "when will it be done" and destroys "was it late",
 * which is the question a project review actually asks.
 */

export const DEV_STATUSES = [
  'UNREADY',
  'WAITING_CONFIRM_USER',
  'READY',
  'IN_PROGRESS',
  'CLOSED',
] as const;
export type DevStatus = (typeof DEV_STATUSES)[number];

export const DEV_STATUS_LABELS: Record<DevStatus, string> = {
  UNREADY: 'Unready for Dev',
  WAITING_CONFIRM_USER: 'Waiting confirmUser',
  READY: 'Ready for Dev',
  IN_PROGRESS: 'InProgress Dev',
  CLOSED: 'Closed Dev',
};

export const TEST_STATUSES = [
  'REOPENED',
  'WAITING_DEVELOPMENT',
  'READY',
  'IN_PROGRESS',
  'CLOSED',
] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const TEST_STATUS_LABELS: Record<TestStatus, string> = {
  REOPENED: 'Re-Opened Dev',
  WAITING_DEVELOPMENT: 'Waiting Development',
  READY: 'Ready for Test',
  IN_PROGRESS: 'InProgress Test',
  CLOSED: 'Closed Test',
};

export const TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

const isoDate = z.iso.datetime().nullable().default(null);
const percent = z.number().int().min(0).max(100).default(0);

export const saveProjectTaskSchema = z
  .object({
    /** Free text, not a lookup: the modules of an HRIS are not the modules of
     *  a migration, and a shared list would be wrong for both. */
    module: z.string().trim().min(1, 'Modul wajib diisi').max(80),
    category: z.string().trim().max(60).nullable().default(null),
    description: z.string().trim().min(3, 'Deskripsi minimal 3 karakter').max(500),
    priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
    assigneeId: z.uuid().nullable().default(null),

    devPlanStart: isoDate,
    devPlanEnd: isoDate,
    devActualStart: isoDate,
    devActualEnd: isoDate,
    devCompletion: percent,
    devStatus: z.enum(DEV_STATUSES).default('UNREADY'),

    testPlanStart: isoDate,
    testPlanEnd: isoDate,
    testActualStart: isoDate,
    testActualEnd: isoDate,
    testCompletion: percent,
    testStatus: z.enum(TEST_STATUSES).default('WAITING_DEVELOPMENT'),

    remark: z.string().trim().max(1000).nullable().default(null),
  })
  .refine((task) => !task.devPlanStart || !task.devPlanEnd || task.devPlanEnd >= task.devPlanStart, {
    message: 'Plan End tidak boleh mendahului Plan Start',
    path: ['devPlanEnd'],
  })
  .refine(
    (task) => !task.testPlanStart || !task.testPlanEnd || task.testPlanEnd >= task.testPlanStart,
    { message: 'Plan End tidak boleh mendahului Plan Start', path: ['testPlanEnd'] },
  );

export type SaveProjectTaskInput = z.infer<typeof saveProjectTaskSchema>;

export interface ProjectTaskView {
  id: string;
  projectId: string;
  module: string;
  category: string | null;
  description: string;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;

  devPlanStart: string | null;
  devPlanEnd: string | null;
  devActualStart: string | null;
  devActualEnd: string | null;
  devCompletion: number;
  devStatus: DevStatus;

  testPlanStart: string | null;
  testPlanEnd: string | null;
  testActualStart: string | null;
  testActualEnd: string | null;
  testCompletion: number;
  testStatus: TestStatus;

  remark: string | null;
  position: number;
  updatedAt: string;
}

/**
 * The five buckets the project dashboard counts by.
 *
 * A task lands in the **first** one it qualifies for, reading down: a task the
 * testers sent back is Re-Opened, not "in development", even though both are
 * true of it. Defined here rather than in the dashboard so the board and the
 * task list can never disagree about what "Terhambat" means.
 */
export type TaskBucket = 'BLOCKED' | 'DEVELOPMENT' | 'TESTING' | 'REOPENED' | 'READY_FOR_SIT';

export function bucketOf(task: Pick<ProjectTaskView, 'devStatus' | 'testStatus'>): TaskBucket {
  if (task.testStatus === 'REOPENED') return 'REOPENED';
  if (task.devStatus === 'UNREADY' || task.devStatus === 'WAITING_CONFIRM_USER') return 'BLOCKED';
  if (task.devStatus !== 'CLOSED') return 'DEVELOPMENT';
  if (task.testStatus === 'CLOSED') return 'READY_FOR_SIT';
  return 'TESTING';
}

/** Done means through both halves; nothing else counts as finished. */
export function isTaskComplete(task: Pick<ProjectTaskView, 'devStatus' | 'testStatus'>): boolean {
  return task.devStatus === 'CLOSED' && task.testStatus === 'CLOSED';
}

export function isTaskNotStarted(
  task: Pick<ProjectTaskView, 'devStatus' | 'devCompletion'>,
): boolean {
  return task.devCompletion === 0 && (task.devStatus === 'UNREADY' || task.devStatus === 'READY');
}
