import { z } from 'zod';
import type { ProjectStage, ProjectStatus } from './workspace.schema.js';

/**
 * The project's Bug & Issue list.
 *
 * A bug is followed from the moment somebody finds it, through the developer
 * who fixes it, to the QA who verifies the fix. It is recorded against the
 * **environment** it was found in, because "a bug in SIT" and "a bug in
 * production" are different conversations with different people: the first is
 * the build working as intended, the second is an incident.
 */

/** Ordered: the array order *is* how far along the road to production a project is. */
export const BUG_ENVIRONMENTS = ['SIT', 'UAT', 'PROD'] as const;
export type BugEnvironment = (typeof BUG_ENVIRONMENTS)[number];

export const BUG_ENVIRONMENT_LABELS: Record<BugEnvironment, string> = {
  SIT: 'SIT',
  UAT: 'UAT',
  PROD: 'Production',
};

/** Ordered along the flow: found, fixed, handed to QA, verified. */
export const BUG_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_TEST', 'IN_QA', 'DONE'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  PENDING_TEST: 'Pending to Test',
  IN_QA: 'In QA',
  DONE: 'Done',
};

export const BUG_SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_SEVERITY_LABELS: Record<BugSeverity, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/**
 * The moves the board offers on a row, one click each.
 *
 * Only the natural next steps. The edit dialog still accepts any status, so a
 * bug that skipped a step is recordable — this list is a shortcut, not a
 * state machine, and nothing on the server enforces it.
 */
export const BUG_NEXT_STEPS: Record<BugStatus, { to: BugStatus; label: string }[]> = {
  OPEN: [{ to: 'IN_PROGRESS', label: 'Mulai perbaiki' }],
  IN_PROGRESS: [{ to: 'PENDING_TEST', label: 'Kirim ke QA' }],
  PENDING_TEST: [{ to: 'IN_QA', label: 'Mulai testing' }],
  IN_QA: [
    { to: 'DONE', label: 'Lolos QA' },
    { to: 'IN_PROGRESS', label: 'Gagal QA, kembalikan ke developer' },
  ],
  DONE: [{ to: 'IN_PROGRESS', label: 'Buka lagi' }],
};

const day = z.iso.datetime();

export const saveBugSchema = z
  .object({
    title: z.string().trim().min(3, 'Judul minimal 3 karakter').max(200),
    /** Steps to reproduce, what was expected, what happened. */
    description: z.string().trim().max(4000).nullable().default(null),
    /** Free text, like a task's module: the modules of one app are not another's. */
    module: z.string().trim().max(80).nullable().default(null),
    environment: z.enum(BUG_ENVIRONMENTS, 'Environment wajib dipilih'),
    severity: z.enum(BUG_SEVERITIES).default('MEDIUM'),
    status: z.enum(BUG_STATUSES).default('OPEN'),
    developerId: z.uuid().nullable().default(null),
    qaId: z.uuid().nullable().default(null),
    /** A calendar day, sent as midnight UTC. */
    foundAt: day,
    fixEta: day.nullable().default(null),
  })
  .refine((bug) => !bug.fixEta || bug.fixEta.slice(0, 10) >= bug.foundAt.slice(0, 10), {
    message: 'Target perbaikan tidak boleh mendahului tanggal ditemukan',
    path: ['fixEta'],
  });

export type SaveBugInput = z.infer<typeof saveBugSchema>;

/** One click on the board: a status move and nothing else, so it cannot overwrite an edit. */
export const updateBugStatusSchema = z.object({ status: z.enum(BUG_STATUSES) });
export type UpdateBugStatusInput = z.infer<typeof updateBugStatusSchema>;

export interface BugView {
  id: string;
  projectId: string;
  number: number;
  /** `BUG-007` — what people quote. */
  code: string;
  title: string;
  description: string | null;
  module: string | null;
  environment: BugEnvironment;
  severity: BugSeverity;
  status: BugStatus;
  developerId: string | null;
  developerName: string | null;
  qaId: string | null;
  qaName: string | null;
  reportedByName: string | null;
  foundAt: string;
  fixEta: string | null;
  /** When the fix was last handed to QA. Stamped by the server, never sent. */
  readyForTestAt: string | null;
  /** When it reached Done. Stamped by the server, cleared if it is reopened. */
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBugsView {
  bugs: BugView[];
  /**
   * The furthest environment this project has reached — the list's default
   * filter, and the environment a new bug starts in.
   */
  environment: BugEnvironment;
  /** Why, in words the screen can print beside the filter. */
  environmentReason: string;
}

export function bugCode(number: number): string {
  return `BUG-${String(number).padStart(3, '0')}`;
}

/** Done is the only status that is finished; everything else is still somebody's work. */
export function isBugOpen(bug: Pick<BugView, 'status'>): boolean {
  return bug.status !== 'DONE';
}

/** What the project has done that says how far it has got. */
export interface EnvironmentSignals {
  /** The first time the implementation plan was marked complete — the cut-over. */
  implementationCompletedAt: string | null;
  stage: ProjectStage;
  status: ProjectStatus;
  /** Somebody has saved the UAT script, so user testing has begun. */
  uatStarted: boolean;
  /** The environments bugs are already recorded in. */
  bugEnvironments: readonly BugEnvironment[];
}

/**
 * The furthest environment a project has **ever** reached.
 *
 * "Ever", because a project that has gone live stays live: a bug found after
 * the cut-over is a production bug even if somebody has since reopened the
 * implementation plan to fix a typo. That is why the plan is read through the
 * first time it was completed rather than its current status.
 *
 * A bug is evidence too. Somebody recording one in production is somebody who
 * saw production, whatever the rest of the project says — so a project that
 * never used the implementation plan still lands on PROD once its first
 * incident is logged.
 *
 * Checked from the far end down, so the first reason that holds is the one
 * printed.
 */
export function reachedEnvironment(signals: EnvironmentSignals): {
  environment: BugEnvironment;
  reason: string;
} {
  if (signals.implementationCompletedAt) {
    return { environment: 'PROD', reason: 'Implementation plan sudah pernah ditandai selesai' };
  }
  if (signals.stage === 'COMPLETE') {
    return { environment: 'PROD', reason: 'Project sudah di tahap Complete' };
  }
  if (signals.status === 'DONE') {
    return { environment: 'PROD', reason: 'Project berstatus Selesai' };
  }
  if (signals.bugEnvironments.includes('PROD')) {
    return { environment: 'PROD', reason: 'Sudah ada bug yang tercatat di Production' };
  }
  if (signals.uatStarted) {
    return { environment: 'UAT', reason: 'UAT script sudah mulai diisi' };
  }
  if (signals.bugEnvironments.includes('UAT')) {
    return { environment: 'UAT', reason: 'Sudah ada bug yang tercatat di UAT' };
  }
  return { environment: 'SIT', reason: 'Project belum sampai UAT' };
}
