import { z } from 'zod';
import { PROJECT_JOB_ROLES, type ProjectJobRole } from './project-team.schema.js';
import { PROJECT_STAGES, type ProjectStage } from './workspace.schema.js';

/**
 * The mandays estimate: how much effort each stage of a project will take,
 * broken down by the job roles doing it.
 *
 * The grid is stages down, job roles across. Which roles get a column is part
 * of the plan rather than fixed, because an estimate that always showed all
 * seven would be mostly empty columns — and an empty column reads as "zero
 * days", not as "this role is not involved".
 */

export const MANDAY_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type MandayStatus = (typeof MANDAY_STATUSES)[number];

export const MANDAY_STATUS_LABELS: Record<MandayStatus, string> = {
  DRAFT: 'Draft',
  // Not "waiting for approval": submitting does not block on anybody. It is
  // the estimator saying the breakdown is settled, which is what opens the
  // Timeline, Task Activity and Bug Tracking.
  SUBMITTED: 'Sudah di-submit',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

/** Quarter-day increments, plus one-eighth of a day as the smallest estimate. */
const daysSchema = z
  .number()
  .min(0, 'Mandays tidak boleh negatif')
  .max(9999, 'Mandays terlalu besar')
  .refine(
    (days) => days === 0.125 || Number.isInteger(days * 4),
    'Isi 0,125 atau kelipatan 0,25 hari',
  );

export const mandayTaskSchema = z.object({
  /** Absent on a row just added in the editor. */
  id: z.uuid().optional(),
  /**
   * The editor's own handle on this row, stable for as long as the page is
   * open. A child added in the same save as its parent has no database id to
   * point at yet, so the tree is expressed in these instead and resolved
   * server-side.
   */
  key: z.string().min(1).max(64),
  parentKey: z.string().min(1).max(64).nullable().default(null),
  stage: z.enum(PROJECT_STAGES),
  name: z.string().trim().min(2, 'Nama task minimal 2 karakter').max(160),
  status: z.enum(MANDAY_STATUSES).default('DRAFT'),
  /**
   * Days per job role. Partial on purpose: a role with no entry counts as
   * zero, so an estimate never has to carry a cell for work nobody does.
   */
  efforts: z.partialRecord(z.enum(PROJECT_JOB_ROLES), daysSchema).default({}),
});

export type MandayTaskInput = z.infer<typeof mandayTaskSchema>;

/**
 * The plan is saved whole, like the document template: the rows are an
 * ordering inside their stage, and sending them one at a time would leave the
 * estimate half-renumbered whenever a call failed.
 */
export const saveMandayPlanSchema = z.object({
  module: z.string().trim().max(120).nullable().default(null),
  pic: z.string().trim().max(120).nullable().default(null),
  estimatedAt: z.iso.datetime().nullable().default(null),
  roles: z
    .array(z.enum(PROJECT_JOB_ROLES))
    .min(1, 'Pilih minimal satu role sebagai kolom')
    .max(PROJECT_JOB_ROLES.length),
  tasks: z.array(mandayTaskSchema).max(300),
  /** The version the editor loaded; a stale save is refused, never merged. */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
});

export type SaveMandayPlanInput = z.infer<typeof saveMandayPlanSchema>;

export const submitMandayPlanSchema = z.object({
  /**
   * `SUBMITTED` marks the estimate as settled — which is what opens the rest
   * of the project. It does not wait for anyone: the estimator carries on, and
   * the grid stays editable.
   *
   * `APPROVED`/`REJECTED` are a decision on top of that, and `DRAFT` reopens a
   * decided estimate. Reopening exists because approval used to be a one-way
   * door: once approved, the plan was locked and no transition led out of it,
   * so a figure agreed in error could never be corrected — the only way on was
   * a new project.
   */
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).nullable().default(null),
});

export type SubmitMandayPlanInput = z.infer<typeof submitMandayPlanSchema>;

export interface MandayTaskView {
  id: string;
  /** Null for a row sitting directly under its stage. */
  parentId: string | null;
  stage: ProjectStage;
  name: string;
  position: number;
  status: MandayStatus;
  efforts: Partial<Record<ProjectJobRole, number>>;
}

export interface MandayPlanView {
  id: string;
  projectId: string;
  projectName: string;
  /** The node the project hangs under — the middle crumb in the breadcrumb. */
  node: { id: string; name: string };
  module: string | null;
  pic: string | null;
  estimatedAt: string | null;
  roles: ProjectJobRole[];
  status: MandayStatus;
  tasks: MandayTaskView[];
  /** When the estimate was first opened — shown as its date. */
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** What the caller may do with this plan, resolved server-side. */
  canEdit: boolean;
  canApprove: boolean;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

/** Days for one task across the plan's columns. */
export function taskTotal(task: Pick<MandayTaskView, 'efforts'>, roles: ProjectJobRole[]): number {
  return roles.reduce((sum, role) => sum + (task.efforts[role] ?? 0), 0);
}

/** Days per role, plus the grand total, for a set of tasks. */
export function sumEfforts(
  tasks: Pick<MandayTaskView, 'efforts'>[],
  roles: ProjectJobRole[],
): { byRole: Record<string, number>; total: number } {
  const byRole: Record<string, number> = {};
  for (const role of roles) {
    byRole[role] = tasks.reduce((sum, task) => sum + (task.efforts[role] ?? 0), 0);
  }
  const total = Object.values(byRole).reduce((sum, value) => sum + value, 0);
  return { byRole, total };
}

/**
 * The default task list, matching how these projects are actually run.
 *
 * Seeded into a new plan so the estimator starts by filling numbers in rather
 * than by typing out the same twenty rows every time; every row stays editable
 * and removable.
 */
export const DEFAULT_MANDAY_TASKS: { stage: ProjectStage; name: string }[] = [
  { stage: 'PREPARE', name: 'Project Kick Off' },
  { stage: 'PREPARE', name: 'Requirement Gathering & Analysis' },
  { stage: 'PREPARE', name: 'Prepare Project Plan' },
  { stage: 'DEFINE', name: 'Define Scope' },
  { stage: 'DEFINE', name: 'Define Business Requirement' },
  { stage: 'DEFINE', name: 'Define Acceptance Criteria' },
  { stage: 'DESIGN', name: 'Technical Design' },
  { stage: 'DESIGN', name: 'Database Design' },
  { stage: 'DESIGN', name: 'Interface Design' },
  { stage: 'DEVELOP', name: 'Development' },
  { stage: 'DEVELOP', name: 'Unit Testing' },
  { stage: 'DEVELOP', name: 'Code Review' },
  { stage: 'DEPLOY', name: 'SIT' },
  { stage: 'DEPLOY', name: 'UAT' },
  { stage: 'DEPLOY', name: 'Training' },
  { stage: 'DEPLOY', name: 'Go Live' },
  { stage: 'COMPLETE', name: 'Post Go Live / Warranty' },
];
